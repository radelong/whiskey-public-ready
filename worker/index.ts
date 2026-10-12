import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Context, MiddlewareHandler } from "hono";
import type {
  Bottle,
  BottleInput,
  BottleStatus,
  FlavorProfile,
  FlavorTag,
  RequestInput,
  TastingInput,
} from "../shared/types";
import {
  createSession,
  generateCode,
  getSessionSecret,
  hashCode,
  hashPassword,
  maskEmail,
  readSession,
  readToken,
  signToken,
  verifyPassword,
  type Session,
} from "./auth";
import { sendLoginCode } from "./email";
import { verifyAccessJwt } from "./access";
import { lookupBottles } from "./lookup";
import { reviewBottleImport } from "./import-review";
import { whiskyCastResultUrls, extractFlavorProfile, reviewMatchScore } from "./flavor-profiles";
import { FLAVOR_TAGS } from "../shared/flavors";
import { recommendWhiskeys } from "../shared/recommendations";
import { canonicalDistillery } from "../shared/distilleries";
import { distilleryWebsite, duckDuckGoUrl, externalResultUrl, standardBottleName, whiskybaseResultUrl } from "./external-links";

type Env = {
  DB: D1Database;
  SESSION_SECRET?: string; // optional override; normally auto-generated per deploy
  ADMIN_EMAIL?: string; // where the one-time login code is sent
  RESEND_API_KEY?: string; // set with `wrangler secret put` to enable email codes
  ACCESS_TEAM?: string; // Cloudflare Access team name (the <team>.cloudflareaccess.com subdomain)
  ACCESS_AUD?: string; // Access application AUD tag — both must be set to trust Access
  TASTER_SIGNUP_CODE?: string; // optional shared code required to create a taster account
};

type Taster = { id: number; username: string; display_name: string | null };
type AppEnv = { Bindings: Env; Variables: { session: Session; taster: Taster } };

const app = new Hono<AppEnv>();
const COOKIE = "wc_session";
const TASTER_COOKIE = "wc_taster";
const SESSION_DAYS = 30;
const CODE_TTL_MIN = 10;

const adminEmail = (env: Env) => (env.ADMIN_EMAIL || "").trim().toLowerCase();

// Browser state changes must originate from this deployment. Non-browser API
// callers without Origin still require the normal authentication checks.
app.use("/api/*", async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    if (c.req.header("Sec-Fetch-Site") === "cross-site" ||
        (origin && origin !== new URL(c.req.url).origin))
      return c.json({ error: "Cross-origin writes are not allowed" }, 403);
  }
  await next();
});

