import { Hono } from "hono";
import { and, asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "./db";
import { cadenceTemplates, categories, jobs, rituals } from "../db/schema";
import type { Env } from "./index";

export const admin = new Hono<{ Bindings: Env }>();

// ─── Cadence approval queue ─────────────────────────────────────────────────
// The primary queue (PLAN.md §5.5) — cadences, not individual rituals, are
// the thing this app is actually about publishing.

admin.get("/cadences", async (c) => {
  const db = getDb(c.env.DB);
  const status = c.req.query("status") ?? "pending";
  const items = await db.select().from(cadenceTemplates).where(eq(cadenceTemplates.status, status)).orderBy(asc(cadenceTemplates.createdAt));
  return c.json({ items });
});

admin.patch("/cadences/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const db = getDb(c.env.DB);
  const body = await c
    .req.json<Partial<{ name: string; summary: string | null; discipline: string | null; workMode: string | null; status: string; featured: boolean }>>()
    .catch(() => ({}) as Record<string, never>);

  const [row] = await db.update(cadenceTemplates).set(body).where(eq(cadenceTemplates.id, id)).returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: row });
});

admin.post("/cadences/:id/approve", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env.DB);
  const [row] = await db.update(cadenceTemplates).set({ status: "published" }).where(eq(cadenceTemplates.id, id)).returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: row });
});

admin.post("/cadences/:id/reject", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env.DB);
  const [row] = await db.update(cadenceTemplates).set({ status: "rejected" }).where(eq(cadenceTemplates.id, id)).returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: row });
});

// ─── Ritual approval queue + source verification ────────────────────────────
// Secondary queue (PLAN.md §5.5). Also doubles as the source-verification
// view: ?sourceVerified=false lists attributed rituals whose citation hasn't
// been checked yet (PLAN.md §6c) — unverified entries still publish, they're
// marked, not blocked, so this is a worklist, not a gate.

admin.get("/rituals", async (c) => {
  const db = getDb(c.env.DB);
  const status = c.req.query("status");
  const sourceVerified = c.req.query("sourceVerified");

  const filters = [];
  if (status) filters.push(eq(rituals.status, status));
  if (sourceVerified === "false") filters.push(eq(rituals.sourceVerified, false), isNotNull(rituals.sourceName));

  const items = await db
    .select()
    .from(rituals)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(rituals.createdAt));
  return c.json({ items });
});

admin.post("/rituals", async (c) => {
  const db = getDb(c.env.DB);
  const body = await c
    .req.json<{ title?: string; summary?: string; purpose?: string; categoryId?: number; engagement?: string; durationMin?: number; load?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.title?.trim()) return c.json({ error: "title required" }, 400);

  const slug = body.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const [row] = await db
    .insert(rituals)
    .values({
      slug: `${slug}-${crypto.randomUUID().slice(0, 6)}`,
      title: body.title.trim(),
      summary: body.summary ?? null,
      purpose: body.purpose ?? null,
      categoryId: body.categoryId ?? null,
      engagement: body.engagement ?? "session",
      durationMin: body.durationMin ?? null,
      load: body.load ?? "medium",
      visibility: "public",
      status: "published",
    })
    .returning();

  return c.json({ item: row }, 201);
});

admin.patch("/rituals/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const db = getDb(c.env.DB);
  const body = await c
    .req.json<
      Partial<{
        title: string;
        summary: string | null;
        purpose: string | null;
        categoryId: number | null;
        status: string;
        sourceVerified: boolean;
        sourceUrl: string | null;
      }>
    >()
    .catch(() => ({}) as Record<string, never>);

  const [row] = await db
    .update(rituals)
    .set({ ...body, updatedAt: sql`(current_timestamp)` })
    .where(eq(rituals.id, id))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: row });
});

admin.post("/rituals/:id/approve", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env.DB);
  const [row] = await db
    .update(rituals)
    .set({ status: "published", updatedAt: sql`(current_timestamp)` })
    .where(eq(rituals.id, id))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: row });
});

