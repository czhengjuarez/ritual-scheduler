import { Hono } from "hono";
import { and, asc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { getDb, type Db } from "./db";
import { occurrences, plans, reflections, rituals, rotationItems, slots, type Plan, type Slot, type RotationItem, type Ritual } from "../db/schema";
import { deriveByweekday, generateSlotDates, todayISO, weekBucket, daysBetweenISO, addDaysISO, type Freq } from "./schedule";
import { buildSingleEventIcs } from "./ics";
import type { Env } from "./index";

type Session = { userId: string; teamId: string };

export const planner = new Hono<{ Bindings: Env; Variables: { session: Session } }>();

// ─── Ownership helpers ──────────────────────────────────────────────────────
// Every lookup goes through the caller's team, even keyed by slot/occurrence
// id directly — tenancy is enforced at the data layer, not just at the /plans
// entry point (PLAN.md §7).

export async function getOwnedPlan(db: Db, planId: string, teamId: string): Promise<Plan | null> {
  const [plan] = await db.select().from(plans).where(and(eq(plans.id, planId), eq(plans.teamId, teamId))).limit(1);
  return plan ?? null;
}

async function getOwnedSlot(db: Db, slotId: string, teamId: string): Promise<{ slot: Slot; plan: Plan } | null> {
  const [row] = await db.select({ slot: slots, plan: plans }).from(slots).innerJoin(plans, eq(plans.id, slots.planId)).where(and(eq(slots.id, slotId), eq(plans.teamId, teamId))).limit(1);
  return row ?? null;
}

async function getOwnedOccurrence(db: Db, occurrenceId: string, teamId: string) {
  const [row] = await db.select({ occurrence: occurrences, plan: plans }).from(occurrences).innerJoin(plans, eq(plans.id, occurrences.planId)).where(and(eq(occurrences.id, occurrenceId), eq(plans.teamId, teamId))).limit(1);
  return row ?? null;
}

// ─── Occurrence generation ──────────────────────────────────────────────────

/**
 * D1 caps the number of bound parameters per statement well below plain
 * SQLite's default — a single INSERT for a full year of weekly occurrences
 * (~52 rows x 9 columns) blows past it. Every multi-row query here goes
 * through this in batches instead of one large statement.
 */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Inserts only occurrences that don't already exist at (slotId, date) — never overwrites. */
export async function materializeSlotOccurrences(db: Db, plan: Plan, slot: Slot, rotation: RotationItem[], from: string, to: string) {
  if (from > to) return;
  // slot.freq is validated to one of Freq's members at every write site
  // (POST/PATCH below); the DB column itself is a plain string.
  const dates = generateSlotDates({ ...slot, freq: slot.freq as Freq }, from, to);
  if (!dates.length) return;

  const existingDates = new Set<string>();
  for (const batch of chunk(dates.map((d) => d.date), 50)) {
    const rows = await db.select({ date: occurrences.date }).from(occurrences).where(and(eq(occurrences.slotId, slot.id), inArray(occurrences.date, batch)));
    for (const r of rows) existingDates.add(r.date);
  }

  const itemByPosition = new Map(rotation.map((r) => [r.position, r]));
  const toInsert = dates
    .filter((d) => !existingDates.has(d.date))
    .map(({ date, position }) => {
      const item = itemByPosition.get(position);
      return {
        id: crypto.randomUUID(),
        planId: plan.id,
        slotId: slot.id,
        ritualId: item?.ritualId ?? null,
        date,
        // A rotation position can carry a theme label before a specific
        // ritual is chosen for it (rotation_items.label, PLAN.md §4) — that
        // should still show up on the calendar as something better than
        // a bare "Untitled".
        titleOverride: !item?.ritualId && item?.label ? item.label : null,
        startTime: slot.startTime,
        durationMin: slot.durationMin,
        status: "planned" as const,
        origin: "rotation" as const,
      };
    });

  // D1's bound-parameter ceiling per statement is well below vanilla
  // SQLite's default (999) — empirically, 20 rows x 9 columns (180 params)
  // fails, 5x9 (45) succeeds. 10 rows x 9 columns (90) keeps real margin.
  for (const batch of chunk(toInsert, 10)) {
    await db.insert(occurrences).values(batch);
  }
}

/**
 * The regeneration rule (PLAN.md §4): delete and rebuild only occurrences
 * that are still exactly what the rotation would have generated on its own —
 * planned, unedited, rotation-origin, and not yet in the past. Anything a
 * human touched (edited_at set, status changed, or a template/ai origin)
 * survives untouched.
 */
async function regenerateSlot(db: Db, plan: Plan, slot: Slot, rotation: RotationItem[]) {
  const today = todayISO();
  await db
    .delete(occurrences)
    .where(
      and(
        eq(occurrences.slotId, slot.id),
        inArray(occurrences.origin, ["rotation", "template"]),
        eq(occurrences.status, "planned"),
        isNull(occurrences.editedAt),
        gte(occurrences.date, today),
      ),
    );

  const from = today > plan.startDate ? today : plan.startDate;
  await materializeSlotOccurrences(db, plan, slot, rotation, from, plan.endDate);
}

// ─── Plans ──────────────────────────────────────────────────────────────────

planner.get("/plans", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const items = await db.select().from(plans).where(eq(plans.teamId, session.teamId)).orderBy(asc(plans.createdAt));
  return c.json({ items });
});

