import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, type Db } from "./db";
import {
  cadenceJobs,
  cadenceTemplates,
  jobs,
  occurrences,
  plans,
  rituals,
  rotationItems,
  slots,
  type CadenceDefinition,
  type CadenceRotationItemDef,
  type CadenceStandaloneDef,
  type Slot,
} from "../db/schema";
import { addDaysISO, daysBetweenISO, derivePattern, firstMatchingDate, type Freq } from "./schedule";
import { getOwnedPlan, materializeSlotOccurrences } from "./planner";
import type { Env } from "./index";

type Session = { userId: string; teamId: string };

export const cadences = new Hono<{ Bindings: Env; Variables: { session: Session } }>();

function visibleTo(teamId: string) {
  return and(eq(cadenceTemplates.status, "published"), or(eq(cadenceTemplates.visibility, "public"), eq(cadenceTemplates.ownerTeamId, teamId)));
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "cadence"
  );
}

// ─── Gallery ────────────────────────────────────────────────────────────────

cadences.get("/cadences", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);

  const jobSlug = c.req.query("job");
  const discipline = c.req.query("discipline");
  const workMode = c.req.query("workMode");
  const teamSize = c.req.query("teamSize") ? parseInt(c.req.query("teamSize")!, 10) : undefined;
  const q = c.req.query("q")?.trim();

  const filters = [visibleTo(session.teamId)];
  if (discipline) filters.push(eq(cadenceTemplates.discipline, discipline));
  if (workMode) filters.push(eq(cadenceTemplates.workMode, workMode));
  if (teamSize !== undefined && !Number.isNaN(teamSize)) {
    filters.push(
      and(
        or(isNull(cadenceTemplates.teamSizeMin), lte(cadenceTemplates.teamSizeMin, teamSize)),
        or(isNull(cadenceTemplates.teamSizeMax), gte(cadenceTemplates.teamSizeMax, teamSize)),
      )!,
    );
  }
  if (q) {
    const term = `%${q.replace(/[%_]/g, (m) => "\\" + m)}%`;
    filters.push(or(sql`${cadenceTemplates.name} LIKE ${term}`, sql`${cadenceTemplates.summary} LIKE ${term}`)!);
  }

  let idFilter: number[] | null = null;
  if (jobSlug) {
    const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.slug, jobSlug)).limit(1);
    const tagged = job ? await db.select({ id: cadenceJobs.cadenceTemplateId }).from(cadenceJobs).where(eq(cadenceJobs.jobId, job.id)) : [];
    idFilter = tagged.map((t) => t.id);
    filters.push(inArray(cadenceTemplates.id, idFilter.length ? idFilter : [-1]));
  }

  const items = await db
    .select()
    .from(cadenceTemplates)
    .where(and(...filters))
    .orderBy(desc(cadenceTemplates.featured), desc(cadenceTemplates.cloneCount));

  return c.json({ items });
});

cadences.get("/cadences/:slug", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);

  const [item] = await db
    .select()
    .from(cadenceTemplates)
    .where(and(eq(cadenceTemplates.slug, c.req.param("slug")), visibleTo(session.teamId)))
    .limit(1);
  if (!item) return c.json({ error: "not found" }, 404);

  const tags = await db
    .select({ slug: jobs.slug, name: jobs.name })
    .from(cadenceJobs)
    .innerJoin(jobs, eq(jobs.id, cadenceJobs.jobId))
    .where(eq(cadenceJobs.cadenceTemplateId, item.id));

  return c.json({ item: { ...item, jobs: tags } });
});

// ─── Publish: plan -> template ──────────────────────────────────────────────
// The primary shareable unit is a whole cadence, not one ritual (PLAN.md §4).

interface StrippedRitual {
  slug: string;
  title: string;
}