admin.post("/rituals/:id/reject", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env.DB);
  const [row] = await db
    .update(rituals)
    .set({ status: "rejected", updatedAt: sql`(current_timestamp)` })
    .where(eq(rituals.id, id))
    .returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: row });
});

admin.delete("/rituals/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env.DB);
  await db.delete(rituals).where(eq(rituals.id, id));
  return c.json({ success: true });
});

// ─── Categories CRUD ────────────────────────────────────────────────────────
// No reparent step needed on delete: rituals.category_id is declared
// ON DELETE SET NULL (db/schema.ts) — the categories here are a flat list,
// not design-resources' tree, so "no orphans" just means "falls back to
// uncategorized," which the FK already guarantees without extra code.

admin.get("/categories", async (c) => {
  const db = getDb(c.env.DB);
  const items = await db.select().from(categories).orderBy(asc(categories.sortOrder));
  return c.json({ items });
});

admin.post("/categories", async (c) => {
  const db = getDb(c.env.DB);
  const body = await c
    .req.json<{ name?: string; slug?: string; color?: string; icon?: string; description?: string; sortOrder?: number }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.name?.trim() || !body.slug?.trim()) return c.json({ error: "name and slug are required" }, 400);

  const [row] = await db
    .insert(categories)
    .values({ name: body.name.trim(), slug: body.slug.trim(), color: body.color ?? null, icon: body.icon ?? null, description: body.description ?? null, sortOrder: body.sortOrder ?? 0 })
    .returning();
  return c.json({ item: row }, 201);
});

admin.patch("/categories/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const db = getDb(c.env.DB);
  const body = await c
    .req.json<Partial<{ name: string; slug: string; color: string | null; icon: string | null; description: string | null; sortOrder: number }>>()
    .catch(() => ({}) as Record<string, never>);

  const [row] = await db.update(categories).set(body).where(eq(categories.id, id)).returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: row });
});

admin.delete("/categories/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env.DB);
  await db.delete(categories).where(eq(categories.id, id));
  return c.json({ success: true });
});

// ─── Jobs CRUD ──────────────────────────────────────────────────────────────
// Same "no orphans without extra code" story: ritual_jobs/cadence_jobs rows
// are ON DELETE CASCADE, so deleting a job just removes the tag, not the
// ritual or cadence it was tagging.

admin.get("/jobs", async (c) => {
  const db = getDb(c.env.DB);
  const items = await db.select().from(jobs).orderBy(asc(jobs.sortOrder));
  return c.json({ items });
});

admin.post("/jobs", async (c) => {
  const db = getDb(c.env.DB);
  const body = await c
    .req.json<{ slug?: string; name?: string; description?: string; icon?: string; sortOrder?: number; typicalSpan?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.slug?.trim() || !body.name?.trim()) return c.json({ error: "slug and name are required" }, 400);

  const [row] = await db
    .insert(jobs)
    .values({
      slug: body.slug.trim(),
      name: body.name.trim(),
      description: body.description ?? null,
      icon: body.icon ?? null,
      sortOrder: body.sortOrder ?? 0,
      typicalSpan: body.typicalSpan ?? "ongoing",
    })
    .returning();
  return c.json({ item: row }, 201);
});

admin.patch("/jobs/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  const db = getDb(c.env.DB);
  const body = await c
    .req.json<Partial<{ slug: string; name: string; description: string | null; icon: string | null; sortOrder: number; typicalSpan: string }>>()
    .catch(() => ({}) as Record<string, never>);

  const [row] = await db.update(jobs).set(body).where(eq(jobs.id, id)).returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ item: row });
});

admin.delete("/jobs/:id", async (c) => {
  const id = parseInt(c.req.param("id"), 10);
  const db = getDb(c.env.DB);
  await db.delete(jobs).where(eq(jobs.id, id));
  return c.json({ success: true });
});
