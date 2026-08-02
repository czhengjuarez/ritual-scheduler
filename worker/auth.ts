import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { users, memberships } from "../db/schema";
import { verifyGoogleIdToken } from "./googleAuth";
import { SESSION_TTL_SEC, buildSessionCookie, createSessionToken } from "./session";
import type { Env } from "./index";

type Session = { userId: string; teamId: string };

/**
 * Google sign-in, layered on top of the existing anonymous session rather
 * than replacing it (PLAN.md §7). Mounted at /api/auth, so it still passes
 * through the /api/* middleware in index.ts — by the time these handlers
 * run, c.get("session") already names a real (if anonymous) user and team.
 *
 * Ported from TeamRitualAudit/src/auth/index.js (suite-auth-strategy
 * memory), adapted to this app's session shape: RitualBuilder keys identity
 * by userId/teamId rows, not a raw Google-profile cookie, so signing in just
 * upgrades who those ids point to and reuses the same rb_session cookie.
 */
export const auth = new Hono<{ Bindings: Env; Variables: { session: Session } }>();

auth.post("/session", async (c) => {
  // Fail closed — a missing secret must never silently degrade into an
  // unauthenticated or weakly-signed session.
  if (!c.env.SESSION_SECRET || !c.env.GOOGLE_CLIENT_ID) {
    return c.json({ error: "Authentication is not configured" }, 500);
  }

  const body = await c.req.json<{ credential?: string }>().catch(() => ({}) as Record<string, never>);
  if (!body.credential) return c.json({ error: "Missing credential" }, 400);

  let profile;
  try {
    profile = await verifyGoogleIdToken(body.credential, c.env.GOOGLE_CLIENT_ID);
  } catch (error) {
    // Log the reason, but don't hand it to the caller — it only helps an
    // attacker tune a forged token.
    console.warn("Rejected Google credential:", error instanceof Error ? error.message : error);
    return c.json({ error: "Sign-in failed" }, 401);
  }

  const db = getDb(c.env.DB);
  const session = c.get("session");
  const [existing] = await db.select().from(users).where(eq(users.googleSub, profile.sub)).limit(1);

  let userId: string;
  let teamId: string;

  if (existing) {
    // Returning Google user, possibly on a different browser/device than
    // last time — sign into their own team, not whatever anonymous team
    // this browser happened to have.
    userId = existing.id;
    const [membership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.userId, userId))
      .orderBy(asc(memberships.createdAt))
      .limit(1);
    teamId = membership?.teamId ?? session.teamId;
    await db.update(users).set({ email: profile.email, name: profile.name, avatarUrl: profile.picture }).where(eq(users.id, userId));
  } else {
    // First Google sign-in on this browser: claim the anonymous user/team
    // already behind this session instead of minting a new one, so nothing
    // already scheduled gets orphaned.
    userId = session.userId;
    teamId = session.teamId;
    await db
      .update(users)
      .set({ googleSub: profile.sub, email: profile.email, name: profile.name, avatarUrl: profile.picture })
      .where(eq(users.id, userId));
  }

  const token = await createSessionToken({ userId, teamId }, c.env.SESSION_SECRET);
  c.header("Set-Cookie", buildSessionCookie(token, SESSION_TTL_SEC));
  return c.json({ ok: true });
});

/**
 * Signing out clears the cookie outright rather than reverting to the prior
 * anonymous identity — the next /api/* request mints a brand new anonymous
 * user+team, so a shared/public browser can't keep acting as the signed-in
 * team's session after logout.
 */
auth.delete("/session", (c) => {
  c.header("Set-Cookie", buildSessionCookie("", 0));
  return c.json({ ok: true });
});