async function allowPasswordAttempt(c: Context<AppEnv>, lane: string, username: string): Promise<boolean> {
  const now = Date.now();
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${lane}:${username.trim().toLowerCase()}`));
  const key = Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, "0")).join("");
  await c.env.DB.prepare("DELETE FROM login_limits WHERE expires_at <= ?").bind(now).run();
  const row = await c.env.DB.prepare(
    "INSERT INTO login_limits (key, attempts, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET attempts = login_limits.attempts + 1 RETURNING attempts",
  ).bind(key, now + 15 * 60_000).first<{ attempts: number }>();
  return !!row && row.attempts <= 12;
}

/** Wrap every /api handler so DB errors return JSON, not an HTML 500. */
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: err.message || "Server error" }, 500);
});

// ---------------------------------------------------------------------------
// Auth — Cloudflare Access (if in front), else email one-time code / password
// ---------------------------------------------------------------------------
async function readAuth(c: Context<AppEnv>): Promise<Session | null> {
  // 1. Cloudflare Access already vetted the user before the request reached us.
  if (c.env.ACCESS_TEAM && c.env.ACCESS_AUD) {
    const jwt = c.req.header("Cf-Access-Jwt-Assertion");
    if (jwt) {
      const claims = await verifyAccessJwt(jwt, c.env.ACCESS_TEAM, c.env.ACCESS_AUD);
      if (claims) return { sub: claims.email ?? "access", via: "access" };
    }
  }
  // 2. our own session cookie (email code / password login)
  const secret = await getSessionSecret(c.env.DB, c.env.SESSION_SECRET);
  const session = await readSession(secret, getCookie(c, COOKIE));
  if (!session) return null;
  const current = await adminSessionVersion(c.env.DB);
  return (session.version ?? 0) === current ? session : null;
}

async function adminSessionVersion(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'admin_session_version'")
    .first<{ value: string }>();
  const version = Number(row?.value ?? 0);
  return Number.isSafeInteger(version) && version >= 0 ? version : 0;
}

async function setSessionCookie(c: Context<AppEnv>, session: Session) {
  const secret = await getSessionSecret(c.env.DB, c.env.SESSION_SECRET);
  const version = await adminSessionVersion(c.env.DB);
  const token = await createSession(secret, { ...session, version }, SESSION_DAYS);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

/** Route-level guard: attach to any endpoint that changes data. */
const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const session = await readAuth(c);
  if (!session) return c.json({ error: "Please log in" }, 401);
  c.set("session", session);
  await next();
};

function countUsers(env: Env): Promise<{ n: number } | null> {
  return env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
}

function validCredentials(username: unknown, password: unknown): string | null {
  if (typeof username !== "string" || username.trim().length < 3 || username.trim().length > 64)
    return "Username must be 3–64 characters";
  if (!/^[a-zA-Z0-9._-]+$/.test(username.trim()))
    return "Username can only contain letters, numbers, . _ -";
  if (typeof password !== "string" || password.length < 8 || password.length > 256)
    return "Password must be 8–256 characters";
  return null;
}

function sessionLabel(env: Env, s: Session): string {
  if (s.via === "email") return maskEmail(adminEmail(env));
  if (s.via === "access") return s.sub.includes("@") ? maskEmail(s.sub) : s.sub;
  return s.sub;
}

app.get("/api/auth/status", async (c) => {
  const [count, session] = await Promise.all([countUsers(c.env), readAuth(c)]);
  return c.json({
    configured: (count?.n ?? 0) > 0,
    emailLogin: !!(c.env.RESEND_API_KEY && adminEmail(c.env)),
    emailTo: maskEmail(adminEmail(c.env)),
    accessWall: !!(c.env.ACCESS_TEAM && c.env.ACCESS_AUD),
    authed: !!session,
    label: session ? sessionLabel(c.env, session) : null,
    via: session?.via ?? null,
  });
});

app.get("/api/auth/me", async (c) => {
  const session = await readAuth(c);
  return c.json({
    authed: !!session,
    label: session ? sessionLabel(c.env, session) : null,
    via: session?.via ?? null,
  });
});

// --- Email one-time code -----------------------------------------------------
app.post("/api/auth/request-code", async (c) => {
  if (!c.env.RESEND_API_KEY || !adminEmail(c.env))
    return c.json({ error: "Email sign-in isn't configured on this deployment yet." }, 503);

  const secret = await getSessionSecret(c.env.DB, c.env.SESSION_SECRET);

  // Rate limit: one code per 45s, at most 6 per hour.
  const recent = await c.env.DB.prepare(
    "SELECT COUNT(*) AS n, MAX(created_at) AS last FROM login_codes WHERE created_at > datetime('now','-1 hour')",
  ).first<{ n: number; last: string | null }>();
  if (recent?.last && Date.now() - Date.parse(recent.last + "Z") < 45_000)
    return c.json({ error: "Hold on — a code was just sent. Check your inbox." }, 429);
  if ((recent?.n ?? 0) >= 6)
    return c.json({ error: "Too many codes requested. Try again later." }, 429);

  const code = generateCode();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM login_codes WHERE created_at < datetime('now','-1 hour')"),
    c.env.DB.prepare(
      `INSERT INTO login_codes (code_hash, expires_at) VALUES (?, datetime('now', ?))`,
    ).bind(await hashCode(secret, code), `+${CODE_TTL_MIN} minutes`),
  ]);

  const sent = await sendLoginCode(c.env.RESEND_API_KEY, adminEmail(c.env), code);
  if (!sent.ok) {
    console.error("login code email failed:", sent.error);
    return c.json({ error: "Couldn't send the email. Try the password instead." }, 502);
  }
  return c.json({ ok: true, to: maskEmail(adminEmail(c.env)) });
});

app.post("/api/auth/verify-code", async (c) => {
  const { code } = (await c.req.json().catch(() => ({}))) as { code?: unknown };
  if (typeof code !== "string" || !/^\d{6}$/.test(code.trim()))
    return c.json({ error: "Enter the 6-digit code" }, 400);

  const secret = await getSessionSecret(c.env.DB, c.env.SESSION_SECRET);
  const row = await c.env.DB.prepare(
    "SELECT id, code_hash, attempts FROM login_codes WHERE expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
  ).first<{ id: number; code_hash: string; attempts: number }>();
  if (!row) return c.json({ error: "That code has expired. Request a new one." }, 400);

  if (row.attempts >= 5) {
    await c.env.DB.prepare("DELETE FROM login_codes WHERE id = ?").bind(row.id).run();
    return c.json({ error: "Too many wrong tries. Request a new code." }, 429);
  }

  const given = await hashCode(secret, code.trim());
  if (given !== row.code_hash) {
    await c.env.DB.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?")
      .bind(row.id)
      .run();
    return c.json({ error: "Wrong code." }, 401);
  }

  await c.env.DB.prepare("DELETE FROM login_codes").run();
  await setSessionCookie(c, { sub: "email", via: "email" });
  return c.json({ ok: true });
});

// --- Username + password (backup) ------------------------------------------
app.post("/api/auth/setup", async (c) => {
  const { username, password } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if ((await countUsers(c.env))?.n) return c.json({ error: "This deployment already has an account" }, 409);
  const bad = validCredentials(username, password);
  if (bad) return c.json({ error: bad }, 400);

  const hash = await hashPassword(password as string);
  const created = await c.env.DB.prepare("INSERT INTO users (username, password_hash) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM users) RETURNING id")
    .bind((username as string).trim(), hash)
    .first<{ id: number }>();
  if (!created) return c.json({ error: "This deployment already has an account" }, 409);
  await setSessionCookie(c, { sub: (username as string).trim(), via: "password" });
  return c.json({ ok: true, username: (username as string).trim() }, 201);
});

app.post("/api/auth/login", async (c) => {
  const { username, password } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string")
    return c.json({ error: "Enter a username and password" }, 400);
  if (username.length > 64 || password.length > 256)
    return c.json({ error: "Credentials exceed the allowed length" }, 400);
  if (!await allowPasswordAttempt(c, "admin", username))
    return c.json({ error: "Too many sign-in attempts; try again in 15 minutes" }, 429);
  const user = await c.env.DB.prepare(
    "SELECT username, password_hash FROM users WHERE username = ?",
  )
    .bind(username.trim())
    .first<{ username: string; password_hash: string }>();
  if (!user || !(await verifyPassword(password, user.password_hash)))
    return c.json({ error: "Wrong username or password" }, 401);
  await setSessionCookie(c, { sub: user.username, via: "password" });
  return c.json({ ok: true, username: user.username });
});

// Set / replace the backup username + password (must already be signed in).
app.post("/api/auth/credentials", requireAuth, async (c) => {
  const { username, password } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const bad = validCredentials(username, password);
  if (bad) return c.json({ error: bad }, 400);
  const hash = await hashPassword(password as string);
  const nextUsername = (username as string).trim();
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM users"),
    c.env.DB.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").bind(
      nextUsername,
      hash,
    ),
    c.env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_session_version', '0')"),
    c.env.DB.prepare("UPDATE settings SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'admin_session_version'"),
  ]);
  await setSessionCookie(c, { sub: nextUsername, via: "password" });
  return c.json({ ok: true });
});

app.post("/api/auth/logout", (c) => {
  setCookie(c, COOKIE, "", { path: "/", maxAge: 0 });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Taster accounts — guests who keep their own tasting notes (tasting.* site)
// ---------------------------------------------------------------------------
async function readTaster(c: Context<AppEnv>): Promise<Taster | null> {
  const secret = await getSessionSecret(c.env.DB, c.env.SESSION_SECRET);
  const t = await readToken<{ tid: number; version?: number }>(secret, getCookie(c, TASTER_COOKIE));
  if (!t?.tid) return null;
  return c.env.DB.prepare(
    "SELECT id, username, display_name FROM tasters WHERE id = ? AND session_version = ?",
  )
    .bind(t.tid, t.version ?? 0)
    .first<Taster>();
}

const requireTaster: MiddlewareHandler<AppEnv> = async (c, next) => {
  const taster = await readTaster(c);
  if (!taster) return c.json({ error: "Sign in to keep tasting notes" }, 401);
  c.set("taster", taster);
  await next();
};

function parseFlavorProfile(value: unknown): FlavorProfile | null {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const tags = new Set<string>(FLAVOR_TAGS);
  const profile: FlavorProfile = {};
  for (const [tag, strength] of Object.entries(raw)) {
    if (tags.has(tag) && Number.isInteger(strength) && Number(strength) >= 1 && Number(strength) <= 3)
      profile[tag as FlavorTag] = Number(strength) as 1 | 2 | 3;
  }
  return Object.keys(profile).length ? profile : null;
}

function validateFlavorProfile(value: unknown): string | null {
  if (value == null) return null;
  const parsed = parseFlavorProfile(value);
  if (!parsed || Object.keys(parsed).length !== Object.keys(value as object).length)
    return "Choose flavor tags and strengths from the provided list";
  return null;
}

async function setTasterCookie(c: Context<AppEnv>, tid: number) {
  const secret = await getSessionSecret(c.env.DB, c.env.SESSION_SECRET);
  const account = await c.env.DB.prepare("SELECT session_version FROM tasters WHERE id = ?")
    .bind(tid).first<{ session_version: number }>();
  setCookie(c, TASTER_COOKIE, await signToken(secret, { tid, version: account!.session_version }, SESSION_DAYS), {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS,
  });
}

app.get("/api/taster/me", async (c) => {
  const taster = await readTaster(c);
  return c.json({
    taster: taster
      ? { id: taster.id, username: taster.username, display_name: taster.display_name }
      : null,
    signupCodeRequired: !!c.env.TASTER_SIGNUP_CODE,
  });
});

app.post("/api/taster/register", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const { username, password, display_name, code } = body;
  if (c.env.TASTER_SIGNUP_CODE && String(code ?? "") !== c.env.TASTER_SIGNUP_CODE)
    return c.json({ error: "That sign-up code isn't right" }, 403);
  const bad = validCredentials(username, password);
  if (bad) return c.json({ error: bad }, 400);

  const exists = await c.env.DB.prepare("SELECT id FROM tasters WHERE username = ?")
    .bind((username as string).trim())
    .first();
  if (exists) return c.json({ error: "That username is taken" }, 409);

  const row = await c.env.DB.prepare(
    "INSERT INTO tasters (username, password_hash, display_name) VALUES (?, ?, ?) RETURNING id",
  )
    .bind(
      (username as string).trim(),
      await hashPassword(password as string),
      (typeof display_name === "string" && display_name.trim()) || (username as string).trim(),
    )
    .first<{ id: number }>();
  await setTasterCookie(c, row!.id);
  return c.json({ ok: true }, 201);
});

app.post("/api/taster/login", async (c) => {
  const { username, password } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof username !== "string" || typeof password !== "string")
    return c.json({ error: "Enter a username and password" }, 400);
  if (username.length > 64 || password.length > 256)
    return c.json({ error: "Credentials exceed the allowed length" }, 400);
  if (!await allowPasswordAttempt(c, "taster", username))
    return c.json({ error: "Too many sign-in attempts; try again in 15 minutes" }, 429);
  const t = await c.env.DB.prepare(
    "SELECT id, password_hash FROM tasters WHERE username = ?",
  )
    .bind(username.trim())
    .first<{ id: number; password_hash: string }>();
  if (!t || !(await verifyPassword(password, t.password_hash)))
    return c.json({ error: "Wrong username or password" }, 401);
  await setTasterCookie(c, t.id);
  return c.json({ ok: true });
});

app.post("/api/taster/logout", (c) => {
  setCookie(c, TASTER_COOKIE, "", { path: "/", maxAge: 0 });
  return c.json({ ok: true });
});

app.post("/api/taster/account", requireTaster, async (c) => {
  const { display_name, password } = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const me = c.get("taster");
  const changePassword = typeof password === "string" && password.length > 0;
  if (changePassword && ((password as string).length < 8 || (password as string).length > 256))
    return c.json({ error: "Password must be 8–256 characters" }, 400);
  if (typeof display_name === "string" && display_name.trim()) {
    if (changePassword) {
      await c.env.DB.prepare("UPDATE tasters SET display_name = ?, password_hash = ?, session_version = session_version + 1 WHERE id = ?")
        .bind(display_name.trim(), await hashPassword(password as string), me.id)
        .run();
    } else {
      await c.env.DB.prepare("UPDATE tasters SET display_name = ? WHERE id = ?")
        .bind(display_name.trim(), me.id)
        .run();
    }
  } else if (changePassword) {
    await c.env.DB.prepare("UPDATE tasters SET password_hash = ?, session_version = session_version + 1 WHERE id = ?")
      .bind(await hashPassword(password as string), me.id)
      .run();
  }
  if (changePassword) await setTasterCookie(c, me.id);
  return c.json({ ok: true });
});

// This taster's own notes
app.get("/api/taster/tastings", requireTaster, async (c) => {
  const me = c.get("taster");
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, b.name AS bottle_name, b.distillery, b.category,
            r.approved_at
       FROM tastings t JOIN bottles b ON b.id = t.bottle_id
       LEFT JOIN requests r ON r.id = t.request_id
      WHERE t.taster_id = ?
      ORDER BY t.created_at DESC`,
  )
    .bind(me.id)
    .all();
  const rated = (results as { rating: number | null }[]).filter((r) => r.rating != null);
  const avg = rated.length
    ? rated.reduce((s, r) => s + (r.rating as number), 0) / rated.length
    : null;
  return c.json({ tastings: results, count: results.length, avg_rating: avg });
});

