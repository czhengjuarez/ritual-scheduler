import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { occurrences, plans, rituals } from "../db/schema";
import { buildCalendar, type IcsOccurrence } from "./ics-format";
import type { Env } from "./index";

/**
 * The subscribe feed at /ics/:token.ics (PLAN.md §5.7) — cheapest possible
 * integration and probably the most-used feature. Deliberately NOT under
 * /api: calendar apps poll this on their own schedule with no cookie, so the
 * token itself is the only authorization. It must therefore be unguessable
 * (crypto.randomUUID(), generated at plan creation — see planner.ts) and
 * rotatable (POST /api/plans/:id/ics-token/rotate) if it ever leaks.
 */
export const ics = new Hono<{ Bindings: Env }>();

async function loadOccurrences(db: ReturnType<typeof getDb>, planId: string): Promise<IcsOccurrence[]> {
  const rows = await db
    .select({ occurrence: occurrences, ritual: rituals })
    .from(occurrences)
    .leftJoin(rituals, eq(rituals.id, occurrences.ritualId))
    .where(eq(occurrences.planId, planId));

  return rows.map(({ occurrence, ritual }) => ({
    id: occurrence.id,
    date: occurrence.date,
    endDate: occurrence.endDate,
    startTime: occurrence.startTime,
    durationMin: occurrence.durationMin,
    titleOverride: occurrence.titleOverride,
    status: occurrence.status,
    facilitator: occurrence.facilitator,
    guestName: occurrence.guestName,
    notes: occurrence.notes,
    ritualTitle: ritual?.title ?? null,
    ritualPurpose: ritual?.purpose ?? null,
  }));
}

ics.get("/:token", async (c) => {
  const token = c.req.param("token").replace(/\.ics$/, "");
  const db = getDb(c.env.DB);

  const [plan] = await db.select().from(plans).where(eq(plans.icsToken, token)).limit(1);
  if (!plan) return c.text("Not found", 404);

  const occs = await loadOccurrences(db, plan.id);
  const body = buildCalendar(plan.name, plan.timezone, occs);

  return c.text(body, 200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Content-Disposition": `attachment; filename="${plan.name.replace(/[^\w.-]+/g, "_")}.ics"`,
  });
});

/** Authenticated single-event download for "add this one occurrence to my calendar" — distinct from the public subscription feed above. */
export async function buildSingleEventIcs(db: ReturnType<typeof getDb>, occurrenceId: string): Promise<string | null> {
  const [row] = await db
    .select({ occurrence: occurrences, ritual: rituals, plan: plans })
    .from(occurrences)
    .leftJoin(rituals, eq(rituals.id, occurrences.ritualId))
    .innerJoin(plans, eq(plans.id, occurrences.planId))
    .where(eq(occurrences.id, occurrenceId))
    .limit(1);
  if (!row) return null;

  const occ: IcsOccurrence = {
    id: row.occurrence.id,
    date: row.occurrence.date,
    endDate: row.occurrence.endDate,
    startTime: row.occurrence.startTime,
    durationMin: row.occurrence.durationMin,
    titleOverride: row.occurrence.titleOverride,
    status: row.occurrence.status,
    facilitator: row.occurrence.facilitator,
    guestName: row.occurrence.guestName,
    notes: row.occurrence.notes,
    ritualTitle: row.ritual?.title ?? null,
    ritualPurpose: row.ritual?.purpose ?? null,
  };
  return buildCalendar(occ.titleOverride || occ.ritualTitle || "Ritual", row.plan.timezone, [occ]);
}