/**
 * A real delete, unlike "Start something new" which only archives — this is
 * the escape hatch for clearing out test/throwaway plans. D1 enforces the
 * schema's onDelete:cascade FKs, so this also removes the plan's slots,
 * rotation items, occurrences, and reflections in one go.
 */
planner.delete("/plans/:planId", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  await db.delete(plans).where(eq(plans.id, plan.id));
  return c.json({ success: true });
});

planner.post("/plans", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const body = await c.req.json<{ name?: string; startDate?: string; endDate?: string; timezone?: string; primaryJobId?: number }>().catch(() => ({}) as Record<string, never>);

  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!body.startDate || !body.endDate) return c.json({ error: "startDate and endDate are required" }, 400);
  if (body.startDate > body.endDate) return c.json({ error: "startDate must be before endDate" }, 400);

  const id = crypto.randomUUID();
  await db.insert(plans).values({
    id,
    teamId: session.teamId,
    name: body.name.trim(),
    startDate: body.startDate,
    endDate: body.endDate,
    timezone: body.timezone ?? "UTC",
    primaryJobId: body.primaryJobId ?? null,
    createdBy: session.userId,
    // Generated eagerly, not lazily on first ICS request: the subscribe URL
    // should be visible in the UI the moment a plan exists, and a plan with
    // no token would need a separate "does this plan have a feed yet" state
    // for no real benefit (PLAN.md §5.7).
    icsToken: crypto.randomUUID(),
  });

  const [plan] = await db.select().from(plans).where(eq(plans.id, id)).limit(1);
  return c.json({ item: plan }, 201);
});

planner.get("/plans/:planId", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);
  return c.json({ item: plan });
});

planner.patch("/plans/:planId", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  const body = await c.req.json<{ name?: string; status?: string; startDate?: string; endDate?: string }>().catch(() => ({}) as Record<string, never>);
  const patch: Partial<Plan> = {};
  if (body.name?.trim()) patch.name = body.name.trim();
  if (body.status && ["draft", "active", "archived"].includes(body.status)) patch.status = body.status;

  const nextStart = body.startDate ?? plan.startDate;
  const nextEnd = body.endDate ?? plan.endDate;
  if (nextStart > nextEnd) return c.json({ error: "startDate must be before endDate" }, 400);
  if (body.startDate) patch.startDate = body.startDate;
  if (body.endDate) patch.endDate = body.endDate;

  if (Object.keys(patch).length) await db.update(plans).set(patch).where(eq(plans.id, plan.id));

  const [updated] = await db.select().from(plans).where(eq(plans.id, plan.id)).limit(1);
  return c.json({ item: updated });
});

/**
 * Rotating the token invalidates the old subscribe URL immediately — anyone
 * who still has it gets a 404 from the public /ics/:token.ics route below,
 * not stale data (PLAN.md §5.7: "token is rotatable").
 */