app.get("/api/taster/recommendations", requireTaster, async (c) => {
  const me = c.get("taster");
  const [reviewRows, bottleRows] = await Promise.all([
    c.env.DB.prepare("SELECT bottle_id, rating FROM tastings WHERE taster_id = ? AND rating IS NOT NULL")
      .bind(me.id).all<{ bottle_id: number; rating: number }>(),
    c.env.DB.prepare(
      `SELECT b.*, (SELECT AVG(rating) FROM tastings WHERE bottle_id = b.id AND taster_id IS NOT NULL AND rating IS NOT NULL) AS avg_rating,
              (SELECT COUNT(rating) FROM tastings WHERE bottle_id = b.id AND taster_id IS NOT NULL AND rating IS NOT NULL) AS rating_count
         FROM bottles b WHERE b.archived_at IS NULL ORDER BY b.name`,
    ).all<Bottle>(),
  ]);
  const bottles = bottleRows.results.map((bottle) => ({ ...bottle, flavor_profile: parseFlavorProfile(bottle.flavor_profile) }));
  const recommendations = recommendWhiskeys(bottles, reviewRows.results).map(({ bottle, score, reasons }) => ({
    score,
    reasons,
    bottle: {
      id: bottle.id,
      name: bottle.name,
      distillery: bottle.distillery,
      category: bottle.category,
      age_years: bottle.age_years,
      abv: bottle.abv,
      size_ml: bottle.size_ml,
      status: bottle.status,
      photo_url: bottle.photo_url?.startsWith("data:image/") ? `/api/bottles/${bottle.id}/photo` : bottle.photo_url,
      flavor_profile: bottle.flavor_profile,
      flavor_source: bottle.flavor_source,
      flavor_source_url: bottle.flavor_source_url,
      avg_rating: bottle.avg_rating,
      rating_count: bottle.rating_count,
    },
  }));
  const ratedBottleIds = new Set(reviewRows.results.map((review) => review.bottle_id));
  return c.json({
    has_ratings: reviewRows.results.length > 0,
    profiled_bottles: bottles.filter((bottle) => bottle.flavor_profile && Object.keys(bottle.flavor_profile).length).length,
    profiled_reviews: bottles.filter((bottle) => ratedBottleIds.has(bottle.id) && bottle.flavor_profile && Object.keys(bottle.flavor_profile).length).length,
    recommendations,
  });
});

