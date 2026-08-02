import { Hono } from "hono";
import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { categories, jobs, ritualJobs, rituals } from "../db/schema";
import type { Env } from "./index";

type Session = { userId: string; teamId: string };

export const library = new Hono<{ Bindings: Env; Variables: { session: Session } }>();

/**
 * Every ritual query is scoped by the caller's team, even though nobody can
 * create team/private rituals yet (that lands in Phase 4-5). Public rituals
 * are always visible; team/private ones only to their owning team. Writing
 * this now, while it's a no-op for seeded data, is cheaper than retrofitting
 * it once real team-owned rows exist (PLAN.md §7).
 */
function visibleTo(teamId: string) {
  return or(eq(rituals.visibility, "public"), eq(rituals.ownerTeamId, teamId));
}

library.get("/categories", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(categories).orderBy(asc(categories.sortOrder));
  return c.json({ items: rows });
});

library.get("/jobs", async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(jobs).orderBy(asc(jobs.sortOrder));
  return c.json({ items: rows });
});

const ALLOWED_LOADS = new Set(["light", "medium", "heavy"]);
const ALLOWED_ENGAGEMENTS = new Set(["session", "recurring", "series", "campaign"]);

/**
 * GET /api/rituals
 * Query params: job (slug), category (slug), q (title/summary search),
 * load, engagement, page, limit.
 *
 * This doubles as the picker's data source (PLAN.md §5.4) — filters are
 * chosen to match how someone chooses a ritual for a slot: by intent (job),
 * by how heavy it is, by how long it runs, not by browsing an alphabetical list.
 */
library.get("/rituals", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);

  const jobSlug = c.req.query("job");
  const categorySlug = c.req.query("category");
  const q = c.req.query("q")?.trim();
  const load = c.req.query("load");
  const engagement = c.req.query("engagement");
  const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query("limit") ?? "48", 10) || 48));
  const offset = (page - 1) * limit;

  const filters = [eq(rituals.status, "published"), visibleTo(session.teamId)];

  if (categorySlug) {
    const [cat] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, categorySlug)).limit(1);
    filters.push(eq(rituals.categoryId, cat?.id ?? -1));
  }

  if (load && ALLOWED_LOADS.has(load)) filters.push(eq(rituals.load, load));
  if (engagement && ALLOWED_ENGAGEMENTS.has(engagement)) filters.push(eq(rituals.engagement, engagement));

  if (q) {
    const term = `%${q.replace(/[%_]/g, (m) => "\\" + m)}%`;
    filters.push(or(like(rituals.title, term), like(rituals.summary, term))!);
  }

  let ritualIdFilter: number[] | null = null;
  if (jobSlug) {
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.slug, jobSlug)).limit(1);
    const tagged = job ? await db.select({ ritualId: ritualJobs.ritualId }).from(ritualJobs).where(eq(ritualJobs.jobId, job.id)) : [];
    ritualIdFilter = tagged.map((t) => t.ritualId);
    filters.push(inArray(rituals.id, ritualIdFilter.length ? ritualIdFilter : [-1]));
  }

  const where = and(...filters);

  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(rituals).where(where);

  const items = await db
    .select()
    .from(rituals)
    .where(where)
    .orderBy(asc(rituals.title))
    .limit(limit)
    .offset(offset);

  return c.json({ items, total, page, limit, hasMore: offset + items.length < total });
});

library.get("/rituals/:slug", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const slug = c.req.param("slug");

  const [item] = await db
    .select()
    .from(rituals)
    .where(and(eq(rituals.slug, slug), eq(rituals.status, "published"), visibleTo(session.teamId)))
    .limit(1);

  if (!item) return c.json({ error: "not found" }, 404);

  const tags = await db
    .select({ slug: jobs.slug, name: jobs.name, weight: ritualJobs.weight })
    .from(ritualJobs)
    .innerJoin(jobs, eq(jobs.id, ritualJobs.jobId))
    .where(eq(ritualJobs.ritualId, item.id));

  return c.json({ item: { ...item, jobs: tags } });
});

// ─── Contribution: team-instant, public is a second step ──────────────────
// "Adding a missing ritual is a small inline form — it lands as a
// team-visibility ritual immediately; publishing publicly is an optional
// second step" (PLAN.md §5.4). Team visibility needs no approval queue;
// only the public gallery is curated.

const MIN_FILL_TIME_MS = 3_000;

/**
 * Spam mitigation copied from design-resources' public suggestion form
 * (PLAN.md §5.5): a hidden honeypot field real users never fill, plus a
 * timing check rejecting submissions faster than a human could plausibly
 * complete the form. Both failure modes return a generic success so an
 * automated submitter can't learn to adapt and probe for the real check.
 * This applies here, not just to a "public suggestion" form, because every
 * visitor already has a session (PLAN.md §7) — there is no logged-out vs.
 * logged-in distinction yet that would otherwise gate this endpoint.
 */
function looksLikeSpam(body: { honeypot?: string; renderedAt?: number }): boolean {
  return !!body.honeypot?.trim() || typeof body.renderedAt !== "number" || Date.now() - body.renderedAt < MIN_FILL_TIME_MS;
}

library.post("/rituals", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const body = await c
    .req.json<{
      title?: string;
      summary?: string;
      purpose?: string;
      categoryId?: number;
      engagement?: string;
      durationMin?: number;
      load?: string;
      jobSlugs?: string[];
      honeypot?: string;
      renderedAt?: number;
    }>()
    .catch(() => ({}) as Record<string, never>);

  const title = body.title?.trim();
  if (!title) return c.json({ error: "title is required" }, 400);

  if (looksLikeSpam(body)) {
    // Pretend success — don't reveal the check to whatever submitted this.
    return c.json({ ok: true }, 201);
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const engagement = ALLOWED_ENGAGEMENTS.has(body.engagement ?? "") ? body.engagement! : "session";
  const load = ALLOWED_LOADS.has(body.load ?? "") ? body.load! : "medium";

  const [item] = await db
    .insert(rituals)
    .values({
      slug: `${slug}-${crypto.randomUUID().slice(0, 6)}`,
      title,
      summary: body.summary?.trim() || null,
      purpose: body.purpose?.trim() || null,
      categoryId: body.categoryId ?? null,
      engagement,
      durationMin: body.durationMin ?? null,
      load,
      visibility: "team",
      status: "published", // team visibility needs no approval
      ownerTeamId: session.teamId,
      createdBy: session.userId,
    })
    .returning();

  if (body.jobSlugs?.length) {
    const matchedJobs = await db.select({ id: jobs.id }).from(jobs).where(inArray(jobs.slug, body.jobSlugs));
    if (matchedJobs.length) await db.insert(ritualJobs).values(matchedJobs.map((j) => ({ ritualId: item.id, jobId: j.id, weight: 1 })));
  }

  return c.json({ item }, 201);
});

/** Requests public review for a ritual this team already owns — the ritual itself enters the admin queue, same as a cadence publish. */
library.post("/rituals/:id/request-public", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const [ritual] = await db.select().from(rituals).where(and(eq(rituals.id, id), eq(rituals.ownerTeamId, session.teamId))).limit(1);
  if (!ritual) return c.json({ error: "not found" }, 404);
  if (ritual.visibility === "public") return c.json({ item: ritual });

  const [updated] = await db
    .update(rituals)
    .set({ visibility: "public", status: "pending", updatedAt: sql`(current_timestamp)` })
    .where(eq(rituals.id, id))
    .returning();
  return c.json({ item: updated });
});
