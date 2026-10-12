import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import app from "../worker/index";
import { D1Database } from "../docker/d1";

type Json = Record<string, unknown>;
let raw: DatabaseSync;
let env: { DB: D1Database; SESSION_SECRET: string };

beforeEach(() => {
  raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort())
    raw.exec(readFileSync(join("migrations", file), "utf8"));
  env = { DB: new D1Database(raw), SESSION_SECRET: "local-test-session-secret" };
});

afterEach(() => raw.close());

async function call(path: string, method = "GET", body?: Json, cookie?: string) {
  const headers = new Headers();
  if (body) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  return app.request(
    "http://local.test" + path,
    { method, headers, body: body ? JSON.stringify(body) : undefined },
    env as never,
  );
}

function cookie(response: Response): string {
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

async function adminSession() {
  const response = await call("/api/auth/setup", "POST", {
    username: "test-admin",
    password: "local-test-password",
  });
  expect(response.status).toBe(201);
  return cookie(response);
}

async function tasterSession(username: string) {
  const response = await call("/api/taster/register", "POST", {
    username,
    display_name: username.toUpperCase(),
    password: "local-test-password",
  });
  expect(response.status).toBe(201);
  return cookie(response);
}

async function createBottle(admin: string, name: string) {
  const response = await call("/api/bottles", "POST", {
    name,
    size_ml: 750,
    status: "sealed",
  }, admin);
  expect(response.status).toBe(201);
  return (await response.json() as { id: number }).id;
}

async function createRequest(taster: string, bottleId: number) {
  const response = await call("/api/requests", "POST", { bottle_id: bottleId }, taster);
  expect(response.status).toBe(201);
  return (await response.json() as { id: number }).id;
}

const note = (bottleId: number, requestId: number, rating = 4) => ({
  bottle_id: bottleId,
  request_id: requestId,
  rating,
  notes: "Local integration test note",
});

describe("release authentication protections", () => {
  it("creates exactly one administrator under simultaneous first-account requests", async () => {
    const results = await Promise.all(["test-admin-one", "test-admin-two"].map(username =>
      call("/api/auth/setup", "POST", { username, password: "local-test-password" })));
    expect(results.map(r => r.status).sort()).toEqual([201, 409]);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(1);
  });
  it("blocks browser-origin writes without changing data and permits the same origin", async () => {
    for (const headers of [{ Origin: "https://outside.example.invalid" }, { "Sec-Fetch-Site": "cross-site" }]) {
      const response = await app.request("http://local.test/api/auth/setup", { method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ username: "test-admin", password: "local-test-password" }) }, env as never);
      expect(response.status).toBe(403);
    }
    expect((raw.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n).toBe(0);
    const response = await app.request("http://local.test/api/auth/setup", { method: "POST",
      headers: { Origin: "http://local.test", "content-type": "application/json" },
      body: JSON.stringify({ username: "test-admin", password: "local-test-password" }) }, env as never);
    expect(response.status).toBe(201);
  });
  it("persists separate admin/taster attempt limits and allows login after expiry", async () => {
    await adminSession();
    await tasterSession("test-learner");
    for (const [route, username] of [["/api/auth/login", "test-admin"], ["/api/taster/login", "test-learner"]]) {
      for (let i = 0; i < 12; i++)
        expect((await call(route, "POST", { username, password: "wrong-test-password" })).status).toBe(401);
      expect((await call(route, "POST", { username, password: "local-test-password" })).status).toBe(429);
    }
    raw.prepare("UPDATE login_limits SET expires_at = 0").run();
    expect((await call("/api/auth/login", "POST", { username: "test-admin", password: "local-test-password" })).status).toBe(200);
    expect((await call("/api/taster/login", "POST", { username: "test-learner", password: "local-test-password" })).status).toBe(200);
  });
  it("rejects oversized credentials and never sends email without an explicit recipient", async () => {
    expect((await call("/api/auth/setup", "POST", { username: "test-admin", password: "x".repeat(257) })).status).toBe(400);
    expect((await call("/api/auth/login", "POST", { username: "test-admin", password: "x".repeat(257) })).status).toBe(400);
    const send = vi.fn(); vi.stubGlobal("fetch", send);
    try {
      const response = await app.request("http://local.test/api/auth/request-code", { method: "POST" },
        { ...env, RESEND_API_KEY: "test-only-not-a-provider-key" } as never);
      expect(response.status).toBe(503); expect(send).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe("approved-pour tasting authorization", () => {
  it("rejects stale inventory edits and preserves the latest amount", async () => {
    const admin = await adminSession();
    const bottle = await createBottle(admin, "Concurrent edit bottle");
    expect((await call(`/api/bottles/${bottle}/open`, "POST", undefined, admin)).status).toBe(200);
    const stale = await call(`/api/bottles/${bottle}`, "PATCH", { remaining_ml: 700, expected_version: 0 }, admin);
    expect(stale.status).toBe(409);
    expect((raw.prepare("SELECT remaining_ml, version FROM bottles WHERE id = ?").get(bottle) as { remaining_ml: number; version: number })).toMatchObject({ remaining_ml: 750, version: 1 });
  });

  it("archives without deleting the image or tasting history", async () => {
    const admin = await adminSession();
    const bottle = await createBottle(admin, "Archived photo bottle");
    const taster = await tasterSession("archive-taster");
    const image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
    expect((await call(`/api/bottles/${bottle}`, "PATCH", { photo_url: image, expected_version: 0 }, admin)).status).toBe(200);
    const account = raw.prepare("SELECT id FROM tasters WHERE username = ?").get("archive-taster") as { id: number };
    raw.prepare("INSERT INTO tastings (bottle_id, taster_id, notes) VALUES (?, ?, ?)").run(bottle, account.id, "Preserved note");
    const catalog = await call("/api/bottles", "GET", undefined, taster);
    const catalogRows = await catalog.json() as { id: number; photo_url: string }[];
    expect(catalogRows.find((row) => row.id === bottle)?.photo_url).toBe(`/api/bottles/${bottle}/photo?v=1`);
    expect(JSON.stringify(catalogRows)).not.toContain(image);
    const servedPhoto = await call(`/api/bottles/${bottle}/photo?v=1`, "GET", undefined, taster);
    expect(servedPhoto.status).toBe(200);
    expect(servedPhoto.headers.get("content-type")).toBe("image/jpeg");
    expect((await call(`/api/bottles/${bottle}`, "DELETE", undefined, admin)).status).toBe(204);
    expect((raw.prepare("SELECT photo_url, archived_at FROM bottles WHERE id = ?").get(bottle) as { photo_url: string; archived_at: string })).toMatchObject({ photo_url: image });
    expect((raw.prepare("SELECT notes FROM tastings WHERE bottle_id = ?").get(bottle) as { notes: string }).notes).toBe("Preserved note");
    expect((await call("/api/bottles", "GET", undefined, taster).then((r) => r.json()) as { id: number }[]).some((row) => row.id === bottle)).toBe(false);
  });

  it("does not approve or record a pour when the remaining volume is insufficient", async () => {
    const admin = await adminSession();
    const taster = await tasterSession("empty-taster");
    const bottle = await createBottle(admin, "Almost empty bottle");
    raw.prepare("UPDATE bottles SET status='open', remaining_ml=20 WHERE id=?").run(bottle);
    const request = await createRequest(taster, bottle);
    const approval = await call(`/api/requests/${request}/approve`, "POST", { pour_ml: 30 }, admin);
    expect(approval.status).toBe(409);
    expect((raw.prepare("SELECT status, remaining_ml FROM bottles WHERE id=?").get(bottle) as { status: string; remaining_ml: number })).toMatchObject({ status: "open", remaining_ml: 20 });
    expect((raw.prepare("SELECT status FROM requests WHERE id=?").get(request) as { status: string }).status).toBe("pending");
    expect((raw.prepare("SELECT COUNT(*) AS n FROM tastings WHERE bottle_id=?").get(bottle) as { n: number }).n).toBe(0);
  });

  it("computes bottle rating aggregates across all reviews, not only the latest 50 notes", async () => {
    const admin = await adminSession();
    const taster = await tasterSession("many-rating-taster");
    const account = raw.prepare("SELECT id FROM tasters WHERE username = ?").get("many-rating-taster") as { id: number };
    const bottle = await createBottle(admin, "Many reviews bottle");
    const insert = raw.prepare("INSERT INTO tastings (bottle_id, taster_id, rating, notes) VALUES (?, ?, ?, ?)");
    for (let i = 0; i < 51; i++) insert.run(bottle, account.id, i === 0 ? 1 : 5, `Review ${i}`);
    const response = await call(`/api/whiskeys/${bottle}`, "GET", undefined, taster);
    const whiskey = await response.json() as { avg_rating: number; rating_count: number; notes: unknown[] };
    expect(whiskey.notes).toHaveLength(50);
    expect(whiskey.rating_count).toBe(51);
    expect(whiskey.avg_rating).toBeCloseTo(251 / 51);
  });

  it("persists structured bottle profiles and exposes anonymous community tasting notes", async () => {
    const admin = await adminSession();
    const taster = await tasterSession("private-author-name");
    const image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
    const created = await call("/api/bottles", "POST", {
      name: "Profiled bottle",
      distillery: "North",
      photo_url: image,
      flavor_profile: { vanilla: 3, "dark-fruit": 2 },
      flavor_source: "Manual",
    }, admin);
    expect(created.status).toBe(201);
    const bottle = await created.json() as { id: number };
    const account = raw.prepare("SELECT id FROM tasters WHERE username = ?").get("private-author-name") as { id: number };
    raw.prepare("INSERT INTO tastings (bottle_id, taster_id, taster_name, rating, notes) VALUES (?, ?, ?, ?, ?)")
      .run(bottle.id, account.id, "PRIVATE DISPLAY NAME", 4, "Anonymous community note");

    const directory = await call("/api/bottles", "GET", undefined, taster);
    const rows = await directory.json() as { id: number; flavor_profile: Record<string, number> | null; photo_url: string | null }[];
    expect(rows.find((item) => item.id === bottle.id)?.flavor_profile).toEqual({ vanilla: 3, "dark-fruit": 2 });
    expect(rows.find((item) => item.id === bottle.id)?.photo_url).not.toBe(image);

    const detail = await call(`/api/whiskeys/${bottle.id}`, "GET", undefined, taster);
    const payload = await detail.json() as { flavor_profile: Record<string, number>; notes: { notes: string; taster?: string }[] };
    expect(payload.flavor_profile).toEqual({ vanilla: 3, "dark-fruit": 2 });
    expect(payload.notes[0].notes).toBe("Anonymous community note");
    expect(JSON.stringify(payload)).not.toContain("PRIVATE DISPLAY NAME");
    expect(JSON.stringify(payload)).not.toContain("private-author-name");
  });

  it("serves recommendations only to the signed-in taster and excludes their rated bottles", async () => {
    const admin = await adminSession();
    const taster = await tasterSession("recommendation-user");
    const ratedId = await createBottle(admin, "Already rated whiskey");
    const candidateId = await createBottle(admin, "New flavor match");
    const account = raw.prepare("SELECT id FROM tasters WHERE username = ?").get("recommendation-user") as { id: number };
    raw.prepare("UPDATE bottles SET flavor_profile = ? WHERE id = ?").run(JSON.stringify({ vanilla: 3, caramel: 2 }), ratedId);
    raw.prepare("UPDATE bottles SET flavor_profile = ?, abv = 45, distillery = 'Another maker' WHERE id = ?")
      .run(JSON.stringify({ vanilla: 3, caramel: 2 }), candidateId);
    raw.prepare("INSERT INTO tastings (bottle_id, taster_id, rating) VALUES (?, ?, 5)").run(ratedId, account.id);

    expect((await call("/api/taster/recommendations")).status).toBe(401);
    const response = await call("/api/taster/recommendations", "GET", undefined, taster);
    expect(response.status).toBe(200);
    const result = await response.json() as { has_ratings: boolean; recommendations: { bottle: { id: number; abv: number; distillery: string } }[] };
    expect(result.has_ratings).toBe(true);
    expect(result.recommendations.map((item) => item.bottle.id)).toEqual([candidateId]);
    expect(result.recommendations[0].bottle).toMatchObject({ abv: 45, distillery: "Another maker" });
    expect((raw.prepare("SELECT abv FROM bottles WHERE id = ?").get(candidateId) as { abv: number }).abv).toBe(45);
  });

  it("saves only extracted flavor tags from a verified WhiskyCast review and preserves other bottle data", async () => {
    const admin = await adminSession();
    const bottle = await createBottle(admin, "Profile source bottle");
    const image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
    raw.prepare("UPDATE bottles SET photo_url = ?, abv = 50 WHERE id = ?").run(image, bottle);
    const originalFetch = globalThis.fetch;
    const calls = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([
        { type: "post", subtype: "ratings", url: "https://whiskycast.com/ratings/unrelated-bottle/" },
        { type: "post", subtype: "ratings", url: "https://whiskycast.com/ratings/profile-source-bottle/" },
      ]), { headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response("<h2>NOSE</h2><p>Vanilla, caramel and cherry.</p><h2>PALATE</h2><p>Vanilla and oak.</p><h2>FINISH</h2><p>Caramel.</p>", { status: 200 }));
    vi.stubGlobal("fetch", calls);
    try {
      const response = await call(`/api/bottles/${bottle}/flavor-lookup`, "POST", { persist: true }, admin);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ found: true, flavor_source: "WhiskyCast" });
      const row = raw.prepare("SELECT flavor_profile, flavor_source_url, photo_url, abv FROM bottles WHERE id = ?").get(bottle) as { flavor_profile: string; flavor_source_url: string; photo_url: string; abv: number };
      expect(JSON.parse(row.flavor_profile)).toMatchObject({ vanilla: 2, caramel: 2, "dark-fruit": 1, oak: 1 });
      expect(row.flavor_source_url).toBe("https://whiskycast.com/ratings/profile-source-bottle/");
      expect(row.photo_url).toBe(image);
      expect(row.abv).toBe(50);
      expect(calls).toHaveBeenCalledTimes(2);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("keeps bottle photo changes under admin authentication", async () => {
    const admin = await adminSession();
    const taster = await tasterSession("photo-taster");
    const bottle = await createBottle(admin, "Admin photo test bottle");
    const image = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD";
    const route = "/api/bottles/" + bottle;

    expect((await call(route, "PATCH", { photo_url: image })).status).toBe(401);
    expect((await call(route, "PATCH", { photo_url: image }, taster)).status).toBe(401);
    expect((await call(route, "PATCH", { photo_url: image, expected_version: 0 }, admin)).status).toBe(200);
    expect((raw.prepare("SELECT photo_url FROM bottles WHERE id = ?").get(bottle) as { photo_url: string }).photo_url).toBe(image);
  });

  it("allows only admins to reset passwords and revokes old sessions while preserving notes", async () => {
    const admin = await adminSession();
    const alice = await tasterSession("reset-alice");
    const bob = await tasterSession("reset-bob");
    const account = raw.prepare("SELECT id FROM tasters WHERE username = ?").get("reset-alice") as { id: number };
    const bottle = await createBottle(admin, "Reset test bottle");
    raw.prepare("INSERT INTO tastings (bottle_id, taster_id, notes) VALUES (?, ?, ?)").run(bottle, account.id, "Keep this note");
    const path = "/api/tasters/" + account.id + "/reset-password";
    const replacement = "replacement-local-test-password";
    expect((await call(path, "POST", { password: replacement })).status).toBe(401);
    expect((await call(path, "POST", { password: replacement }, bob)).status).toBe(401);
    expect((await call(path, "POST", { password: "short" }, admin)).status).toBe(400);
    expect((await call(path, "POST", { password: replacement }, admin)).status).toBe(200);
    expect((await call("/api/taster/tastings", "GET", undefined, alice)).status).toBe(401);
    expect((await call("/api/taster/tastings", "GET", undefined, bob)).status).toBe(200);
    expect((await call("/api/taster/login", "POST", { username: "reset-alice", password: "local-test-password" })).status).toBe(401);
    const login = await call("/api/taster/login", "POST", { username: "reset-alice", password: replacement });
    expect(login.status).toBe(200);
    const notes = await call("/api/taster/tastings", "GET", undefined, cookie(login));
    expect((await notes.json() as { count: number }).count).toBe(1);
    expect((raw.prepare("SELECT password_hash FROM tasters WHERE id = ?").get(account.id) as { password_hash: string }).password_hash).not.toBe(replacement);
  });
  it("enforces state, owner and bottle while keeping approval and note creation idempotent", async () => {
    const admin = await adminSession();
    const alice = await tasterSession("alice");
    const bob = await tasterSession("bob");
    await tasterSession("zero-notes");
    const bourbon = await createBottle(admin, "Test Bourbon");
    const rye = await createBottle(admin, "Test Rye");

    const pending = await createRequest(alice, bourbon);
    expect((await call("/api/taster/tastings", "POST", note(bourbon, pending), alice)).status).toBe(403);
    expect((await call("/api/requests/" + pending + "/decline", "POST", undefined, admin)).status).toBe(200);
    expect((await call("/api/taster/tastings", "POST", note(bourbon, pending), alice)).status).toBe(403);

    const cancelled = await createRequest(alice, bourbon);
    expect((await call("/api/taster/requests/" + cancelled + "/cancel", "POST", undefined, alice)).status).toBe(200);
    expect((await call("/api/taster/tastings", "POST", note(bourbon, cancelled), alice)).status).toBe(403);

    const first = await createRequest(alice, bourbon);
    expect((await call("/api/requests/" + first + "/approve", "POST", { pour_ml: 30 }, admin)).status).toBe(200);
    expect((await call("/api/requests/" + first + "/approve", "POST", { pour_ml: 60 }, admin)).status).toBe(200);
    expect((raw.prepare("SELECT remaining_ml FROM bottles WHERE id = ?").get(bourbon) as { remaining_ml: number }).remaining_ml).toBe(720);

    expect((await call("/api/taster/tastings", "POST", note(bourbon, first), bob)).status).toBe(403);
    expect((await call("/api/taster/tastings", "POST", note(rye, first), alice)).status).toBe(403);
    expect((await call("/api/taster/tastings", "POST", note(bourbon, first), alice)).status).toBe(201);
    expect((await call("/api/taster/tastings", "POST", note(bourbon, first, 5), alice)).status).toBe(200);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM tastings WHERE request_id = ?").get(first) as { n: number }).n).toBe(1);

    const second = await createRequest(alice, bourbon);
    await call("/api/requests/" + second + "/approve", "POST", { pour_ml: 45 }, admin);
    expect((await call("/api/taster/tastings", "POST", note(bourbon, second, 3), alice)).status).toBe(201);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM tastings WHERE bottle_id = ? AND taster_id IS NOT NULL").get(bourbon) as { n: number }).n).toBe(2);

    const firstNote = raw.prepare("SELECT id FROM tastings WHERE request_id = ?").get(first) as { id: number };
    expect((await call("/api/taster/tastings/" + firstNote.id, "PATCH", { request_id: second }, alice)).status).toBe(403);
    expect((await call("/api/taster/tastings/" + firstNote.id, "PATCH", { bottle_id: rye }, alice)).status).toBe(403);
    expect((await call("/api/tastings", "POST", { bottle_id: bourbon, request_id: second, pour_ml: 30 }, admin)).status).toBe(400);

    const directory = await call("/api/tasters", "GET", undefined, admin);
    const data = await directory.json() as { tasters: { username: string; note_count: number }[] };
    expect(data.tasters.find((person) => person.username === "zero-notes")?.note_count).toBe(0);
  });

  it("reviews without writing, normalizes common spreadsheet values, then imports only after confirmation", async () => {
    const admin = await adminSession();
    await createBottle(admin, "Existing Bottle");
    const rows = [
      { name: "Existing Bottle", abv: "47%", purchase_price: "$49.99", remaining_pct: "50%", status: "open" },
      { name: "Existing Bottle", abv: "not a number" },
    ];
    const before = (raw.prepare("SELECT COUNT(*) AS n FROM bottles").get() as { n: number }).n;
    const reviewResponse = await call("/api/bottles/import/review", "POST", { bottles: rows }, admin);
    expect(reviewResponse.status).toBe(200);
    const review = await reviewResponse.json() as { ready: number; blocked: number; warnings: number; rows: { normalized: Json | null }[] };
    expect(review.ready).toBe(1);
    expect(review.blocked).toBe(1);
    expect(review.warnings).toBeGreaterThan(0);
    expect(review.rows[0].normalized?.abv).toBe(47);
    expect(review.rows[0].normalized?.purchase_price).toBe(49.99);
    expect(review.rows[0].normalized?.remaining_ml).toBe(375);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM bottles").get() as { n: number }).n).toBe(before);
    expect((await call("/api/bottles/import", "POST", { bottles: rows }, admin)).status).toBe(409);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM bottles").get() as { n: number }).n).toBe(before);

    const validRows = [rows[0], { name: "Existing Bottle", abv: "40%" }];
    expect((await call("/api/bottles/import", "POST", { bottles: validRows }, admin)).status).toBe(200);
    expect((raw.prepare("SELECT COUNT(*) AS n FROM bottles").get() as { n: number }).n).toBe(before + 2);
  });
});