// This taster's requests and approved pours. A poured request is the approval
// record that can authorize exactly one guest-authored tasting.
app.get("/api/taster/requests", requireTaster, async (c) => {
  const me = c.get("taster");
  const bottleId = Number(c.req.query("bottle_id") ?? 0);
  const whereBottle = bottleId ? " AND r.bottle_id = ?" : "";
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, b.name AS bottle_name, t.id AS tasting_id
       FROM requests r
       JOIN bottles b ON b.id = r.bottle_id
       LEFT JOIN tastings t ON t.request_id = r.id AND t.taster_id = r.taster_id
      WHERE r.taster_id = ?${whereBottle}
      ORDER BY r.created_at DESC`,
  )
    .bind(...(bottleId ? [me.id, bottleId] : [me.id]))
    .all();
  return c.json(results);
});

async function eligibleApprovedRequest(
  c: Context<AppEnv>,
  requestId: number,
  tasterId: number,
  bottleId: number,
) {
  return c.env.DB.prepare(
    `SELECT id, bottle_id, taster_id, pour_ml, approved_at
       FROM requests
      WHERE id = ? AND taster_id = ? AND bottle_id = ?
        AND status = 'poured' AND approved_at IS NOT NULL
        AND cancelled_at IS NULL`,
  )
    .bind(requestId, tasterId, bottleId)
    .first<{ id: number; bottle_id: number; taster_id: number; pour_ml: number; approved_at: string }>();
}

function tastingValues(body: Record<string, unknown>) {
  const numeric = body.rating == null || body.rating === "" ? null : Number(body.rating);
  if (numeric != null && (!Number.isFinite(numeric) || numeric < 0 || numeric > 5)) {
    return { error: "Rating must be between 0 and 5" } as const;
  }
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    rating: numeric,
    nose: str(body.nose),
    palate: str(body.palate),
    finish: str(body.finish),
    notes: str(body.notes),
  };
}

app.post("/api/taster/tastings", requireTaster, async (c) => {
  const me = c.get("taster");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const bottleId = Number(body.bottle_id);
  const requestId = Number(body.request_id);
  if (!bottleId || !requestId)
    return c.json({ error: "An approved pour is required before adding tasting notes" }, 403);
  const approved = await eligibleApprovedRequest(c, requestId, me.id, bottleId);
  if (!approved)
    return c.json({ error: "This pour is not approved for your account and this whiskey" }, 403);

  const values = tastingValues(body);
  if ("error" in values) return c.json({ error: values.error }, 400);
  const existing = await c.env.DB.prepare(
    "SELECT id FROM tastings WHERE request_id = ? AND taster_id = ?",
  )
    .bind(requestId, me.id)
    .first<{ id: number }>();
  if (existing) {
    const row = await c.env.DB.prepare(
      `UPDATE tastings
          SET rating = ?, nose = ?, palate = ?, finish = ?, notes = ?
        WHERE id = ? AND taster_id = ? AND request_id = ? AND bottle_id = ?
        RETURNING *`,
    )
      .bind(
        values.rating,
        values.nose,
        values.palate,
        values.finish,
        values.notes,
        existing.id,
        me.id,
        requestId,
        bottleId,
      )
      .first();
    return c.json(row);
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO tastings
       (bottle_id, request_id, taster_id, taster_name, pour_ml, rating, nose, palate, finish, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      bottleId,
      requestId,
      me.id,
      me.display_name ?? me.username,
      approved.pour_ml,
      values.rating,
      values.nose,
      values.palate,
      values.finish,
      values.notes,
    )
    .first();
  return c.json(row, 201);
});

app.patch("/api/taster/tastings/:id", requireTaster, async (c) => {
  const me = c.get("taster");
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const existing = await c.env.DB.prepare(
    "SELECT id, bottle_id, request_id FROM tastings WHERE id = ? AND taster_id = ?",
  )
    .bind(c.req.param("id"), me.id)
    .first<{ id: number; bottle_id: number; request_id: number | null }>();
  if (!existing) return c.json({ error: "Not found" }, 404);
  if (
    (body.bottle_id !== undefined && Number(body.bottle_id) !== existing.bottle_id) ||
    (body.request_id !== undefined && Number(body.request_id) !== existing.request_id)
  )
    return c.json({ error: "A tasting cannot be transferred to another pour or whiskey" }, 403);
  if (
    existing.request_id != null &&
    !(await eligibleApprovedRequest(c, existing.request_id, me.id, existing.bottle_id))
  )
    return c.json({ error: "The approved pour for this tasting is no longer valid" }, 403);

  const fields = ["rating", "nose", "palate", "finish", "notes"] as const;
  const cols = fields.filter((f) => body[f] !== undefined);
  if (!cols.length) return c.json({ error: "nothing to update" }, 400);
  if (body.rating !== undefined) {
    const n = body.rating == null || body.rating === "" ? null : Number(body.rating);
    if (n != null && (!Number.isFinite(n) || n < 0 || n > 5))
      return c.json({ error: "Rating must be between 0 and 5" }, 400);
  }
  const values = cols.map((f) =>
    f === "rating"
      ? body[f] == null || body[f] === ""
        ? null
        : Number(body[f])
      : typeof body[f] === "string" && (body[f] as string).trim()
        ? (body[f] as string).trim()
        : null,
  );
  const row = await c.env.DB.prepare(
    `UPDATE tastings SET ${cols.map((f) => `${f} = ?`).join(", ")}
      WHERE id = ? AND taster_id = ? RETURNING *`,
  )
    .bind(...values, c.req.param("id"), me.id)
    .first();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.delete("/api/taster/tastings/:id", requireTaster, async (c) => {
  const me = c.get("taster");
  await c.env.DB.prepare("DELETE FROM tastings WHERE id = ? AND taster_id = ?")
    .bind(c.req.param("id"), me.id)
    .run();
  return c.body(null, 204);
});

// ---------------------------------------------------------------------------
// Online bottle lookup (for the Add Bottle form)
// ---------------------------------------------------------------------------
app.get("/api/lookup", requireAuth, async (c) => {
  const q = c.req.query("q") ?? "";
  return c.json({ candidates: await lookupBottles(q) });
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
app.get("/api/health", (c) => c.json({ ok: true, time: new Date().toISOString() }));

// ---------------------------------------------------------------------------
// Bottles
// ---------------------------------------------------------------------------
// The tasting catalog is available only to a signed-in taster or the admin.
// Tasters receive the public bottle view; the admin retains full inventory data.
app.get("/api/bottles", async (c) => {
  const [isAdmin, taster] = await Promise.all([readAuth(c), readTaster(c)]);
  if (!isAdmin && !taster) return c.json({ error: "Sign in to browse whiskeys" }, 401);

  const status = c.req.query("status"); // optional filter
  const q = status
    ? c.env.DB.prepare(
        `SELECT b.*,
                (SELECT AVG(rating) FROM tastings WHERE bottle_id = b.id AND taster_id IS NOT NULL AND rating IS NOT NULL) AS avg_rating,
                (SELECT COUNT(rating) FROM tastings WHERE bottle_id = b.id AND taster_id IS NOT NULL AND rating IS NOT NULL) AS rating_count
           FROM bottles b WHERE b.archived_at IS NULL AND b.status = ? ORDER BY b.name`,
      ).bind(status)
    : c.env.DB.prepare(
        `SELECT b.*,
                (SELECT AVG(rating) FROM tastings WHERE bottle_id = b.id AND taster_id IS NOT NULL AND rating IS NOT NULL) AS avg_rating,
                (SELECT COUNT(rating) FROM tastings WHERE bottle_id = b.id AND taster_id IS NOT NULL AND rating IS NOT NULL) AS rating_count
           FROM bottles b WHERE b.archived_at IS NULL ORDER BY b.status, b.name`,
      );
  const { results } = await q.all<Bottle>();
  const catalogRows = results.map((row) => ({
    ...row,
    flavor_profile: parseFlavorProfile(row.flavor_profile),
    photo_url: row.photo_url?.startsWith("data:image/") ? `/api/bottles/${row.id}/photo?v=${row.version}` : row.photo_url,
  }));
  if (isAdmin) return c.json(catalogRows);
  const PRIVATE = ["purchase_price", "purchase_date", "location", "notes", "barcode"];
  const publicView = catalogRows.map((row) =>
    Object.fromEntries(Object.entries({ ...row, flavor_profile: parseFlavorProfile(row.flavor_profile) }).filter(([k]) => !PRIVATE.includes(k))),
  );
  return c.json(publicView);
});

// Serve a stored data-URL image only when requested, rather than embedding it
// in every catalog response. The original photo_url remains unchanged in D1.
app.get("/api/bottles/:id/photo", async (c) => {
  const [isAdmin, taster] = await Promise.all([readAuth(c), readTaster(c)]);
  if (!isAdmin && !taster) return c.json({ error: "Sign in to view bottle photos" }, 401);
  const bottle = await c.env.DB.prepare("SELECT photo_url FROM bottles WHERE id = ?")
    .bind(c.req.param("id")).first<{ photo_url: string | null }>();
  if (!bottle?.photo_url) return c.body(null, 404);
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(bottle.photo_url);
  if (!match) return c.json({ error: "Unsupported stored image" }, 415);
  const binary = atob(match[2]);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new Response(bytes, { headers: {
    "Content-Type": `image/${match[1]}`,
    "Cache-Control": "private, max-age=60",
    "X-Content-Type-Options": "nosniff",
  }});
});

// Taster-only whiskey detail: bottle basics + community notes.
app.get("/api/whiskeys/:id", async (c) => {
  const [isAdmin, taster] = await Promise.all([readAuth(c), readTaster(c)]);
  if (!isAdmin && !taster) return c.json({ error: "Sign in to view whiskey details" }, 401);

  const b = await c.env.DB.prepare(
    "SELECT id, name, distillery, category, age_years, abv, size_ml, version, CASE WHEN archived_at IS NULL THEN status ELSE 'finished' END AS status, photo_url, flavor_profile, flavor_source, flavor_source_url FROM bottles WHERE id = ?",
  )
    .bind(c.req.param("id"))
    .first<Pick<Bottle, "id" | "name" | "distillery" | "category" | "age_years" | "abv" | "size_ml" | "version" | "status" | "photo_url"> & { flavor_profile: string | null; flavor_source: string | null; flavor_source_url: string | null }>();
  if (!b) return c.json({ error: "Not found" }, 404);
  const { results: notes } = await c.env.DB.prepare(
    `SELECT t.id, t.rating, t.nose, t.palate, t.finish, t.notes, t.created_at
       FROM tastings t
      WHERE t.bottle_id = ? AND t.taster_id IS NOT NULL AND (t.rating IS NOT NULL OR t.notes IS NOT NULL
            OR t.nose IS NOT NULL OR t.palate IS NOT NULL OR t.finish IS NOT NULL)
      ORDER BY t.created_at DESC LIMIT 50`,
  )
    .bind(c.req.param("id"))
    .all();
  const aggregate = await c.env.DB.prepare(
    "SELECT AVG(rating) AS avg_rating, COUNT(rating) AS rating_count FROM tastings WHERE bottle_id = ? AND taster_id IS NOT NULL AND rating IS NOT NULL",
  ).bind(c.req.param("id")).first<{ avg_rating: number | null; rating_count: number }>();
  return c.json({
    ...b,
    photo_url: b.photo_url?.startsWith("data:image/") ? `/api/bottles/${b.id}/photo?v=${b.version}` : b.photo_url,
    flavor_profile: parseFlavorProfile(b.flavor_profile),
    notes,
    avg_rating: aggregate?.avg_rating ?? null,
    rating_count: aggregate?.rating_count ?? 0,
  });
});

// External references used by the taster catalog. Resolve at click time so
// private picks can point to their closest standard release without storing a
// brittle, manually maintained catalog of third-party URLs.
app.get("/api/whiskybase/:id", async (c) => {
  const [isAdmin, taster] = await Promise.all([readAuth(c), readTaster(c)]);
  if (!isAdmin && !taster) return c.json({ error: "Sign in to browse whiskeys" }, 401);
  const bottle = await c.env.DB.prepare("SELECT name, distillery FROM bottles WHERE id = ?")
    .bind(c.req.param("id"))
    .first<{ name: string; distillery: string | null }>();
  if (!bottle) return c.json({ error: "Not found" }, 404);
  const standardName = standardBottleName(bottle.name);
  const query = `${bottle.distillery ?? ""} ${standardName} Whiskybase`.trim();
  try {
    const response = await fetch(duckDuckGoUrl(query), { headers: { "user-agent": "WhiskeyCellar/1.0" } });
    const url = whiskybaseResultUrl(await response.text());
    if (url) return c.redirect(url, 302);
  } catch {
    // Fall through to Whiskybase's own targeted search.
  }
  return c.redirect(`https://www.whiskybase.com/search?q=${encodeURIComponent(query)}`, 302);
});

