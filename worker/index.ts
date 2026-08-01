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

export interface Env {
  DB: D1Database;
  // Present in production (Workers Static Assets); undefined in the Vite dev
  // simulator, where Vite's own dev server handles SPA routing instead.
  ASSETS?: Fetcher;
  SESSION_SECRET: string;

  // Later phases:
  // MEDIA: R2Bucket;                 -- Phase 8: covers, attachments, exports
  // AI: Ai;                          -- Phase 6: embeddings, suggestions
  // VECTORIZE: VectorizeIndex;       -- Phase 6: semantic search
  // ADMIN_PASSWORD: string;          -- Phase 5: admin gate
  // GOOGLE_CLIENT_ID: string;        -- Phase 6: Google sign-in (module ported
  //                                     from TeamRitualAudit/src/auth/)
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

/** Proves the D1 + Drizzle + session plumbing works end to end. */
app.get("/api/session", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const [team] = await db.select().from(teams).where(eq(teams.id, session.teamId)).limit(1);
  return c.json({ userId: session.userId, team });
});

app.route("/api", library);
app.route("/api", planner);

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