planner.post("/plans/:planId/ics-token/rotate", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  const icsToken = crypto.randomUUID();
  await db.update(plans).set({ icsToken }).where(eq(plans.id, plan.id));
  return c.json({ icsToken });
});

// ─── Slots (recurring rotations) ────────────────────────────────────────────

interface RotationInput {
  position?: number;
  ritualId?: number | null;
  label?: string | null;
}

const ALLOWED_FREQ = new Set<Freq>(["weekly", "biweekly", "monthly"]);

planner.get("/plans/:planId/slots", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  const slotRows = await db.select().from(slots).where(eq(slots.planId, plan.id)).orderBy(asc(slots.createdAt));
  // Left-joined so an edit form can show each position's current ritual
  // title without a second round trip (same shallow-join style as
  // GET /plans/:planId/occurrences below).
  const rotationRows = slotRows.length
    ? await db
        .select({ item: rotationItems, ritual: rituals })
        .from(rotationItems)
        .leftJoin(rituals, eq(rituals.id, rotationItems.ritualId))
        .where(inArray(rotationItems.slotId, slotRows.map((s) => s.id)))
        .orderBy(asc(rotationItems.position))
    : [];
  const bySlot = new Map<string, (RotationItem & { ritual: Ritual | null })[]>();
  for (const { item, ritual } of rotationRows) bySlot.set(item.slotId, [...(bySlot.get(item.slotId) ?? []), { ...item, ritual }]);

  return c.json({ items: slotRows.map((s) => ({ ...s, rotation: bySlot.get(s.id) ?? [] })) });
});

planner.post("/plans/:planId/slots", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  const body = await c
    .req.json<{
      name?: string;
      color?: string;
      freq?: string;
      interval?: number;
      anchorDate?: string;
      durationMin?: number;
      startTime?: string;
      activeFrom?: string;
      activeTo?: string;
      rotation?: RotationInput[];
    }>()
    .catch(() => ({}) as Record<string, never>);

  if (!body.name?.trim()) return c.json({ error: "name is required" }, 400);
  if (!body.anchorDate) return c.json({ error: "anchorDate is required" }, 400);
  const freq = ALLOWED_FREQ.has(body.freq as Freq) ? (body.freq as Freq) : "weekly";
  const interval = Number.isInteger(body.interval) && body.interval! >= 1 ? body.interval! : 1;
  const rotationInput = body.rotation?.length ? body.rotation : [{ position: 0, ritualId: null }];

  const slotId = crypto.randomUUID();
  const slot: Slot = {
    id: slotId,
    planId: plan.id,
    name: body.name.trim(),
    color: body.color ?? null,
    freq,
    interval,
    byweekday: deriveByweekday(body.anchorDate),
    nth: null,
    startTime: body.startTime ?? null,
    durationMin: body.durationMin ?? null,
    cycleLength: rotationInput.length,
    anchorDate: body.anchorDate,
    activeFrom: body.activeFrom ?? null,
    activeTo: body.activeTo ?? null,
    createdAt: "",
  };
  await db.insert(slots).values(slot);

  const rotationRows = rotationInput.map((r, i) => ({
    slotId,
    position: r.position ?? i,
    ritualId: r.ritualId ?? null,
    label: r.label ?? null,
  }));
  await db.insert(rotationItems).values(rotationRows);

  const rotation = await db.select().from(rotationItems).where(eq(rotationItems.slotId, slotId)).orderBy(asc(rotationItems.position));
  await materializeSlotOccurrences(db, plan, slot, rotation, plan.startDate, plan.endDate);

  return c.json({ item: { ...slot, rotation } }, 201);
});