app.get("/api/distillery-site/:name", async (c) => {
  const [isAdmin, taster] = await Promise.all([readAuth(c), readTaster(c)]);
  if (!isAdmin && !taster) return c.json({ error: "Sign in to browse whiskeys" }, 401);
  const name = c.req.param("name").trim();
  if (!name) return c.json({ error: "Not found" }, 404);
  const directUrl = distilleryWebsite(name);
  if (directUrl) return c.redirect(directUrl, 302);
  const query = `${name} distillery official website`;
  try {
    const response = await fetch(duckDuckGoUrl(query), { headers: { "user-agent": "WhiskeyCellar/1.0" } });
    const url = externalResultUrl(await response.text());
    if (url) return c.redirect(url, 302);
  } catch {
    // Fall through to a normal search only if no main site can be resolved.
  }
  return c.redirect(`https://www.google.com/search?q=${encodeURIComponent(query)}`, 302);
});

app.post("/api/bottles/:id/flavor-lookup", requireAuth, async (c) => {
  const id = c.req.param("id");
  const bottle = await c.env.DB.prepare("SELECT name, distillery, flavor_profile FROM bottles WHERE id = ? AND archived_at IS NULL")
    .bind(id).first<{ name: string; distillery: string | null; flavor_profile: string | null }>();
  if (!bottle) return c.json({ error: "Bottle not found" }, 404);
  const { persist = false } = await c.req.json().catch(() => ({})) as { persist?: unknown };
  if (persist === true && bottle.flavor_profile) return c.json({ found: false, skipped: true, reason: "already-profiled" });

  const query = `${bottle.distillery ?? ""} ${standardBottleName(bottle.name)}`.trim();
  try {
    const signal = AbortSignal.timeout(15_000);
    const searchUrl = new URL("https://whiskycast.com/wp-json/wp/v2/search");
    searchUrl.searchParams.set("search", query);
    searchUrl.searchParams.set("per_page", "30");
    searchUrl.searchParams.set("type", "post");
    searchUrl.searchParams.set("subtype", "ratings");
    const searchResponse = await fetch(searchUrl, {
      signal,
      headers: { "user-agent": "WhiskeyCellar/1.0", accept: "application/json" },
    });
    if (!searchResponse.ok) return c.json({ found: false, reason: "search-unavailable" });
    let candidates = whiskyCastResultUrls(await searchResponse.json());
    const score = (candidate: string) => reviewMatchScore(candidate, standardBottleName(bottle.name), bottle.distillery);
    if (!candidates.some((candidate) => score(candidate) > 0) && bottle.distillery) {
      searchUrl.searchParams.set("search", standardBottleName(bottle.name));
      const fallback = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json", "user-agent": "WhiskeyCellar/1.0" } });
      if (fallback.ok) candidates = [...candidates, ...whiskyCastResultUrls(await fallback.json())];
    }
    const url = candidates.filter((candidate) => score(candidate) > 0).sort((a, b) => score(b) - score(a))[0];
    if (!url)
      return c.json({ found: false, reason: "review-match-not-confident" });
    const reviewResponse = await fetch(url, {
      signal: AbortSignal.timeout(8_000),
      headers: { "user-agent": "WhiskeyCellar/1.0", accept: "text/html" },
      redirect: "manual",
    });
    if (!reviewResponse.ok || !["whiskycast.com", "www.whiskycast.com"].includes(new URL(reviewResponse.url || url).hostname))
      return c.json({ found: false, reason: "review-unavailable" });
    const profile = extractFlavorProfile((await reviewResponse.text()).slice(0, 2_000_000));
    if (!Object.keys(profile).length) return c.json({ found: false, reason: "no-structured-notes" });
    if (persist === true) {
      const result = await c.env.DB.prepare(
        `UPDATE bottles SET flavor_profile = ?, flavor_source = 'WhiskyCast', flavor_source_url = ?,
             flavor_updated_at = datetime('now'), version = version + 1, updated_at = datetime('now')
          WHERE id = ? AND flavor_profile IS NULL AND archived_at IS NULL`,
      ).bind(JSON.stringify(profile), url, id).run();
      if (!result.meta.changes) return c.json({ found: false, skipped: true, reason: "already-profiled" });
    }
    return c.json({ found: true, flavor_profile: profile, flavor_source: "WhiskyCast", flavor_source_url: url });
  } catch {
    return c.json({ found: false, reason: "lookup-failed" });
  }
});

