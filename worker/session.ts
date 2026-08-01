/**
 * Anonymous session cookies.
 *
 * Every visitor gets a signed session bound to an auto-created "personal
 * workspace" team, so the app is fully usable before auth exists (PLAN.md §7).
 * When Google sign-in lands in Phase 6, first sign-in claims this team rather
 * than discarding it — which is why `userId`/`teamId` here become real rows
 * in `users`/`teams`, not throwaway values.
 *
 * The signing approach (HMAC-SHA256 over a base64url payload, WebCrypto only)
 * mirrors TeamRitualAudit/src/auth/session.ts so both apps can eventually
 * share one session implementation once identity is unified.
 */

export const SESSION_COOKIE = "rb_session";
export const SESSION_TTL_SEC = 400 * 24 * 60 * 60; // long-lived: this cookie *is* the anonymous identity

export interface SessionPayload {
  userId: string;
  teamId: string;
  exp: number;
}

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(payload: { userId: string; teamId: string }, secret: string): Promise<string> {
  const body: SessionPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SEC };
  const encoded = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(body)));
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

/** Returns null for missing, tampered, or expired sessions — never throws. */
export async function verifySessionToken(token: string | null, secret: string): Promise<SessionPayload | null> {
  try {
    if (!token || !secret) return null;
    const [encoded, signature] = token.split(".");
    if (!encoded || !signature) return null;

    const key = await importHmacKey(secret);
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(signature),
      new TextEncoder().encode(encoded),
    );
    if (!valid) return null;

    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(encoded))) as SessionPayload;
    if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (!payload.userId || !payload.teamId) return null;

    return payload;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

export function buildSessionCookie(value: string, maxAge: number): string {
  return [`${SESSION_COOKIE}=${value}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax", `Max-Age=${maxAge}`].join(
    "; ",
  );
}