planner.patch("/slots/:slotId", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const owned = await getOwnedSlot(db, c.req.param("slotId"), session.teamId);
  if (!owned) return c.json({ error: "not found" }, 404);
  const { slot, plan } = owned;

  const body = await c
    .req.json<{
      name?: string;
      color?: string;
      freq?: string;
      interval?: number;
      anchorDate?: string;
      durationMin?: number | null;
      startTime?: string | null;
      activeFrom?: string | null;
      activeTo?: string | null;
      rotation?: RotationInput[];
    }>()
    .catch(() => ({}) as Record<string, never>);

  const updated: Slot = {
    ...slot,
    name: body.name?.trim() || slot.name,
    color: body.color !== undefined ? body.color : slot.color,
    freq: ALLOWED_FREQ.has(body.freq as Freq) ? (body.freq as Freq) : slot.freq,
    interval: Number.isInteger(body.interval) && body.interval! >= 1 ? body.interval! : slot.interval,
    anchorDate: body.anchorDate ?? slot.anchorDate,
    byweekday: body.anchorDate ? deriveByweekday(body.anchorDate) : slot.byweekday,
    durationMin: body.durationMin !== undefined ? body.durationMin : slot.durationMin,
    startTime: body.startTime !== undefined ? body.startTime : slot.startTime,
    activeFrom: body.activeFrom !== undefined ? body.activeFrom : slot.activeFrom,
    activeTo: body.activeTo !== undefined ? body.activeTo : slot.activeTo,
    cycleLength: body.rotation?.length ?? slot.cycleLength,
  };

  await db
    .update(slots)
    .set({
      name: updated.name,
      color: updated.color,
      freq: updated.freq,
      interval: updated.interval,
      anchorDate: updated.anchorDate,
      byweekday: updated.byweekday,
      durationMin: updated.durationMin,
      startTime: updated.startTime,
      activeFrom: updated.activeFrom,
      activeTo: updated.activeTo,
      cycleLength: updated.cycleLength,
    })
    .where(eq(slots.id, slot.id));

  if (body.rotation?.length) {
    await db.delete(rotationItems).where(eq(rotationItems.slotId, slot.id));
    await db.insert(rotationItems).values(body.rotation.map((r, i) => ({ slotId: slot.id, position: r.position ?? i, ritualId: r.ritualId ?? null, label: r.label ?? null })));
  }

  const rotation = await db.select().from(rotationItems).where(eq(rotationItems.slotId, slot.id)).orderBy(asc(rotationItems.position));
  await regenerateSlot(db, plan, updated, rotation);

  return c.json({ item: { ...updated, rotation } });
});

planner.delete("/slots/:slotId", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const owned = await getOwnedSlot(db, c.req.param("slotId"), session.teamId);
  if (!owned) return c.json({ error: "not found" }, 404);
  const { slot } = owned;

  const today = todayISO();
  await db
    .delete(occurrences)
    .where(
      and(
        eq(occurrences.slotId, slot.id),
        inArray(occurrences.origin, ["rotation", "template"]),
        eq(occurrences.status, "planned"),
        isNull(occurrences.editedAt),
        gte(occurrences.date, today),
      ),
    );
  // Anything left (past occurrences, or ones a human touched) keeps its
  // history — orphaned from a slot, not deleted (occurrences.slotId is
  // nullable and set to null on slot delete via the FK, see db/schema.ts).
  await db.delete(rotationItems).where(eq(rotationItems.slotId, slot.id));
  await db.delete(slots).where(eq(slots.id, slot.id));

  return c.json({ success: true });
});

// ─── Occurrences ────────────────────────────────────────────────────────────

planner.get("/plans/:planId/occurrences", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  const from = c.req.query("from") ?? plan.startDate;
  const to = c.req.query("to") ?? plan.endDate;

  // Interval overlap: an occurrence (possibly spanning date..endDate) is in
  // range if it starts on/before `to` and ends on/after `from`.
  const rows = await db
    .select({ occurrence: occurrences, ritual: rituals })
    .from(occurrences)
    .leftJoin(rituals, eq(rituals.id, occurrences.ritualId))
    .where(and(eq(occurrences.planId, plan.id), sql`${occurrences.date} <= ${to}`, sql`coalesce(${occurrences.endDate}, ${occurrences.date}) >= ${from}`))
    .orderBy(asc(occurrences.date));

  return c.json({ items: rows.map(({ occurrence, ritual }) => ({ ...occurrence, ritual })) });
});