app.get("/api/bottles/:id", requireAuth, async (c) => {
  const bottle = await c.env.DB.prepare("SELECT * FROM bottles WHERE id = ?")
    .bind(c.req.param("id"))
    .first<Bottle>();
  if (!bottle) return c.json({ error: "Not found" }, 404);
  const { results: tastings } = await c.env.DB.prepare(
    "SELECT * FROM tastings WHERE bottle_id = ? ORDER BY created_at DESC",
  )
    .bind(bottle.id)
    .all();
  return c.json({ ...bottle, flavor_profile: parseFlavorProfile(bottle.flavor_profile), tastings });
});

const BOTTLE_FIELDS = [
  "name",
  "distillery",
  "category",
  "age_years",
  "abv",
  "size_ml",
  "purchase_date",
  "purchase_price",
  "status",
  "remaining_ml",
  "location",
  "notes",
  "photo_url",
  "barcode",
  "source_url",
  "flavor_profile",
  "flavor_source",
  "flavor_source_url",
] as const;

app.post("/api/bottles", requireAuth, async (c) => {
  const body = (await c.req.json()) as BottleInput;
  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  const validation = validateBottleValues({
    size_ml: body.size_ml ?? 750,
    abv: body.abv ?? null,
    remaining_ml: body.remaining_ml ?? null,
    status: body.status ?? "sealed",
  });
  if (validation) return c.json({ error: validation }, 400);
  const profileError = validateFlavorProfile(body.flavor_profile);
  if (profileError) return c.json({ error: profileError }, 400);

  const cols = BOTTLE_FIELDS.filter((f) => body[f] !== undefined);
  const placeholders = cols.map(() => "?").join(", ");
  const values = cols.map((f) => f === "distillery"
    ? canonicalDistillery(body.distillery)
    : f === "flavor_profile"
      ? body.flavor_profile == null ? null : JSON.stringify(body.flavor_profile)
      : body[f] ?? null);

  const row = await c.env.DB.prepare(
    `INSERT INTO bottles (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`,
  )
    .bind(...values)
    .first<Bottle>();
  return c.json(row ? { ...row, flavor_profile: parseFlavorProfile(row.flavor_profile) } : row, 201);
});

async function importRows(c: Context<AppEnv>) {
  const body = (await c.req.json().catch(() => null)) as { bottles?: unknown } | null;
  const rows = Array.isArray(body?.bottles) ? (body!.bottles as Record<string, unknown>[]) : null;
  if (!rows) return { error: "Expected a JSON body like { bottles: [ ... ] }" } as const;
  if (rows.length === 0) return { error: "No rows to import" } as const;
  if (rows.length > 1000) return { error: "Import at most 1000 rows at a time" } as const;
  return { rows };
}

async function reviewRows(c: Context<AppEnv>, rows: Record<string, unknown>[]) {
  const { results } = await c.env.DB.prepare("SELECT name, distillery FROM bottles").all<Bottle>();
  return reviewBottleImport(rows, results);
}

app.post("/api/bottles/import/review", requireAuth, async (c) => {
  const parsed = await importRows(c);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  return c.json(await reviewRows(c, parsed.rows));
});

