/**
 * Google ID token verification for Cloudflare Workers.
 *
 * Ported from TeamRitualAudit/src/auth/google.js (PLAN.md §7) — kept
 * app-agnostic (WebCrypto + fetch only, no RitualBuilder imports) so it can
 * still move to a shared package once both apps use it unchanged (see
 * suite-auth-strategy memory).
 *
 * Verifies the RS256 signature against Google's published JWKS, then
 * validates the standard claims. Never trust a JWT payload that hasn't been
 * through verifyGoogleIdToken().
 */

const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const VALID_ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

/** Small allowance for clock skew between Google and the edge, in seconds. */
const CLOCK_SKEW_SEC = 60;

interface GoogleJwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

let jwksCache: { keys: GoogleJwk[]; expiresAt: number } | null = null;

function base64UrlToBytes(input: string): Uint8Array {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlToString(input: string): string {
  return new TextDecoder().decode(base64UrlToBytes(input));
}

/**
 * Fetch Google's signing keys, honouring the Cache-Control max-age they
 * send. `force` bypasses the cache — used once on a `kid` miss so key
 * rotation doesn't cause a window of failed sign-ins.
 */
async function fetchJwks(force = false): Promise<GoogleJwk[]> {
  const now = Date.now();
  if (!force && jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;

  const response = await fetch(GOOGLE_JWKS_URL);
  if (!response.ok) throw new Error(`Failed to fetch Google JWKS: ${response.status}`);

  const body = await response.json<{ keys: GoogleJwk[] }>();
  if (!Array.isArray(body.keys)) throw new Error("Malformed Google JWKS response");

  // Default to 1 hour if Google stops sending a usable max-age.
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control") || "")?.[1]) || 3600;
  jwksCache = { keys: body.keys, expiresAt: now + maxAge * 1000 };
  return body.keys;
}

async function findVerificationKey(kid: string): Promise<CryptoKey> {
  let keys = await fetchJwks();
  let jwk = keys.find((k) => k.kid === kid);

  if (!jwk) {
    // Unknown kid: Google may have rotated. Refetch once before giving up.
    keys = await fetchJwks(true);
    jwk = keys.find((k) => k.kid === kid);
  }
  if (!jwk) throw new Error("No matching Google signing key for token");

  return crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
}

export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
  picture: string;
  emailVerified: boolean;
}

/**
 * Verify a Google ID token and return its trusted claims.
 *
 * @param idToken raw JWT from Google Identity Services
 * @param expectedClientId the OAuth client ID this app accepts
 * @throws if the signature, issuer, audience, or expiry is invalid
 */
export async function verifyGoogleIdToken(idToken: string, expectedClientId: string): Promise<GoogleProfile> {
  if (!expectedClientId) throw new Error("GOOGLE_CLIENT_ID is not configured");
  if (typeof idToken !== "string") throw new Error("Missing credential");

  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed credential");
  const [headerB64, payloadB64, signatureB64] = parts;

  const header = JSON.parse(base64UrlToString(headerB64)) as { alg?: string; kid?: string };
  // Pin the algorithm. Accepting whatever the token asks for is how "alg:
  // none" and HMAC-confusion attacks get in.
  if (header.alg !== "RS256") throw new Error(`Unexpected token algorithm: ${header.alg}`);
  if (!header.kid) throw new Error("Credential has no key id");

  const key = await findVerificationKey(header.kid);
  const signatureValid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signatureB64),
    new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!signatureValid) throw new Error("Credential signature is invalid");

  const claims = JSON.parse(base64UrlToString(payloadB64)) as {
    iss?: string;
    aud?: string;
    exp?: number;
    iat?: number;
    sub?: string;
    email?: string;
    name?: string;
    picture?: string;
    email_verified?: boolean;
  };
  const now = Math.floor(Date.now() / 1000);

  if (!claims.iss || !VALID_ISSUERS.includes(claims.iss)) throw new Error(`Unexpected issuer: ${claims.iss}`);
  if (claims.aud !== expectedClientId) throw new Error("Credential was issued for a different app");
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_SEC < now) throw new Error("Credential has expired");
  if (typeof claims.iat === "number" && claims.iat - CLOCK_SKEW_SEC > now) throw new Error("Credential is not yet valid");
  if (!claims.sub) throw new Error("Credential has no subject");

  return {
    sub: claims.sub,
    email: claims.email || "",
    name: claims.name || claims.email || "Signed in",
    picture: claims.picture || "",
    emailVerified: claims.email_verified === true,
  };
}
