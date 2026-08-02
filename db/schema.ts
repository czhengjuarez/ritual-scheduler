import { sqliteTable, text, integer, uniqueIndex, index, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

/**
 * Identity + tenancy (Phase 0). Rituals/jobs (Phase 1) and cadences/planner
 * tables (Phase 2+) are below (see PLAN.md §4).
 *
 * `googleSub` exists and is unique from day one even though sign-in is not
 * wired up yet (Phase 6). It is the merge key across the whole ritual suite
 * (see PLAN.md §7) — adding it later, once real users exist in two apps,
 * would be a migration with identity reconciliation instead of a column.
 */
export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    googleSub: text("google_sub"),
    role: text("role").notNull().default("user"), // user|admin
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [uniqueIndex("users_google_sub_idx").on(t.googleSub)],
);

/**
 * Every visitor gets a team, even pre-auth: an anonymous session creates a
 * "personal workspace" team immediately. First Google sign-in claims it
 * rather than discarding it (PLAN.md §7).
 */
export const teams = sqliteTable("teams", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  timezone: text("timezone").notNull().default("UTC"),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
});

export const memberships = sqliteTable(
  "memberships",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("owner"), // owner|editor|viewer
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [uniqueIndex("memberships_team_user_idx").on(t.teamId, t.userId)],
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type NewMembership = typeof memberships.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 1: rituals & jobs as ingredients.
//
// The library is an INPUT to scheduling, not the product (PLAN.md §1) — so
// the priority in this table is the scheduling block (engagement, span,
// load, spacing), not the runbook prose. Both are required for seeded
// entries; only the scheduling block matters for AI placement later.
// ---------------------------------------------------------------------------

/** "What are you trying to do?" — the app's entry point (PLAN.md §1.1). */
export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"), // lucide icon name
  sortOrder: integer("sort_order").notNull().default(0),
  typicalSpan: text("typical_span").notNull().default("ongoing"), // ongoing|bounded|one-off
});

export const categories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  color: text("color"), // one hue per category — the primary visual language (PLAN.md §3)
  icon: text("icon"), // lucide icon name — colour is never the only signal
  description: text("description"),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * A ritual is not always a recurring meeting: `engagement` + `spanWeeks`
 * carry a one-week research campaign the same as a year-long mentorship
 * (PLAN.md §1.2). The scheduling-metadata block below (duration through
 * dependsOn) is what powers spacing warnings and, later, AI placement —
 * see PLAN.md §5.1 and §5.6.
 */
export const rituals = sqliteTable(
  "rituals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    summary: text("summary"),
    purpose: text("purpose"),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),

    visibility: text("visibility").notNull().default("public"), // public|team|private
    status: text("status").notNull().default("published"), // draft|pending|published|rejected
    ownerTeamId: text("owner_team_id").references(() => teams.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),

    // Shape & span (PLAN.md §1.2)
    engagement: text("engagement").notNull().default("recurring"), // session|recurring|series|campaign
    spanWeeks: integer("span_weeks"), // series/campaign only; null for session/recurring
    defaultCadence: text("default_cadence").notNull().default("adhoc"),
    // weekly|biweekly|monthly|quarterly|annual|adhoc|rotation

    // Scheduling metadata — the priority fields (PLAN.md §1)
    durationMin: integer("duration_min"), // length of one sitting
    prepLeadDays: integer("prep_lead_days"),
    load: text("load").notNull().default("medium"), // light|medium|heavy
    participants: text("participants"), // core-team|extended|cross-functional|guests|leadership
    sizeMin: integer("size_min"),
    sizeMax: integer("size_max"),
    format: text("format").notNull().default("sync"), // sync|async|hybrid
    timingHint: text("timing_hint"), // start-of-week|end-of-week|after-planning|null
    minGapWeeks: integer("min_gap_weeks"),
    pairsWellWith: text("pairs_well_with", { mode: "json" }).$type<string[]>().default([]), // ritual slugs
    avoidNear: text("avoid_near", { mode: "json" }).$type<string[]>().default([]), // ritual slugs
    dependsOn: text("depends_on"), // e.g. ship review needs a ship

    // Runbook content — secondary, required for seeded entries
    facilitatorRole: text("facilitator_role"),
    prepNotes: text("prep_notes"),
    agenda: text("agenda", { mode: "json" }).$type<{ title: string; minutes?: number; notes?: string }[]>().default([]),
    outputs: text("outputs", { mode: "json" }).$type<string[]>().default([]),
    materials: text("materials", { mode: "json" }).$type<string[]>().default([]),
    antiPatterns: text("anti_patterns", { mode: "json" }).$type<string[]>().default([]),
    variations: text("variations", { mode: "json" }).$type<{ name: string; description?: string }[]>().default([]),

    tags: text("tags", { mode: "json" }).$type<string[]>().default([]),
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    attribution: text("attribution"),
    sourceVerified: integer("source_verified", { mode: "boolean" }).notNull().default(false),

    coverKey: text("cover_key"), // R2 (Phase 8)
    embeddingVersion: integer("embedding_version"), // Vectorize (Phase 6)

    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
    updatedAt: text("updated_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [
    index("rituals_category_idx").on(t.categoryId),
    index("rituals_status_idx").on(t.status),
    index("rituals_visibility_idx").on(t.visibility),
    index("rituals_engagement_idx").on(t.engagement),
  ],
);

