import { and, asc, eq, or } from "drizzle-orm";
import type { Db } from "./db";
import { occurrences, plans, rituals, rotationItems, slots, type CadenceDefinition, type Plan, type Slot } from "../db/schema";
import { addDaysISO, derivePattern, firstMatchingDate } from "./schedule";
import { materializeSlotOccurrences } from "./planner";

/** A ritual slug only resolves if the caller's team can actually see it — public, or owned by them. */
async function resolveRitualId(db: Db, slugOrNull: string | null, teamId: string): Promise<number | null> {
  if (!slugOrNull) return null;
  const [ritual] = await db
    .select({ id: rituals.id })
    .from(rituals)
    .where(and(eq(rituals.slug, slugOrNull), eq(rituals.status, "published"), or(eq(rituals.visibility, "public"), eq(rituals.ownerTeamId, teamId))))
    .limit(1);
  return ritual?.id ?? null;
}

export interface InstantiatePlanArgs {
  teamId: string;
  userId: string;
  definition: CadenceDefinition;
  startDate: string;
  durationWeeks: number;
  name: string;
  timezone?: string;
  /** Set when materializing from a saved template (clone); left null for one-off definitions like an AI suggestion the caller never saved as a template. */
  fromTemplateId?: number | null;
}

/**
 * Turns a portable, date-free CadenceDefinition into a real Plan with Slots,
 * RotationItems, and Occurrences on a concrete start date. Shared by
 * template clone (worker/cadences.ts) and AI cadence suggestion
 * (worker/ai.ts) — both end with the same JSON shape, so both end with the
 * same instantiation.
 */
export async function instantiatePlanFromDefinition(db: Db, args: InstantiatePlanArgs): Promise<Plan> {
  const endDate = addDaysISO(args.startDate, args.durationWeeks * 7 - 1);
  const planId = crypto.randomUUID();

  await db.insert(plans).values({
    id: planId,
    teamId: args.teamId,
    name: args.name,
    startDate: args.startDate,
    endDate,
    timezone: args.timezone ?? "UTC",
    fromTemplateId: args.fromTemplateId ?? null,
    createdBy: args.userId,
    icsToken: crypto.randomUUID(),
  });
  const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);

  // A single-slot plan (the common case for a focused AI ask, or a
  // one-slot template) means "start it on the date I picked," full stop —
  // silently rolling forward to whichever weekday the slot's own pattern
  // happens to name reads as the wrong day entirely ("I said Aug 2, it
  // scheduled something else"). A multi-slot cadence keeps the normal
  // forward-search per slot: those are deliberately spread across
  // different weekdays, so forcing every slot onto the start date's single
  // weekday would collapse that spread instead of respecting it.
  const singleSlotPlan = args.definition.slots.length === 1;

  for (const slotDef of args.definition.slots) {
    // The anchor is reconstructed from the portable (byweekday, nth) pattern
    // — the exact inverse of derivePattern(), which is what publish used to
    // create this pattern in the first place.
    const anchorDate = singleSlotPlan ? args.startDate : firstMatchingDate(slotDef.freq, slotDef.byweekday, slotDef.nth, args.startDate);
    const { byweekday, nth } = singleSlotPlan ? derivePattern(args.startDate, slotDef.freq) : { byweekday: slotDef.byweekday, nth: slotDef.nth ?? null };
    const slot: Slot = {
      id: crypto.randomUUID(),
      planId,
      name: slotDef.name,
      color: slotDef.color ?? null,
      freq: slotDef.freq,
      interval: slotDef.interval ?? 1,
      byweekday,
      nth,
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
      rotationRows.push({ slotId: slot.id, position: item.position, ritualId: await resolveRitualId(db, item.ritualSlug, args.teamId), label: item.label ?? null });
    }
    if (rotationRows.length) await db.insert(rotationItems).values(rotationRows);
    const insertedRotation = await db.select().from(rotationItems).where(eq(rotationItems.slotId, slot.id)).orderBy(asc(rotationItems.position));

    await materializeSlotOccurrences(db, plan, slot, insertedRotation, args.startDate, endDate);
  }

  for (const item of args.definition.standalone) {
    const date = addDaysISO(args.startDate, item.dayOffset);
    const ritualId = await resolveRitualId(db, item.ritualSlug, args.teamId);
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

  return plan;
}
