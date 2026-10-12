// Node entry point for the container build. Runs the exact same Hono API as the
// Cloudflare Worker (../worker/index.ts), backed by a local SQLite file instead
// of D1, and serves the built React app.

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import app from "../worker/index.ts";
import { D1Database } from "./d1.ts";

const here = dirname(fileURLToPath(import.meta.url));

const DB_PATH = resolve(process.env.DB_PATH ?? join(here, "data", "whiskey.db"));
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? join(here, "client"));
const MIGRATIONS_DIR = resolve(process.env.MIGRATIONS_DIR ?? join(here, "migrations"));
const PORT = Number(process.env.PORT ?? 3000);

// ---------------------------------------------------------------------------
// Database + migrations
// ---------------------------------------------------------------------------
mkdirSync(dirname(DB_PATH), { recursive: true });
const raw = new DatabaseSync(DB_PATH);
raw.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

raw.exec(
  `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`,
);
const applied = new Set(
  (raw.prepare("SELECT name FROM _migrations").all() as { name: string }[]).map((r) => r.name),
);
for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
  if (applied.has(file)) continue;
  raw.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  raw.prepare("INSERT INTO _migrations (name) VALUES (?)").run(file);
  console.log(`✓ migration ${file}`);
}

// ---------------------------------------------------------------------------
// Env passed to the Worker app (same shape as the Cloudflare bindings)
// ---------------------------------------------------------------------------
const env = {
  DB: new D1Database(raw),
  SESSION_SECRET: process.env.SESSION_SECRET,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  ACCESS_TEAM: process.env.ACCESS_TEAM,
  ACCESS_AUD: process.env.ACCESS_AUD,
};

// ---------------------------------------------------------------------------
// HTTP: /api/* -> Worker app, everything else -> built SPA (with SPA fallback)
// ---------------------------------------------------------------------------
const indexHtml = existsSync(join(STATIC_DIR, "index.html"))
  ? readFileSync(join(STATIC_DIR, "index.html"), "utf8")
  : "<!doctype html><h1>Front end not built</h1>";

const MIME: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".html": "text/html; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
};

const server = new Hono();

server.all("/api/*", (c) => {
  const req = c.req.raw;
  // Honour TLS terminated by a reverse proxy so session cookies get Secure.
  if (c.req.header("x-forwarded-proto") === "https") {
    const u = new URL(req.url);
    if (u.protocol === "http:") {
      u.protocol = "https:";
      return app.fetch(new Request(u, req), env);
    }
  }
  return app.fetch(req, env);
});

server.get("*", async (c) => {
  const pathname = decodeURIComponent(new URL(c.req.url).pathname);
  const rel = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const abs = resolve(STATIC_DIR, rel);
  if (abs === STATIC_DIR || abs.startsWith(STATIC_DIR + "/") || abs.startsWith(STATIC_DIR + "\\")) {
    try {
      if ((await stat(abs)).isFile()) {
        const ext = abs.slice(abs.lastIndexOf(".")).toLowerCase();
        const immutable = rel.startsWith("assets/");
        return c.body(new Uint8Array(await readFile(abs)), 200, {
          "content-type": MIME[ext] ?? "application/octet-stream",
          ...(immutable && { "cache-control": "public, max-age=31536000, immutable" }),
        });
      }
    } catch {
      /* fall through to the SPA */
    }
  }
  return c.html(indexHtml);
});

serve({ fetch: server.fetch, port: PORT, hostname: process.env.HOST }, (info) => {
  console.log(`Whiskey Cellar listening on http://localhost:${info.port}`);
  console.log(`  db:         ${DB_PATH}`);
  console.log(`  email code: ${env.RESEND_API_KEY ? "enabled" : "off (username/password only)"}`);
  console.log(
    `  access:     ${env.ACCESS_TEAM && env.ACCESS_AUD ? "trusting Cloudflare Access" : "off"}`,
  );
});
