import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { users, teams, memberships } from "../db/schema";
import {
  SESSION_COOKIE,
  SESSION_TTL_SEC,
  buildSessionCookie,
  createSessionToken,
  readCookie,
  verifySessionToken,
} from "./session";
import { library } from "./library";
import { planner } from "./planner";
import { cadences } from "./cadences";
import { ics } from "./ics";
import { admin } from "./admin";
import { adminAuth, adminAuthRoutes } from "./adminAuth";
import { ai, aiAdmin } from "./ai";
import { auth } from "./auth";

export interface Env {
  DB: D1Database;
  // Present in production (Workers Static Assets); undefined in the Vite dev
  // simulator, where Vite's own dev server handles SPA routing instead.
  ASSETS?: Fetcher;
  SESSION_SECRET: string;
  ADMIN_PASSWORD?: string;
  AI: Ai;
  VECTORIZE: VectorizeIndex;

  // Google sign-in (PLAN.md §7) — anonymous sessions are the default even
  // once these are set; AUTH_ENABLED is what actually surfaces the "Sign in"
  // UI, so a deploy can carry real credentials without switching behavior on.
  GOOGLE_CLIENT_ID?: string;
  AUTH_ENABLED?: string;

  // Later phases:
  // MEDIA: R2Bucket;                 -- Phase 8: covers, attachments, exports
}

type Session = { userId: string; teamId: string };

const app = new Hono<{ Bindings: Env; Variables: { session: Session } }>();

app.get("/api/health", (c) => c.json({ status: "ok", time: new Date().toISOString() }));

/**
 * Every request scoped under /api gets an identity: an existing signed
 * session, or a freshly created anonymous user + personal team. This is what
 * makes "every planner query is scoped by team_id from the session" possible
 * starting Phase 1 — the pattern exists before there is any data to scope
 * (PLAN.md §7).
 */
app.use("/api/*", async (c, next) => {
  const db = getDb(c.env.DB);
  const existing = await verifySessionToken(readCookie(c.req.raw, SESSION_COOKIE), c.env.SESSION_SECRET);

  if (existing) {
    c.set("session", { userId: existing.userId, teamId: existing.teamId });
    return next();
  }

  const userId = crypto.randomUUID();
  const teamId = crypto.randomUUID();

  await db.insert(users).values({ id: userId, role: "user" });
  await db.insert(teams).values({
    id: teamId,
    name: "My workspace",
    slug: `workspace-${teamId.slice(0, 8)}`,
    createdBy: userId,
  });
  await db.insert(memberships).values({ teamId, userId, role: "owner" });

  const token = await createSessionToken({ userId, teamId }, c.env.SESSION_SECRET);
  c.header("Set-Cookie", buildSessionCookie(token, SESSION_TTL_SEC));
  c.set("session", { userId, teamId });
  return next();
});

/**
 * The frontend's one call for "who am I" — anonymous or Google-linked alike,
 * plus whether sign-in is even switched on (AUTH_ENABLED), so the header can
 * decide whether to render a "Sign in" button at all.
 */
app.get("/api/session", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const [team] = await db.select().from(teams).where(eq(teams.id, session.teamId)).limit(1);
  const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);
  return c.json({
    userId: session.userId,
    team,
    user: user ? { name: user.name, email: user.email, avatarUrl: user.avatarUrl, role: user.role, signedIn: !!user.googleSub } : null,
    authEnabled: c.env.AUTH_ENABLED === "true",
  });
});

app.route("/api/auth", auth);
app.route("/api", library);
app.route("/api", planner);
app.route("/api", cadences);
app.route("/api", ai);

// Admin: password-gated (PLAN.md §7 — Cloudflare Access needs a custom
// domain this project doesn't have). Login/logout/session stay ungated;
// everything under /api/admin/* requires a valid admin session.
app.route("/api/admin-auth", adminAuthRoutes);
app.use("/api/admin/*", adminAuth);
app.route("/api/admin", admin);
app.route("/api/admin", aiAdmin);

// Public — outside /api on purpose, so it never hits the session middleware
// above. Calendar apps poll this with no cookie; the token in the URL is the
// only authorization (see worker/ics.ts).
app.route("/ics", ics);

/**
 * SPA fallback for client-routed pages (/plan, /cadences, /library, /admin).
 * Without this, Hono's own 404 would short-circuit before Cloudflare's
 * `not_found_handling: single-page-application` asset layer can serve
 * index.html, breaking direct navigation and refreshes on any non-root route.
 * In the Vite dev simulator ASSETS is undefined; Vite's own dev server
 * handles SPA routing there instead.
 */
app.get("*", (c) => (c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.notFound()));

export default app;