/**
 * Many-to-many: one job is usually served by rituals from several different
 * categories (PLAN.md §1.1), so this can't just be a second category column.
 */
export const ritualJobs = sqliteTable(
  "ritual_jobs",
  {
    ritualId: integer("ritual_id").notNull().references(() => rituals.id, { onDelete: "cascade" }),
    jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
    weight: integer("weight").notNull().default(1), // how well this ritual serves the job, 1-3
  },
  (t) => [uniqueIndex("ritual_jobs_ritual_job_idx").on(t.ritualId, t.jobId)],
);

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Ritual = typeof rituals.$inferSelect;
export type NewRitual = typeof rituals.$inferInsert;
export type RitualJob = typeof ritualJobs.$inferSelect;

// ---------------------------------------------------------------------------
// Phase 2: the planner — this is the product (PLAN.md §5.1).
//
// `plans.fromTemplateId` and `cadence_templates.originPlanId` reference each
// other — Drizzle resolves this fine because references() takes a callback,
// evaluated lazily, not the table object itself; `cadenceTemplates` just
// needs to exist as a binding somewhere in this module (it's defined further
// down, with the rest of the Phase 4 tables).
// ---------------------------------------------------------------------------

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDate: text("start_date").notNull(), // YYYY-MM-DD
    endDate: text("end_date").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    status: text("status").notNull().default("active"), // draft|active|archived
    icsToken: text("ics_token"), // Phase 3
    fromTemplateId: integer("from_template_id").references((): AnySQLiteColumn => cadenceTemplates.id, { onDelete: "set null" }),
    primaryJobId: integer("primary_job_id").references(() => jobs.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index("plans_team_idx").on(t.teamId)],
);

/**
 * One weekly slot, N rituals rotating through it — the anchor use case
 * (PLAN.md §1.3). `byweekday` is derived from `anchorDate` at creation time
 * rather than accepted as independent client input, so the two can never
 * disagree (see worker/schedule.ts).
 */
export const slots = sqliteTable(
  "slots",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    color: text("color"),
    freq: text("freq").notNull().default("weekly"), // weekly|biweekly|monthly
    // Repeat step for weekly/monthly: 1=every week/month, 2=every 2, etc.
    // "quarterly" and "annual" are just monthly with interval 3 or 12 — not
    // separate freq values. `biweekly` predates this column and is left as
    // its own legacy freq value (schedule.ts keeps a fixed-step branch for
    // it); new slots always use weekly+interval instead of writing it.
    interval: integer("interval").notNull().default(1),
    byweekday: integer("byweekday").notNull(), // 0=Sun..6=Sat
    nth: integer("nth"), // monthly only: 1..4, or -1 for "last"
    startTime: text("start_time"), // HH:MM, nullable — week-granularity planning is first-class
    durationMin: integer("duration_min"),
    cycleLength: integer("cycle_length").notNull().default(1), // 1 = plain recurrence, 4 = the rotation
    anchorDate: text("anchor_date").notNull(), // cycle position 0 lands here
    activeFrom: text("active_from"),
    activeTo: text("active_to"),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index("slots_plan_idx").on(t.planId)],
);

