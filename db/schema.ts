import { sqliteTable, text, integer, uniqueIndex, index } from "drizzle-orm/sqlite-core";
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