async function buildDefinitionFromPlan(
  db: Db,
  plan: { id: string; startDate: string },
  targetVisibility: "team" | "public",
): Promise<{ definition: CadenceDefinition; stripped: StrippedRitual[] }> {
  const slotRows = await db.select().from(slots).where(eq(slots.planId, plan.id)).orderBy(asc(slots.createdAt));
  const rotationRows = slotRows.length
    ? await db.select().from(rotationItems).where(inArray(rotationItems.slotId, slotRows.map((s) => s.id))).orderBy(asc(rotationItems.position))
    : [];
  const standaloneRows = await db.select().from(occurrences).where(and(eq(occurrences.planId, plan.id), isNull(occurrences.slotId)));

  const ritualIds = [...new Set([...rotationRows.map((r) => r.ritualId), ...standaloneRows.map((o) => o.ritualId)].filter((id): id is number => id != null))];
  const ritualRows = ritualIds.length ? await db.select().from(rituals).where(inArray(rituals.id, ritualIds)) : [];
  const ritualById = new Map(ritualRows.map((r) => [r.id, r]));

  const stripped: StrippedRitual[] = [];
  // Publishing to the public gallery must never leak a private/team ritual's
  // content to a team that can't see it — the slug is dropped, and the
  // ritual's own title becomes a plain label so the *shape* of the cadence
  // (there was something here) survives even though the specifics don't.
  function resolveSlug(ritualId: number | null): { slug: string | null; fallbackLabel: string | null } {
    if (ritualId == null) return { slug: null, fallbackLabel: null };
    const ritual = ritualById.get(ritualId);
    if (!ritual) return { slug: null, fallbackLabel: null };
    if (targetVisibility === "public" && ritual.visibility !== "public") {
      stripped.push({ slug: ritual.slug, title: ritual.title });
      return { slug: null, fallbackLabel: ritual.title };
    }
    return { slug: ritual.slug, fallbackLabel: null };
  }

  const rotationBySlot = new Map<string, typeof rotationRows>();
  for (const r of rotationRows) rotationBySlot.set(r.slotId, [...(rotationBySlot.get(r.slotId) ?? []), r]);

  const defSlots = slotRows.map((slot) => {
    const { byweekday, nth } = derivePattern(slot.anchorDate, slot.freq as Freq);
    const rotation: CadenceRotationItemDef[] = (rotationBySlot.get(slot.id) ?? []).map((r) => {
      const { slug, fallbackLabel } = resolveSlug(r.ritualId);
      return { position: r.position, ritualSlug: slug, label: r.label ?? fallbackLabel };
    });
    return { name: slot.name, color: slot.color, freq: slot.freq as Freq, byweekday, nth, startTime: slot.startTime, durationMin: slot.durationMin, rotation };
  });

  const defStandalone: CadenceStandaloneDef[] = standaloneRows.map((occ) => {
    const { slug, fallbackLabel } = resolveSlug(occ.ritualId);
    const dayOffset = daysBetweenISO(plan.startDate, occ.date);
    const spanWeeks = occ.endDate ? Math.round((daysBetweenISO(occ.date, occ.endDate) + 1) / 7) : null;
    return { ritualSlug: slug, titleOverride: occ.titleOverride ?? fallbackLabel, dayOffset, spanWeeks };
  });

  return { definition: { slots: defSlots, standalone: defStandalone }, stripped };
}

