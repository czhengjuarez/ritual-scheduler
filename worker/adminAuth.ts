import type { Context, Next } from "hono";
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env } from "./index";

/**
 * Built-in admin authentication — ported from design-resources/worker/auth.ts
 * (PLAN.md §7), same reasoning: /api/admin/* is gated by a single shared
 * password (the ADMIN_PASSWORD secret) rather than Cloudflare Access, which
 * needs a custom domain (zone) for path-scoped applications that
 * *.workers.dev doesn't have. A signed, httpOnly session cookie carries a
 * short-lived, tamper-proof expiry; the HMAC key is derived from the
 * password itself so no second secret is needed.
 *
 * This is deliberately separate from worker/session.ts's anonymous team
 * session — an admin isn't a team, and the two cookies never interact.
 *
 * Setup: wrangler secret put ADMIN_PASSWORD
 */

const SESSION_COOKIE = "admin_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function bytesToB64Url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const str = atob(s);
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}

async function signingKey(env: Env): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.ADMIN_PASSWORD ?? ""));
  return crypto.subtle.importKey("raw", digest, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createSessionToken(env: Env): Promise<string> {
  const payload = bytesToB64Url(new TextEncoder().encode(JSON.stringify({ exp: Date.now() + SESSION_DURATION_MS })));
  const sig = bytesToB64Url(await crypto.subtle.sign("HMAC", await signingKey(env), new TextEncoder().encode(payload)));
  return `${payload}.${sig}`;
}

async function verifySessionToken(token: string, env: Env): Promise<boolean> {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return false;
  const valid = await crypto.subtle.verify("HMAC", await signingKey(env), b64UrlToBytes(sig), new TextEncoder().encode(payload));
  if (!valid) return false;
  try {
    const { exp } = JSON.parse(new TextDecoder().decode(b64UrlToBytes(payload))) as { exp: number };
    return typeof exp === "number" && exp > Date.now();
  } catch {
    return false;
  }
}

/** Constant-time string comparison — avoids leaking the password via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/** Gate for /api/admin/* — requires a valid session cookie. */
export async function adminAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (token && (await verifySessionToken(token, c.env))) {
    return next();
  }
  return c.json({ error: "Unauthorized" }, 401);
}

/** Public — login, logout, session check. Mounted at /api/admin-auth, outside the adminAuth gate. */
export const adminAuthRoutes = new Hono<{ Bindings: Env }>();

adminAuthRoutes.post("/login", async (c) => {
  if (!c.env.ADMIN_PASSWORD) {
    return c.json({ error: "ADMIN_PASSWORD not configured" }, 500);
  }

  const { password } = await c.req.json<{ password?: string }>().catch(() => ({}) as { password?: string });
  if (!password || !timingSafeEqual(password, c.env.ADMIN_PASSWORD)) {
    return c.json({ error: "Incorrect password" }, 401);
  }

  setCookie(c, SESSION_COOKIE, await createSessionToken(c.env), {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DURATION_MS / 1000,
  });
  return c.json({ ok: true });
});

adminAuthRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

adminAuthRoutes.get("/session", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const authenticated = !!token && (await verifySessionToken(token, c.env));
  return c.json({ authenticated });
});