export const rotationItems = sqliteTable(
  "rotation_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slotId: text("slot_id").notNull().references(() => slots.id, { onDelete: "cascade" }),
    position: integer("position").notNull(), // 0..cycleLength-1
    ritualId: integer("ritual_id").references(() => rituals.id, { onDelete: "set null" }),
    label: text("label"), // theme name when no ritual is chosen yet
  },
  (t) => [uniqueIndex("rotation_items_slot_position_idx").on(t.slotId, t.position)],
);

/**
 * Materialized rows, not computed on read — each carries an owner, guest,
 * notes, and (via `reflections`) a post-hoc rating, none of which survive
 * being recomputed from the slot definition on every request (PLAN.md §4).
 *
 * `slotId` is null for standalone occurrences: one-off sessions and every
 * campaign/series, which are placed directly rather than through a
 * recurring slot. `endDate` is what lets a campaign span weeks instead of
 * being a single-day point (PLAN.md §1.2).
 */
export const occurrences = sqliteTable(
  "occurrences",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id").notNull().references(() => plans.id, { onDelete: "cascade" }),
    slotId: text("slot_id").references(() => slots.id, { onDelete: "set null" }),
    ritualId: integer("ritual_id").references(() => rituals.id, { onDelete: "set null" }),
    date: text("date").notNull(), // YYYY-MM-DD
    endDate: text("end_date"), // spans: campaigns and multi-day sessions
    startTime: text("start_time"),
    durationMin: integer("duration_min"),
    titleOverride: text("title_override"),
    status: text("status").notNull().default("planned"), // planned|confirmed|done|skipped|cancelled
    ownerUserId: text("owner_user_id").references(() => users.id, { onDelete: "set null" }),
    facilitator: text("facilitator"),
    guestName: text("guest_name"),
    notes: text("notes"),
    origin: text("origin").notNull().default("manual"), // rotation|manual|template|ai
    editedAt: text("edited_at"), // non-null => protected from regeneration
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [
    index("occurrences_plan_date_idx").on(t.planId, t.date),
    index("occurrences_slot_idx").on(t.slotId),
  ],
);