cadences.post("/plans/:planId/publish", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  const body = await c
    .req.json<{ visibility?: "team" | "public"; name?: string; summary?: string; dryRun?: boolean }>()
    .catch(() => ({}) as Record<string, never>);

  const visibility = body.visibility === "public" ? "public" : "team";
  const name = body.name?.trim() || plan.name;
  const { definition, stripped } = await buildDefinitionFromPlan(db, plan, visibility);
  const durationWeeks = Math.ceil((daysBetweenISO(plan.startDate, plan.endDate) + 1) / 7);

  if (body.dryRun) {
    return c.json({ preview: { definition, stripped, durationWeeks } });
  }

  const slug = `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;
  // Public publishes land in the admin queue; a team keeping something to
  // itself needs no approval — only the public gallery is curated (PLAN.md §5.5).
  const status = visibility === "public" ? "pending" : "published";

  await db.insert(cadenceTemplates).values({
    slug,
    name,
    summary: body.summary?.trim() || null,
    visibility,
    status,
    ownerTeamId: session.teamId,
    originPlanId: plan.id,
    createdBy: session.userId,
    durationWeeks,
    definition,
  });

  const [item] = await db.select().from(cadenceTemplates).where(eq(cadenceTemplates.slug, slug)).limit(1);
  return c.json({ item, stripped }, 201);
});

// ─── Clone: template -> plan ────────────────────────────────────────────────

async function resolveRitualId(db: Db, slugOrNull: string | null, teamId: string): Promise<number | null> {
  if (!slugOrNull) return null;
  const [ritual] = await db
    .select({ id: rituals.id })
    .from(rituals)
    .where(and(eq(rituals.slug, slugOrNull), eq(rituals.status, "published"), or(eq(rituals.visibility, "public"), eq(rituals.ownerTeamId, teamId))))
    .limit(1);
  return ritual?.id ?? null;
}

cadences.post("/cadences/:id/clone", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);

  const [template] = await db
    .select()
    .from(cadenceTemplates)
    .where(and(eq(cadenceTemplates.id, id), visibleTo(session.teamId)))
    .limit(1);
  if (!template) return c.json({ error: "not found" }, 404);

  const body = await c.req.json<{ startDate?: string; name?: string; timezone?: string }>().catch(() => ({}) as Record<string, never>);
  if (!body.startDate) return c.json({ error: "startDate is required" }, 400);

  const startDate = body.startDate;
  const endDate = addDaysISO(startDate, template.durationWeeks * 7 - 1);
  const planId = crypto.randomUUID();

  await db.insert(plans).values({
    id: planId,
    teamId: session.teamId,
    name: body.name?.trim() || template.name,
    startDate,
    endDate,
    timezone: body.timezone ?? "UTC",
    fromTemplateId: template.id,
    createdBy: session.userId,
    icsToken: crypto.randomUUID(),
  });
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);

  const definition = template.definition;

  for (const slotDef of definition.slots) {
    // The anchor is reconstructed from the portable (byweekday, nth) pattern
    // — the exact inverse of derivePattern(), which is what publish used to
    // create this pattern in the first place.
    const anchorDate = firstMatchingDate(slotDef.freq, slotDef.byweekday, slotDef.nth, startDate);
    const slot: Slot = {
      id: crypto.randomUUID(),
      planId,
      name: slotDef.name,
      color: slotDef.color ?? null,
      freq: slotDef.freq,
      byweekday: slotDef.byweekday,
      nth: slotDef.nth ?? null,
      startTime: slotDef.startTime ?? null,
      durationMin: slotDef.durationMin ?? null,
      cycleLength: slotDef.rotation.length,
      anchorDate,
      activeFrom: null,
      activeTo: null,
      createdAt: "",
    };
    await db.insert(slots).values(slot);

    const rotationRows = [];
    for (const item of slotDef.rotation) {
      rotationRows.push({ slotId: slot.id, position: item.position, ritualId: await resolveRitualId(db, item.ritualSlug, session.teamId), label: item.label ?? null });
    }
    if (rotationRows.length) await db.insert(rotationItems).values(rotationRows);
    const insertedRotation = await db.select().from(rotationItems).where(eq(rotationItems.slotId, slot.id)).orderBy(asc(rotationItems.position));

    await materializeSlotOccurrences(db, plan, slot, insertedRotation, startDate, endDate);
  }

  for (const item of definition.standalone) {
    const date = addDaysISO(startDate, item.dayOffset);
    const ritualId = await resolveRitualId(db, item.ritualSlug, session.teamId);
    await db.insert(occurrences).values({
      id: crypto.randomUUID(),
      planId,
      slotId: null,
      ritualId,
      date,
      endDate: item.spanWeeks ? addDaysISO(date, item.spanWeeks * 7 - 1) : null,
      titleOverride: item.titleOverride ?? null,
      status: "planned",
      origin: "template",
    });
  }

  await db.update(cadenceTemplates).set({ cloneCount: template.cloneCount + 1 }).where(eq(cadenceTemplates.id, template.id));

  return c.json({ item: plan }, 201);
});