planner.post("/plans/:planId/occurrences", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  const body = await c
    .req.json<{
      ritualId?: number | null;
      date?: string;
      endDate?: string | null;
      startTime?: string | null;
      durationMin?: number | null;
      titleOverride?: string | null;
      facilitator?: string | null;
      guestName?: string | null;
      notes?: string | null;
    }>()
    .catch(() => ({}) as Record<string, never>);

  if (!body.date) return c.json({ error: "date is required" }, 400);

  let endDate = body.endDate ?? null;
  let durationMin = body.durationMin ?? null;
  if (body.ritualId) {
    const [ritual] = await db.select().from(rituals).where(eq(rituals.id, body.ritualId)).limit(1);
    // A campaign/series with a known span gets its end date computed
    // automatically unless the caller overrides it — placing a 1-week
    // research campaign shouldn't require doing the date math by hand.
    if (ritual?.spanWeeks && !endDate) endDate = addDaysISO(body.date, ritual.spanWeeks * 7 - 1);
    if (ritual?.durationMin && durationMin === null) durationMin = ritual.durationMin;
  }

  const id = crypto.randomUUID();
  await db.insert(occurrences).values({
    id,
    planId: plan.id,
    slotId: null,
    ritualId: body.ritualId ?? null,
    date: body.date,
    endDate,
    startTime: body.startTime ?? null,
    durationMin,
    titleOverride: body.titleOverride ?? null,
    facilitator: body.facilitator ?? null,
    guestName: body.guestName ?? null,
    notes: body.notes ?? null,
    status: "planned",
    origin: "manual",
  });

  const [item] = await db.select().from(occurrences).where(eq(occurrences.id, id)).limit(1);
  return c.json({ item }, 201);
});

const EDITABLE_OCCURRENCE_FIELDS = ["ritualId", "date", "endDate", "startTime", "durationMin", "titleOverride", "facilitator", "guestName", "notes", "status"] as const;

planner.patch("/occurrences/:id", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const owned = await getOwnedOccurrence(db, c.req.param("id"), session.teamId);
  if (!owned) return c.json({ error: "not found" }, 404);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, never>);
  const patch: Record<string, unknown> = {};
  for (const field of EDITABLE_OCCURRENCE_FIELDS) {
    if (field in body) patch[field] = body[field];
  }
  // Any human edit protects this occurrence from rotation regeneration
  // (PLAN.md §4's regeneration rule keys off edited_at being non-null).
  patch.editedAt = new Date().toISOString();

  await db.update(occurrences).set(patch).where(eq(occurrences.id, owned.occurrence.id));
  const [item] = await db.select().from(occurrences).where(eq(occurrences.id, owned.occurrence.id)).limit(1);
  return c.json({ item });
});

planner.delete("/occurrences/:id", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const owned = await getOwnedOccurrence(db, c.req.param("id"), session.teamId);
  if (!owned) return c.json({ error: "not found" }, 404);

  await db.delete(occurrences).where(eq(occurrences.id, owned.occurrence.id));
  return c.json({ success: true });
});

planner.post("/occurrences/:id/reflection", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const owned = await getOwnedOccurrence(db, c.req.param("id"), session.teamId);
  if (!owned) return c.json({ error: "not found" }, 404);

  const body = await c.req.json<{ rating?: number; whatWorked?: string; whatDidnt?: string }>().catch(() => ({}) as Record<string, never>);
  await db.insert(reflections).values({
    occurrenceId: owned.occurrence.id,
    rating: body.rating ?? null,
    whatWorked: body.whatWorked ?? null,
    whatDidnt: body.whatDidnt ?? null,
    authorUserId: session.userId,
  });

  const items = await db.select().from(reflections).where(eq(reflections.occurrenceId, owned.occurrence.id)).orderBy(asc(reflections.createdAt));
  return c.json({ items }, 201);
});