app.post("/api/bottles/import", requireAuth, async (c) => {
  const parsed = await importRows(c);
  if ("error" in parsed) return c.json({ error: parsed.error }, 400);
  const review = await reviewRows(c, parsed.rows);
  if (review.blocked)
    return c.json(
      { error: "Correct every blocked row and review the CSV again before importing.", review },
      409,
    );

  const statements = review.rows.map((row) => {
    const record = row.normalized!;
    const keys = Object.keys(record);
    return c.env.DB.prepare(
      `INSERT INTO bottles (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
    ).bind(...keys.map((key) => record[key]));
  });
  for (let i = 0; i < statements.length; i += 50)
    await c.env.DB.batch(statements.slice(i, i + 50));
  return c.json({ inserted: statements.length, skipped: 0, errors: [], warnings: review.warnings });
});

function validateBottleValues(values: {
  size_ml: unknown;
  abv: unknown;
  remaining_ml: unknown;
  status: unknown;
}): string | null {
  if (!Number.isInteger(values.size_ml) || Number(values.size_ml) < 1 || Number(values.size_ml) > 100_000)
    return "Bottle size must be a positive whole number of millilitres";
  if (values.abv !== null && (!Number.isFinite(values.abv) || Number(values.abv) < 0 || Number(values.abv) > 100))
    return "ABV must be between 0 and 100, or left blank";
  if (values.remaining_ml !== null &&
      (!Number.isInteger(values.remaining_ml) || Number(values.remaining_ml) < 0 || Number(values.remaining_ml) > Number(values.size_ml)))
    return "Remaining volume must be between 0 and the bottle size";
  if (!["sealed", "open", "finished"].includes(String(values.status)))
    return "Choose a valid bottle status";
  if (values.status === "open" && values.remaining_ml === 0)
    return "An empty bottle must be marked finished";
  if (values.status === "finished" && values.remaining_ml !== null && values.remaining_ml !== 0)
    return "A finished bottle cannot have remaining volume";
  return null;
}

app.patch("/api/bottles/:id", requireAuth, async (c) => {
  const body = (await c.req.json()) as Partial<BottleInput> & { expected_version?: unknown };
  const cols = BOTTLE_FIELDS.filter((f) => body[f] !== undefined);
  if (cols.length === 0) return c.json({ error: "nothing to update" }, 400);
  const profileError = body.flavor_profile === undefined ? null : validateFlavorProfile(body.flavor_profile);
  if (profileError) return c.json({ error: profileError }, 400);
  if (!Number.isSafeInteger(body.expected_version) || Number(body.expected_version) < 0)
    return c.json({ error: "Reload this bottle before saving changes" }, 400);

  const id = c.req.param("id");
  const current = await c.env.DB.prepare(
    "SELECT size_ml, abv, remaining_ml, status, version FROM bottles WHERE id = ?",
  ).bind(id).first<{ size_ml: number; abv: number | null; remaining_ml: number | null; status: BottleStatus; version: number }>();
  if (!current) return c.json({ error: "Not found" }, 404);
  if (current.version !== body.expected_version)
    return c.json({ error: "This bottle changed while you were editing it. Reload and review the latest amount before saving." }, 409);
  const validation = validateBottleValues({
    size_ml: body.size_ml !== undefined ? body.size_ml : current.size_ml,
    abv: body.abv !== undefined ? body.abv : current.abv,
    remaining_ml: body.remaining_ml !== undefined ? body.remaining_ml : current.remaining_ml,
    status: body.status !== undefined ? body.status : current.status,
  });
  if (validation) return c.json({ error: validation }, 400);

  const setClause = cols.map((f) => `${f} = ?`).join(", ");
  const values = cols.map((f) => f === "distillery"
    ? canonicalDistillery(body.distillery)
    : f === "flavor_profile"
      ? body.flavor_profile == null ? null : JSON.stringify(body.flavor_profile)
      : body[f] ?? null);

  const flavorUpdate = cols.includes("flavor_profile") ? ", flavor_updated_at = datetime('now')" : "";
  const row = await c.env.DB.prepare(
    `UPDATE bottles SET ${setClause}${flavorUpdate}, version = version + 1, updated_at = datetime('now')
      WHERE id = ? AND version = ? RETURNING *`,
  )
    .bind(...values, id, body.expected_version)
    .first<Bottle>();
  if (!row) return c.json({ error: "This bottle changed while you were editing it. Reload and review the latest amount before saving." }, 409);
  return c.json({ ...row, flavor_profile: parseFlavorProfile(row.flavor_profile) });
});

app.delete("/api/bottles/:id", requireAuth, async (c) => {
  await c.env.DB.prepare("UPDATE bottles SET archived_at = COALESCE(archived_at, datetime('now')), version = version + 1, updated_at = datetime('now') WHERE id = ?")
    .bind(c.req.param("id")).run();
  return c.body(null, 204);
});

/** Open a sealed bottle: set status + fill remaining_ml. */
app.post("/api/bottles/:id/open", requireAuth, async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE bottles
       SET status = 'open',
            remaining_ml = COALESCE(remaining_ml, size_ml),
            version = version + 1,
           updated_at = datetime('now')
     WHERE id = ? RETURNING *`,
  )
    .bind(c.req.param("id"))
    .first<Bottle>();
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

// ---------------------------------------------------------------------------
// Requests (guest asks for a pour)
// ---------------------------------------------------------------------------
app.get("/api/requests", requireAuth, async (c) => {
  const status = c.req.query("status") ?? "pending";
  const { results } = await c.env.DB.prepare(
    `SELECT r.*, b.name AS bottle_name,
            COALESCE(ta.display_name, ta.username, r.requester_name) AS requester_name
       FROM requests r
       LEFT JOIN bottles b ON b.id = r.bottle_id
       LEFT JOIN tasters ta ON ta.id = r.taster_id
      WHERE r.status = ? AND r.cancelled_at IS NULL
      ORDER BY r.created_at`,
  )
    .bind(status)
    .all();
  return c.json(results);
});

app.post("/api/requests", requireTaster, async (c) => {
  const me = c.get("taster");
  const body = (await c.req.json()) as RequestInput;
  const bottleId = Number(body.bottle_id);
  if (!bottleId) return c.json({ error: "Pick a bottle" }, 400);
  const bottle = await c.env.DB.prepare(
    "SELECT id FROM bottles WHERE id = ? AND archived_at IS NULL AND status != 'finished'",
  )
    .bind(bottleId)
    .first();
  if (!bottle) return c.json({ error: "That bottle is not available" }, 404);

  const row = await c.env.DB.prepare(
    `INSERT INTO requests (bottle_id, bottle_text, requester_name, note, taster_id)
     VALUES (?, NULL, ?, ?, ?) RETURNING *`,
  )
    .bind(
      bottleId,
      me.display_name ?? me.username,
      body.note?.trim() ?? null,
      me.id,
    )
    .first();
  return c.json(row, 201);
});

app.post("/api/requests/:id/decline", requireAuth, async (c) => {
  const row = await c.env.DB.prepare(
    `UPDATE requests SET status = 'declined', resolved_at = datetime('now')
      WHERE id = ? AND status = 'pending' AND cancelled_at IS NULL RETURNING *`,
  )
    .bind(c.req.param("id"))
    .first();
  if (!row) return c.json({ error: "Only a pending request can be declined" }, 409);
  return c.json(row);
});

app.post("/api/taster/requests/:id/cancel", requireTaster, async (c) => {
  const me = c.get("taster");
  const row = await c.env.DB.prepare(
    `UPDATE requests SET cancelled_at = datetime('now'), resolved_at = datetime('now')
      WHERE id = ? AND taster_id = ? AND status = 'pending' AND cancelled_at IS NULL
      RETURNING *`,
  )
    .bind(c.req.param("id"), me.id)
    .first();
  if (!row) return c.json({ error: "Only your pending request can be cancelled" }, 409);
  return c.json(row);
});

const POUR_SIZES = new Set([15, 30, 45, 60]);

// In the existing Bar workflow, approving and pouring are one action. The
// inventory_deducted_at guard makes retries and repeated clicks idempotent.
app.post("/api/requests/:id/approve", requireAuth, async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const pour = Number(body.pour_ml ?? 30);
  if (!POUR_SIZES.has(pour)) return c.json({ error: "Pour must be 15, 30, 45, or 60 ml" }, 400);
  const request = await c.env.DB.prepare("SELECT * FROM requests WHERE id = ?")
    .bind(c.req.param("id"))
    .first<Record<string, unknown>>();
  if (!request) return c.json({ error: "Request not found" }, 404);
  if (request.cancelled_at || request.status === "declined")
    return c.json({ error: "This request is no longer pending" }, 409);
  if (!request.bottle_id) return c.json({ error: "The request has no bottle" }, 400);
  // Historical poured requests already deducted inventory in the previous workflow.
  if (request.status === "poured") return c.json(request);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE requests
          SET status = 'poured', pour_ml = ?, approved_at = COALESCE(approved_at, datetime('now')),
              resolved_at = COALESCE(resolved_at, datetime('now'))
        WHERE id = ? AND status = 'pending' AND cancelled_at IS NULL
          AND EXISTS (SELECT 1 FROM bottles b WHERE b.id = requests.bottle_id AND b.archived_at IS NULL AND b.status != 'finished' AND COALESCE(b.remaining_ml, b.size_ml) >= ?)`,
    ).bind(pour, c.req.param("id"), pour),
    c.env.DB.prepare(
      `UPDATE bottles
          SET remaining_ml = MAX(COALESCE(remaining_ml, size_ml) - ?, 0),
              status = CASE
                         WHEN COALESCE(remaining_ml, size_ml) - ? <= 0 THEN 'finished'
                         ELSE 'open'
                       END,
              version = version + 1, updated_at = datetime('now')
        WHERE id = ?
          AND archived_at IS NULL AND status != 'finished' AND COALESCE(remaining_ml, size_ml) >= ?
          AND EXISTS (
            SELECT 1 FROM requests
             WHERE id = ? AND status = 'poured' AND inventory_deducted_at IS NULL AND bottle_id = bottles.id
          )`,
    ).bind(pour, pour, request.bottle_id, pour, c.req.param("id")),
    c.env.DB.prepare(
      `UPDATE requests SET inventory_deducted_at = datetime('now')
        WHERE id = ? AND status = 'poured' AND inventory_deducted_at IS NULL AND changes() > 0`,
    ).bind(c.req.param("id")),
  ]);

  const row = await c.env.DB.prepare(
    `SELECT r.*, b.name AS bottle_name,
            COALESCE(ta.display_name, ta.username, r.requester_name) AS requester_name
       FROM requests r
       LEFT JOIN bottles b ON b.id = r.bottle_id
       LEFT JOIN tasters ta ON ta.id = r.taster_id
      WHERE r.id = ?`,
  )
    .bind(c.req.param("id"))
    .first();
  if (!row || !row.inventory_deducted_at) return c.json({ error: "This bottle no longer has enough volume for that pour" }, 409);
  return c.json(row);
});

// ---------------------------------------------------------------------------
// Tastings (a logged pour, optionally with notes/rating)
// ---------------------------------------------------------------------------
app.get("/api/tastings", requireAuth, async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT t.*, b.name AS bottle_name
       FROM tastings t JOIN bottles b ON b.id = t.bottle_id
      ORDER BY t.created_at DESC
      LIMIT 200`,
  ).all();
  return c.json(results);
});

// Admin: every taster's ratings + notes, plus a per-taster summary.
app.post("/api/tasters/:id/reset-password", requireAuth, async (c) => {
  const { password } = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  if (typeof password !== "string" || password.length < 8 || password.length > 256)
    return c.json({ error: "Use a password between 8 and 256 characters" }, 400);
  const row = await c.env.DB.prepare(
    "UPDATE tasters SET password_hash = ?, session_version = session_version + 1 WHERE id = ? RETURNING id",
  ).bind(await hashPassword(password), c.req.param("id")).first();
  if (!row) return c.json({ error: "Taster not found" }, 404);
  return c.json({ ok: true });
});

app.get("/api/tasters", requireAuth, async (c) => {
  const [{ results: tasters }, { results: notes }] = await Promise.all([
    c.env.DB.prepare(
      `SELECT ta.id, ta.username, ta.display_name, ta.created_at,
              COUNT(t.id) AS note_count,
              AVG(t.rating) AS avg_rating,
              MAX(t.created_at) AS last_at
         FROM tasters ta
         LEFT JOIN tastings t ON t.taster_id = ta.id
        GROUP BY ta.id
        ORDER BY ta.display_name COLLATE NOCASE, ta.username COLLATE NOCASE`,
    ).all(),
    c.env.DB.prepare(
      `SELECT t.id, t.taster_id, t.bottle_id, t.rating, t.nose, t.palate, t.finish,
              t.notes, t.created_at,
              b.name AS bottle_name, b.distillery, b.category,
              COALESCE(ta.display_name, ta.username) AS taster
         FROM tastings t
         JOIN tasters ta ON ta.id = t.taster_id
         JOIN bottles b ON b.id = t.bottle_id
        ORDER BY t.created_at DESC`,
    ).all(),
  ]);
  return c.json({ tasters, notes });
});

// Admin: remove any tasting (e.g. a bad taster note).
app.delete("/api/tastings/:id", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM tastings WHERE id = ?").bind(c.req.param("id")).run();
  return c.body(null, 204);
});

app.post("/api/tastings", requireAuth, async (c) => {
  const body = (await c.req.json()) as TastingInput;
  if (!body.bottle_id) return c.json({ error: "bottle_id is required" }, 400);
  if (body.request_id)
    return c.json({ error: "Approve guest requests through the request endpoint" }, 400);
  const pour = Number(body.pour_ml ?? 30);
  if (!POUR_SIZES.has(pour)) return c.json({ error: "Pour must be 15, 30, 45, or 60 ml" }, 400);
  const rating = body.rating == null ? null : Number(body.rating);
  if (rating != null && (!Number.isFinite(rating) || rating < 0 || rating > 5))
    return c.json({ error: "Rating must be between 0 and 5" }, 400);
  const bottle = await c.env.DB.prepare(
    "SELECT id FROM bottles WHERE id = ? AND archived_at IS NULL AND status != 'finished' AND COALESCE(remaining_ml, size_ml) >= ?",
  )
    .bind(body.bottle_id, pour)
    .first();
  if (!bottle) return c.json({ error: "That bottle is not available" }, 409);

  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(
      `UPDATE bottles
          SET remaining_ml = MAX(COALESCE(remaining_ml, size_ml) - ?, 0),
              status = CASE WHEN COALESCE(remaining_ml, size_ml) - ? <= 0 THEN 'finished' ELSE 'open' END,
              version = version + 1, updated_at = datetime('now')
        WHERE id = ? AND archived_at IS NULL AND status != 'finished' AND COALESCE(remaining_ml, size_ml) >= ?`,
    ).bind(pour, pour, body.bottle_id, pour),
    c.env.DB.prepare(
      `INSERT INTO tastings
         (bottle_id, request_id, taster_name, pour_ml, rating, nose, palate, finish, notes)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
    ).bind(
      body.bottle_id,
      body.request_id ?? null,
      body.taster_name?.trim() ?? null,
      pour,
      rating,
      body.nose?.trim() ?? null,
      body.palate?.trim() ?? null,
      body.finish?.trim() ?? null,
      body.notes?.trim() ?? null,
    ),
  ];

  const results = await c.env.DB.batch(statements);
  if (!results[0]?.meta?.changes) return c.json({ error: "That bottle no longer has enough volume for this pour" }, 409);
  return c.json({ ok: true }, 201);
});

// ---------------------------------------------------------------------------
// Stats for the dashboard
// ---------------------------------------------------------------------------
app.get("/api/stats", requireAuth, async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT
       COUNT(*)                                             AS total_bottles,
       COUNT(*) FILTER (WHERE status = 'sealed')            AS sealed,
       COUNT(*) FILTER (WHERE status = 'open')              AS open,
       COUNT(*) FILTER (WHERE status = 'finished')          AS finished,
       COALESCE(SUM(purchase_price), 0)                     AS total_spent
     FROM bottles WHERE archived_at IS NULL`,
  ).first();
  return c.json(row);
});

// Anything else under /api that we didn't define
app.all("/api/*", (c) => c.json({ error: "Unknown endpoint" }, 404));

export default app;
