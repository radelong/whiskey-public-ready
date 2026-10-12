// Auth for a self-hosted deployment: the first visitor creates the one admin
// account (username + password), stored in D1. Later visits log in against it.
// Sessions are stateless HMAC-signed cookies; the signing secret is generated
// once per deployment and kept in the `settings` table.

const enc = new TextEncoder();
const PBKDF2_ITERS = 100_000;

// ---------------------------------------------------------------------------
// base64url helpers
// ---------------------------------------------------------------------------
function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64url(str: string): Uint8Array {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Constant-time compare so a wrong password/secret can't be timed. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2-SHA256)
// ---------------------------------------------------------------------------
async function pbkdf2(password: string, salt: Uint8Array, iters: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: iters },
    key,
    256,
  );
  return b64url(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERS);
  return `pbkdf2$${PBKDF2_ITERS}$${b64url(salt)}$${hash}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, itersStr, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2") return false;
  const hash = await pbkdf2(password, fromB64url(saltB64), Number(itersStr));
  return safeEqual(hash, hashB64);
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export interface Session {
  /** who: a username, "email" (one-time code), or the email from Cloudflare Access */
  sub: string;
  /** how they signed in */
  via: "password" | "email" | "access";
  /** Admin session generation; incremented when backup credentials change. */
  version?: number;
}

export async function createSession(
  secret: string,
  session: Session,
  days = 30,
): Promise<string> {
  const payload = b64url(
    enc.encode(JSON.stringify({ ...session, exp: Date.now() + days * 86_400_000 })),
  );
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function readSession(
  secret: string,
  token: string | undefined | null,
): Promise<Session | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(sig),
      enc.encode(payload),
    );
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    if (typeof data.sub !== "string") return null;
    return {
      sub: data.sub,
      via: data.via === "email" ? "email" : "password",
      version: Number.isSafeInteger(data.version) && data.version >= 0 ? data.version : 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generic signed token (used for taster sessions)
// ---------------------------------------------------------------------------
export async function signToken(
  secret: string,
  data: Record<string, unknown>,
  days = 30,
): Promise<string> {
  const payload = b64url(
    enc.encode(JSON.stringify({ ...data, exp: Date.now() + days * 86_400_000 })),
  );
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload));
  return `${payload}.${b64url(sig)}`;
}

export async function readToken<T = Record<string, unknown>>(
  secret: string,
  token: string | undefined | null,
): Promise<T | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromB64url(sig),
      enc.encode(payload),
    );
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    if (typeof data.exp !== "number" || data.exp < Date.now()) return null;
    return data as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// One-time login codes (6 digits, short-lived)
// ---------------------------------------------------------------------------
export function generateCode(): string {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
  return n.toString().padStart(6, "0");
}

/** SHA-256(secret + code) hex — good enough for a 6-digit code that lives 10 min. */
export async function hashCode(secret: string, code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(`${secret}:${code}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function maskEmail(email: string): string {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}${"•".repeat(Math.max(1, name.length - head.length))}@${domain}`;
}

// ---------------------------------------------------------------------------
// Per-deployment signing secret (generated once, stored in `settings`)
// ---------------------------------------------------------------------------
let cachedSecret: string | null = null;

export async function getSessionSecret(db: D1Database, override?: string): Promise<string> {
  if (override) return override;
  if (cachedSecret) return cachedSecret;
  const row = await db
    .prepare("SELECT value FROM settings WHERE key = 'session_secret'")
    .first<{ value: string }>();
  if (row?.value) return (cachedSecret = row.value);
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  await db
    .prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('session_secret', ?)")
    .bind(secret)
    .run();
  const confirmed = await db
    .prepare("SELECT value FROM settings WHERE key = 'session_secret'")
    .first<{ value: string }>();
  return (cachedSecret = confirmed?.value ?? secret);
}