/** "Add this one occurrence to my calendar" — authenticated, unlike the public subscribe feed in worker/ics.ts. */
planner.get("/occurrences/:id/ics", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const owned = await getOwnedOccurrence(db, c.req.param("id"), session.teamId);
  if (!owned) return c.json({ error: "not found" }, 404);

  const body = await buildSingleEventIcs(db, owned.occurrence.id);
  if (!body) return c.json({ error: "not found" }, 404);

  return c.text(body, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="occurrence.ics"`,
  });
});

// ─── Warnings ───────────────────────────────────────────────────────────────
// Rules, not AI — cheap and instant (PLAN.md §5.1).

export interface Warning {
  type: "min_gap" | "avoid_near" | "heavy_cluster" | "prep_lead";
  severity: "warning" | "info";
  message: string;
  occurrenceIds: string[];
}

export async function computePlanWarnings(db: Db, plan: Plan): Promise<Warning[]> {
  const rows = await db
    .select({ occurrence: occurrences, ritual: rituals })
    .from(occurrences)
    .innerJoin(rituals, eq(rituals.id, occurrences.ritualId))
    .where(and(eq(occurrences.planId, plan.id), eq(occurrences.status, "planned")))
    .orderBy(asc(occurrences.date));

  const warnings: Warning[] = [];
  const today = todayISO();

  // 1. min_gap_weeks: consecutive occurrences of the same ritual scheduled
  // closer together than the ritual allows.
  const byRitual = new Map<number, typeof rows>();
  for (const row of rows) {
    if (!row.ritual.minGapWeeks) continue;
    byRitual.set(row.ritual.id, [...(byRitual.get(row.ritual.id) ?? []), row]);
  }
  for (const group of byRitual.values()) {
    for (let i = 1; i < group.length; i++) {
      const gapWeeks = daysBetweenISO(group[i - 1].occurrence.date, group[i].occurrence.date) / 7;
      if (gapWeeks < group[i].ritual.minGapWeeks!) {
        warnings.push({
          type: "min_gap",
          severity: "warning",
          message: `"${group[i].ritual.title}" is scheduled only ${gapWeeks.toFixed(0)} week(s) after its last occurrence — usually needs at least ${group[i].ritual.minGapWeeks}.`,
          occurrenceIds: [group[i - 1].occurrence.id, group[i].occurrence.id],
        });
      }
    }
  }

  // 2. avoid_near: a ritual scheduled in the same week as one of its
  // declared conflicts.
  const bySlugInWeek = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${weekBucket(row.occurrence.date)}:${row.ritual.slug}`;
    bySlugInWeek.set(key, [...(bySlugInWeek.get(key) ?? []), row]);
  }
  for (const row of rows) {
    for (const avoidSlug of row.ritual.avoidNear ?? []) {
      const conflict = bySlugInWeek.get(`${weekBucket(row.occurrence.date)}:${avoidSlug}`);
      if (conflict?.length) {
        warnings.push({
          type: "avoid_near",
          severity: "warning",
          message: `"${row.ritual.title}" and "${conflict[0].ritual.title}" are scheduled the same week, but usually shouldn't be.`,
          occurrenceIds: [row.occurrence.id, conflict[0].occurrence.id],
        });
      }
    }
  }

  // 3. Heavy-load clustering: 2+ heavy-load rituals in the same week.
  const heavyByWeek = new Map<number, typeof rows>();
  for (const row of rows) {
    if (row.ritual.load !== "heavy") continue;
    const wk = weekBucket(row.occurrence.date);
    heavyByWeek.set(wk, [...(heavyByWeek.get(wk) ?? []), row]);
  }
  for (const group of heavyByWeek.values()) {
    if (group.length >= 2) {
      warnings.push({
        type: "heavy_cluster",
        severity: "warning",
        message: `${group.length} heavy-load rituals land in the same week: ${group.map((g) => g.ritual.title).join(", ")}.`,
        occurrenceIds: group.map((g) => g.occurrence.id),
      });
    }
  }

  // 4. Prep-lead-time: not enough runway before a planned occurrence.
  for (const row of rows) {
    if (!row.ritual.prepLeadDays) continue;
    const daysUntil = daysBetweenISO(today, row.occurrence.date);
    if (daysUntil >= 0 && daysUntil < row.ritual.prepLeadDays) {
      warnings.push({
        type: "prep_lead",
        severity: "info",
        message: `"${row.ritual.title}" usually needs ${row.ritual.prepLeadDays} days of prep, but it's only ${daysUntil} away.`,
        occurrenceIds: [row.occurrence.id],
      });
    }
  }

  return warnings;
}

planner.get("/plans/:planId/warnings", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  const items = await computePlanWarnings(db, plan);
  return c.json({ items });
});
