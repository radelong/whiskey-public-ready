// Verifies a Cloudflare Access identity token (Cf-Access-Jwt-Assertion).
//
// When an Access application sits in front of this Worker, Cloudflare has
// already checked the user's identity (email one-time PIN, etc.) before the
// request reaches us. It forwards a signed JWT; we verify it so a request that
// skips Access (e.g. hitting the Worker some other way) can't forge one.

interface AccessClaims {
  email?: string;
  aud: string | string[];
  iss: string;
  exp: number;
}

function fromB64url(str: string): Uint8Array {
  let s = str.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeJson(part: string): any {
  return JSON.parse(new TextDecoder().decode(fromB64url(part)));
}

type JWK = { kid: string; kty: string; n: string; e: string };
let cache: { team: string; keys: JWK[]; at: number } | null = null;

async function certs(team: string): Promise<JWK[]> {
  if (cache && cache.team === team && Date.now() - cache.at < 3_600_000) return cache.keys;
  try {
    const res = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
    if (!res.ok) return cache?.keys ?? [];
    const data = (await res.json()) as { keys: JWK[] };
    cache = { team, keys: data.keys ?? [], at: Date.now() };
    return cache.keys;
  } catch {
    return cache?.keys ?? [];
  }
}

export async function verifyAccessJwt(
  token: string,
  team: string,
  aud: string,
): Promise<{ email: string | null } | null> {
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return null;

  let header: { alg?: string; kid?: string };
  let claims: AccessClaims;
  try {
    header = decodeJson(h);
    claims = decodeJson(p);
  } catch {
    return null;
  }

  if (header.alg !== "RS256" || !header.kid) return null;
  if (claims.iss !== `https://${team}.cloudflareaccess.com`) return null;
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud)) return null;
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return null;

  const jwk = (await certs(team)).find((k) => k.kid === header.kid);
  if (!jwk) return null;

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: jwk.kty, n: jwk.n, e: jwk.e },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      fromB64url(sig),
      new TextEncoder().encode(`${h}.${p}`),
    );
    return ok ? { email: claims.email ?? null } : null;
  } catch {
    return null;
  }
}