export const reflections = sqliteTable(
  "reflections",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    occurrenceId: text("occurrence_id").notNull().references(() => occurrences.id, { onDelete: "cascade" }),
    rating: integer("rating"), // 1-5
    whatWorked: text("what_worked"),
    whatDidnt: text("what_didnt"),
    authorUserId: text("author_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index("reflections_occurrence_idx").on(t.occurrenceId)],
);

export type Plan = typeof plans.$inferSelect;
export type NewPlan = typeof plans.$inferInsert;
export type Slot = typeof slots.$inferSelect;
export type NewSlot = typeof slots.$inferInsert;
export type RotationItem = typeof rotationItems.$inferSelect;
export type NewRotationItem = typeof rotationItems.$inferInsert;
export type Occurrence = typeof occurrences.$inferSelect;
export type NewOccurrence = typeof occurrences.$inferInsert;
export type Reflection = typeof reflections.$inferSelect;
export type NewReflection = typeof reflections.$inferInsert;

// ---------------------------------------------------------------------------
// Phase 4: cadence templates — the primary shareable unit (PLAN.md §4).
//
// A whole cadence, not a single ritual, is what one team publishes and
// another clones. `definition` is deliberately date-free and slug-keyed —
// no plan id, no absolute dates, no ritual foreign keys — so a template
// stays valid across databases and survives the library being re-seeded.
// ---------------------------------------------------------------------------

export interface CadenceRotationItemDef {
  position: number;
  ritualSlug: string | null;
  label?: string | null;
}

export interface CadenceSlotDef {
  name: string;
  color?: string | null;
  freq: "weekly" | "biweekly" | "monthly";
  interval?: number | null; // every N weeks/months; absent/null = 1
  byweekday: number; // 0=Sun..6=Sat
  nth?: number | null; // monthly only: 1..4, or -1 for "last"
  startTime?: string | null;
  durationMin?: number | null;
  rotation: CadenceRotationItemDef[];
}

export interface CadenceStandaloneDef {
  ritualSlug: string | null;
  titleOverride?: string | null;
  // Plain day-count from the plan's start date — NOT split into a week
  // count plus a weekday number. Splitting it that way is a trap: a
  // standalone occurrence's absolute weekday (e.g. "Monday") only
  // reconstructs the right date if the *new* plan's start date also happens
  // to fall on a Sunday. A single day offset is immune to that by
  // construction — it's relative to the start date, not to the calendar.
  dayOffset: number;
  spanWeeks?: number | null; // campaigns/series; null = a single day
}

export interface CadenceDefinition {
  slots: CadenceSlotDef[];
  standalone: CadenceStandaloneDef[];
}

export const cadenceTemplates = sqliteTable(
  "cadence_templates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    summary: text("summary"),

    visibility: text("visibility").notNull().default("public"), // public|team|private
    status: text("status").notNull().default("published"), // draft|pending|published|rejected
    ownerTeamId: text("owner_team_id").references(() => teams.id, { onDelete: "set null" }),
    originPlanId: text("origin_plan_id").references(() => plans.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),

    durationWeeks: integer("duration_weeks").notNull(),
    discipline: text("discipline"),
    teamSizeMin: integer("team_size_min"),
    teamSizeMax: integer("team_size_max"),
    workMode: text("work_mode"), // remote|hybrid|in-person
    goals: text("goals", { mode: "json" }).$type<string[]>().default([]),

    definition: text("definition", { mode: "json" }).$type<CadenceDefinition>().notNull(),

    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    cloneCount: integer("clone_count").notNull().default(0),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index("cadence_templates_status_idx").on(t.status), index("cadence_templates_visibility_idx").on(t.visibility)],
);

/** One job is usually served by more than one cadence and vice versa — same shape as ritual_jobs (PLAN.md §1.1). */
export const cadenceJobs = sqliteTable(
  "cadence_jobs",
  {
    cadenceTemplateId: integer("cadence_template_id").notNull().references(() => cadenceTemplates.id, { onDelete: "cascade" }),
    jobId: integer("job_id").notNull().references(() => jobs.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("cadence_jobs_template_job_idx").on(t.cadenceTemplateId, t.jobId)],
);

export type CadenceTemplate = typeof cadenceTemplates.$inferSelect;
export type NewCadenceTemplate = typeof cadenceTemplates.$inferInsert;
export type CadenceJob = typeof cadenceJobs.$inferSelect;

// ---------------------------------------------------------------------------
// Phase 6: AI. Every generation call is logged here — it's both the audit
// trail PLAN.md §5.6 asks for ("every run logged to ai_runs") and the
// rate-limit ledger (worker/ai.ts counts a team's recent rows instead of
// needing a separate KV binding just for that).
// ---------------------------------------------------------------------------

export const aiRuns = sqliteTable(
  "ai_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: text("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    kind: text("kind").notNull(), // suggest|balance|remix|autofill|intent
    input: text("input", { mode: "json" }).notNull(),
    output: text("output", { mode: "json" }),
    // null = not yet decided, true = accepted/used, false = discarded.
    // Nothing AI-generated reaches the public gallery without this being true.
    accepted: integer("accepted", { mode: "boolean" }),
    createdAt: text("created_at").notNull().default(sql`(current_timestamp)`),
  },
  (t) => [index("ai_runs_team_kind_idx").on(t.teamId, t.kind, t.createdAt)],
);

export type AiRun = typeof aiRuns.$inferSelect;
export type NewAiRun = typeof aiRuns.$inferInsert;
