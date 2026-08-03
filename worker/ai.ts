import { Hono } from "hono";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import { getDb, type Db } from "./db";
import {
  aiRuns,
  cadenceTemplates,
  categories,
  jobs,
  occurrences,
  rituals,
  type CadenceDefinition,
  type CadenceRotationItemDef,
  type CadenceSlotDef,
  type CadenceStandaloneDef,
} from "../db/schema";
import { backfillCadenceEmbeddings, backfillRitualEmbeddings, semanticSearch } from "./embeddings";
import { instantiatePlanFromDefinition } from "./cadenceInstantiate";
import { getOwnedPlan, computePlanWarnings } from "./planner";
import { daysBetweenISO, weekBucket } from "./schedule";
import type { Env } from "./index";

type Session = { userId: string; teamId: string };

export const ai = new Hono<{ Bindings: Env; Variables: { session: Session } }>();

// ─── Rate limiting ──────────────────────────────────────────────────────────
// ai_runs doubles as the ledger — no separate KV binding just for a counter
// (PLAN.md §5.6 says "generation rate-limited," not "needs its own store").

const RATE_LIMIT_PER_HOUR = 20;

async function checkRateLimit(db: Db, teamId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const recent = await db
    .select({ id: aiRuns.id })
    .from(aiRuns)
    .where(and(eq(aiRuns.teamId, teamId), gte(aiRuns.createdAt, oneHourAgo)));
  return recent.length < RATE_LIMIT_PER_HOUR;
}

async function logRun(db: Db, args: { teamId: string; planId?: string | null; kind: string; input: unknown; output?: unknown; accepted?: boolean | null }) {
  const [row] = await db
    .insert(aiRuns)
    .values({ teamId: args.teamId, planId: args.planId ?? null, kind: args.kind, input: args.input, output: args.output ?? null, accepted: args.accepted ?? null })
    .returning();
  return row;
}

// ─── Embedding backfill (admin) ─────────────────────────────────────────────
// Mounted under /api/admin, gated by adminAuth in worker/index.ts — this is
// a one-time (or occasional) catch-up job for content that entered the
// database outside the normal create/approve flow, like the seed SQL.

export const aiAdmin = new Hono<{ Bindings: Env }>();

aiAdmin.post("/embeddings/backfill", async (c) => {
  const db = getDb(c.env.DB);
  const [publishedRituals, publishedCadences] = await Promise.all([
    db.select().from(rituals).where(and(eq(rituals.status, "published"), eq(rituals.visibility, "public"))),
    db.select().from(cadenceTemplates).where(and(eq(cadenceTemplates.status, "published"), eq(cadenceTemplates.visibility, "public"))),
  ]);

  const [ritualCount, cadenceCount] = await Promise.all([backfillRitualEmbeddings(c.env, publishedRituals), backfillCadenceEmbeddings(c.env, publishedCadences)]);

  return c.json({ rituals: ritualCount, cadences: cadenceCount });
});

// ─── Semantic search ────────────────────────────────────────────────────────
// Public-only by design: only published+public content is ever embedded
// (worker/embeddings.ts's isSearchable), so this never needs per-team
// filtering — a team's own team-visibility rituals stay on the existing
// keyword search (GET /api/rituals), which is plenty for a small, private set.

ai.get("/search", async (c) => {
  const q = c.req.query("q")?.trim();
  const type = c.req.query("type");
  if (!q) return c.json({ items: [] });

  const matches = await semanticSearch(c.env, q, { type: type === "ritual" || type === "cadence" ? type : undefined, topK: 24 });
  if (matches.length === 0) return c.json({ items: [] });

  const db = getDb(c.env.DB);
  const ritualIds = matches.filter((m) => m.type === "ritual").map((m) => m.refId);
  const cadenceIds = matches.filter((m) => m.type === "cadence").map((m) => m.refId);

  const [ritualRows, cadenceRows] = await Promise.all([
    ritualIds.length ? db.select().from(rituals).where(inArray(rituals.id, ritualIds)) : Promise.resolve([]),
    cadenceIds.length ? db.select().from(cadenceTemplates).where(inArray(cadenceTemplates.id, cadenceIds)) : Promise.resolve([]),
  ]);

  const ritualById = new Map(ritualRows.map((r) => [r.id, r]));
  const cadenceById = new Map(cadenceRows.map((c) => [c.id, c]));

  // Preserve similarity ranking — SQL's IN doesn't guarantee row order.
  const items = matches
    .map((m) => (m.type === "ritual" ? { type: "ritual" as const, score: m.score, item: ritualById.get(m.refId) } : { type: "cadence" as const, score: m.score, item: cadenceById.get(m.refId) }))
    .filter((r): r is typeof r & { item: NonNullable<typeof r.item> } => !!r.item);

  return c.json({ items });
});

// ─── Conversational cadence builder ────────────────────────────────────────
// The front door's freeform box (PLAN.md §5.2, revised 2026-08-02): instead
// of classifying one message into a destination and handing off to a static
// page (the old "gallery" destination just linked to a filtered /cadences
// list), this holds a short back-and-forth — asking for whatever's still
// missing (a job, a team size) one question at a time — until it has enough
// to actually generate a proposal via generateCadenceSuggestion below, which
// the frontend can then build straight onto the calendar on confirmation.
// "calendar"/"ritual"/"audit"/blank-"plan" asks are still a one-shot route,
// same discipline as before: never trust the model's own adherence to its
// schema, so jobSlugs still gets re-checked against the real table below.

const CONVERSE_ACTIONS = ["ask", "propose", "route"] as const;
type ConverseAction = (typeof CONVERSE_ACTIONS)[number];
const CONVERSE_ROUTES = ["plan", "ritual", "calendar", "audit"] as const;
type ConverseRoute = (typeof CONVERSE_ROUTES)[number];

function buildConverseTool(jobSlugsAllowed: string[]) {
  return {
    type: "function" as const,
    function: {
      name: "respond",
      description: "Decide how to respond next in this cadence-building conversation.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: CONVERSE_ACTIONS,
            description:
              "ask: you still need one more piece of info before you can propose a cadence. " +
              "propose: you now have at least one job and a team size, so design one. " +
              'route: they clearly want something else entirely — see "destination".',
          },
          message: {
            type: "string",
            description: "What to say to the user: the single follow-up question (ask), a short 1-2 sentence confirm-style summary (propose), or a short heads-up (route).",
          },
          jobSlugs: {
            type: "array",
            items: { type: "string", description: `one of: ${jobSlugsAllowed.join(", ")}` },
            description: "every job-to-be-done established so far across the whole conversation, cumulative",
          },
          teamSize: { type: "integer" },
          workMode: { type: "string", enum: ["remote", "hybrid", "in-person"] },
          horizonWeeks: { type: "integer", description: "plan length in weeks; default to 12 if never mentioned" },
          wantsMultiple: {
            type: "boolean",
            description:
              "true once they've asked for more than one distinct recurring event on its own separate cadence — 'more events', 'a few different meetings', 'not just one thing' — rather than a single specific thing. This is NOT the same as naming several rotation themes for one slot (see rotationThemes) — a weekly slot rotating through 4 themes is still ONE event, so wantsMultiple stays false for that. Defaults to false. Once true, stays true for the rest of the conversation.",
          },
          rotationThemes: {
            type: "array",
            items: { type: "string" },
            description:
              "Short labels for distinct themes/topics that should rotate through ONE recurring slot — set this when they list several named things ('alignment, product showcase, creative jam, learning') or ask to grow the variety ('a few more types in the rotation', 'add another one'). Cumulative across the conversation, like jobSlugs. Leave empty for a single-theme ask.",
          },
          excludeThemes: {
            type: "array",
            items: { type: "string" },
            description:
              "Short labels for specific slots/items they explicitly asked to remove or drop from what you already proposed (e.g. 'remove the monthly team pulse', 'drop the retro', 'the weekly sync is plenty' after a multi-item proposal). Cumulative across the conversation — once dropped, stays dropped unless they explicitly ask for it back. This is a hard exclusion, not a preference: never regenerate something matching an excluded label even if it seems like a good fit.",
          },
          destination: {
            type: "string",
            enum: CONVERSE_ROUTES,
            description:
              'only set when action is "route". plan: wants to start completely blank, no specific job/team in mind. ' +
              "ritual: wants to browse or author ritual content in the library — NOT scheduling one anywhere. " +
              "calendar: wants to go back to a plan they already have. audit: wants to assess how the team is doing, not schedule anything new. " +
              "Important: wanting a specific named ritual actually scheduled/recurring (a 1:1, a standup, a retro, however small) is action='propose', never destination='ritual' — 'ritual' is only for browsing the library with no scheduling intent at all.",
          },
        },
        required: ["action", "message"],
      },
    },
  };
}

/**
 * Once a cadence has already been proposed, a follow-up reply is far more
 * often a small edit ("remove X", "looks good") than a brand new design
 * request — but the main `respond` tool above has no memory of what was
 * already proposed, so every reply regenerated from scratch and often lost
 * fidelity (verified live: "remove the monthly team pulse, weekly sync is
 * plenty" just repeated the old 2-item proposal unchanged).
 *
 * This is a deliberately much smaller, easier task than full cadence
 * design: classify the reply against a short list of what's already
 * proposed. `remove`/`confirm` get handled as a deterministic code patch
 * against the *actual* persisted definition (see removeMatchingItems above
 * and the currentProposal branch in /intent/converse) — the model never
 * has to reproduce the structure from memory, only say what changed.
 * `other` falls through to the full existing pipeline unchanged.
 */
function buildEditIntentTool(itemLabels: string[]) {
  return {
    type: "function" as const,
    function: {
      name: "classify_edit",
      description: "Decide how the user's latest message relates to the cadence you already proposed.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["confirm", "remove", "add", "other"],
            description:
              "confirm: they're happy with the current proposal as-is and ready to build it — including a plain 'yes'/'looks good'/'go ahead'. " +
              "remove: they want to drop one or more of the currently-proposed items (listed below), keeping everything else exactly as it is. " +
              "add: they want to add one or more NEW items on top of what's already proposed, keeping everything already there exactly as it is. " +
              "other: anything else — changing an existing item's frequency, a bigger structural change, a totally different request, or genuinely unclear — needs a fresh full response instead of a patch.",
          },
          targets: {
            type: "array",
            items: { type: "string" },
            description: `REQUIRED and non-empty whenever action='remove' — which of these currently-proposed items to drop, in their own words: ${itemLabels.join(", ")}. Empty array otherwise.`,
          },
          newItems: {
            type: "array",
            items: { type: "string" },
            description: "REQUIRED and non-empty whenever action='add' — short names for the new item(s) to add (e.g. 'product showcase', 'a retro'). Empty array otherwise.",
          },
          message: { type: "string", description: "short 1-sentence reply acknowledging the change (or confirming), not a full re-summary" },
        },
        required: ["action", "targets", "newItems", "message"],
      },
    },
  };
}

interface EditIntentResult {
  action: "confirm" | "remove" | "add" | "other";
  targets: string[];
  newItems: string[];
  message: string;
}

function sanitizeEditIntentResult(raw: Record<string, unknown>): EditIntentResult {
  const action = raw.action === "confirm" || raw.action === "remove" || raw.action === "add" ? raw.action : "other";
  return {
    action,
    targets: sanitizeStringArray(raw.targets),
    newItems: sanitizeStringArray(raw.newItems),
    message: typeof raw.message === "string" && raw.message.trim() ? raw.message.trim() : "Got it.",
  };
}

/**
 * Resolves each new theme name into a real rotation item — a genuine
 * semantic-search match if one scores well, otherwise a plain label (same
 * fallback rotation_items.label already supports for a manually-typed
 * position). This is the one piece of an "add" edit that can't be a pure
 * code patch like remove/confirm — finding what a new theme actually means
 * needs a real lookup. Positions are placeholders, renumbered by the caller
 * once appended to the real rotation array.
 */
async function resolveNewRotationItems(
  env: Env,
  db: Db,
  newThemes: string[],
): Promise<{ items: CadenceRotationItemDef[]; newCandidates: { slug: string; title: string }[] }> {
  const items: CadenceRotationItemDef[] = [];
  const newCandidates: { slug: string; title: string }[] = [];
  for (const theme of newThemes) {
    const matches = await semanticSearch(env, theme, { type: "ritual", topK: 1 });
    if (matches.length && matches[0].score >= 0.55) {
      const [ritual] = await db.select({ slug: rituals.slug, title: rituals.title }).from(rituals).where(eq(rituals.id, matches[0].refId)).limit(1);
      if (ritual) {
        items.push({ position: 0, ritualSlug: ritual.slug, label: null });
        newCandidates.push(ritual);
        continue;
      }
    }
    items.push({ position: 0, ritualSlug: null, label: theme });
  }
  return { items, newCandidates };
}

interface ConverseMessage {
  role: "user" | "assistant";
  content: string;
}

interface ConverseResult {
  action: ConverseAction;
  message: string;
  jobSlugs: string[];
  teamSize: number | null;
  workMode: "remote" | "hybrid" | "in-person" | null;
  horizonWeeks: number | null;
  destination: ConverseRoute | null;
  wantsMultiple: boolean;
  rotationThemes: string[];
  excludeThemes: string[];
}

function sanitizeStringArray(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 8);
}

function sanitizeConverseResult(raw: Record<string, unknown>, validJobSlugs: Set<string>): ConverseResult {
  const jobSlugsRaw = Array.isArray(raw.jobSlugs) ? (raw.jobSlugs as unknown[]) : [];
  const action: ConverseAction = (CONVERSE_ACTIONS as readonly string[]).includes(raw.action as string) ? (raw.action as ConverseAction) : "ask";
  return {
    action,
    message: typeof raw.message === "string" && raw.message.trim() ? raw.message.trim() : "Could you say a bit more about what you're trying to build?",
    jobSlugs: jobSlugsRaw.filter((s): s is string => typeof s === "string" && validJobSlugs.has(s)),
    teamSize: typeof raw.teamSize === "number" && raw.teamSize > 0 ? Math.round(raw.teamSize) : null,
    workMode: raw.workMode === "remote" || raw.workMode === "hybrid" || raw.workMode === "in-person" ? raw.workMode : null,
    horizonWeeks: typeof raw.horizonWeeks === "number" && raw.horizonWeeks > 0 ? Math.min(52, Math.round(raw.horizonWeeks)) : null,
    destination: action === "route" && (CONVERSE_ROUTES as readonly string[]).includes(raw.destination as string) ? (raw.destination as ConverseRoute) : null,
    wantsMultiple: raw.wantsMultiple === true,
    rotationThemes: sanitizeStringArray(raw.rotationThemes),
    excludeThemes: sanitizeStringArray(raw.excludeThemes),
  };
}

const JOB_MATCH_STOPWORDS = new Set(["our", "the", "and", "for", "get", "make", "our", "new", "well", "with", "run", "cut", "a"]);

/**
 * Deterministic fallback for when the model's own `jobSlugs` comes back
 * empty despite the user plainly having described what they want — verified
 * live: a plain description like "alignment, product showcase, creative
 * jam, learning" repeatedly produced jobSlugs=[] turn after turn, even
 * though the model's own message text showed it understood. Since
 * `jobSlugs.length === 0` is exactly what triggers the "which job does this
 * serve?" reprompt below, that failure mode is an infinite identical-
 * question loop with no escape — the same "don't trust the model's
 * structured output alone" discipline as ONE_ON_ONE_PATTERN, applied here
 * via a crude prefix-stem overlap against each job's own name (handles
 * "alignment"/"aligned", "learning"/"learn" etc. sharing a root without
 * matching as an exact substring).
 */
function matchJobSlugsFromText(text: string, jobRows: { slug: string; name: string }[]): string[] {
  const lower = text.toLowerCase();
  const words = lower.split(/[^a-z]+/).filter((w) => w.length > 3 && !JOB_MATCH_STOPWORDS.has(w));
  const stems = words.map((w) => w.slice(0, 5));
  const matched: string[] = [];
  for (const job of jobRows) {
    const jobWords = job.name
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3 && !JOB_MATCH_STOPWORDS.has(w));
    if (jobWords.some((jw) => stems.includes(jw.slice(0, 5)))) matched.push(job.slug);
  }
  return matched;
}

const SINGLE_RITUAL_SLOT_FREQ: Record<string, "weekly" | "biweekly" | "monthly"> = {
  weekly: "weekly",
  biweekly: "biweekly",
  monthly: "monthly",
  quarterly: "monthly",
  annual: "monthly",
  adhoc: "weekly",
  rotation: "weekly",
};

/**
 * Some asks name one specific, already-known ritual directly ("a 1:1",
 * "our standup") rather than describing a goal for the AI to design a
 * cadence around. Handing that to the cadence-generation model anyway risks
 * exactly what motivated this: a "mile-long list of top picks, none of
 * which is a real 1:1" — topK retrieval always returns candidates, and a
 * generation model asked to "design a cadence" doesn't reliably resist
 * padding it out. A dominant, unambiguous semantic match against the raw
 * conversation text sidesteps the generation model entirely: build a
 * trivial one-slot definition straight from that ritual's own scheduling
 * defaults instead of asking the model to invent one.
 */
// "1:1" is common enough, and short/ambiguous enough for an embedding model,
// that it's worth a literal check ahead of semantic search: "need to plan
// 1:1" scores Manager 1:1 at only ~0.62 (below the threshold below) because
// "plan" pulls the embedding toward the library's many *planning* rituals
// instead — a human reads that as "schedule a 1:1" instantly, an embedding
// doesn't. Text match is more reliable than vector similarity for this one
// specific, extremely common shorthand.
const ONE_ON_ONE_PATTERN = /\b1[\s:-]?on[\s:-]?1\b|\b1:1\b|\bone[\s-]?on[\s-]?one\b/i;

/**
 * Same "text match beats trusting the model" reasoning as ONE_ON_ONE_PATTERN
 * above, for a different field: `wantsMultiple` on the `respond` tool is
 * unreliable in practice — glm-4.7-flash's own message text correctly says
 * "you want a few different recurring events" while it leaves the boolean
 * false, which would otherwise silently keep generation capped at one slot.
 * ORed with the model's own flag rather than replacing it, so either signal
 * can flip this on.
 */
const WANTS_MULTIPLE_PATTERN = /\bmore events?\b|\bmultiple\b|\bseveral\b|\ba few different\b|\bnot just\b|\bmore than one\b|\bdifferent (meetings|events|rituals|activities)\b/i;

/**
 * "Team Ritual Audit" (or "ritual audit") names the *sister app*
 * (src/config/suite.ts), not anything in this app's own library — but the
 * library happens to have a real ritual called "Calendar Audit / Meeting
 * Cleanse", which shares enough vocabulary with that name to win
 * findSingleRitualMatch's semantic check below (verified live: "Ritual
 * Audit" and even the literal full name both scored it well past the 0.72
 * threshold). That silently proposes scheduling the wrong thing instead of
 * routing to the other app at all. Checked before semantic search even
 * runs, same as ONE_ON_ONE_PATTERN — deliberately narrow to "ritual audit"
 * phrasing specifically, not bare "audit"/"calendar audit"/"meeting audit",
 * which should keep matching the real in-library ritual.
 */
const TEAM_RITUAL_AUDIT_PATTERN = /\b(team\s+)?ritual\s+audit\b/i;

async function findSingleRitualMatch(env: Env, db: Db, text: string) {
  if (ONE_ON_ONE_PATTERN.test(text)) {
    const [row] = await db.select().from(rituals).where(eq(rituals.slug, "manager-1-1")).limit(1);
    if (row) return row;
  }
  const matches = await semanticSearch(env, text, { type: "ritual", topK: 3 });
  if (matches.length === 0) return null;
  const [top, second] = matches;
  if (top.score < 0.72) return null;
  if (second && top.score - second.score < 0.04) return null; // ambiguous — let the normal flow handle it
  const [row] = await db.select().from(rituals).where(eq(rituals.id, top.refId)).limit(1);
  return row ?? null;
}

function singleRitualDefinition(ritual: (typeof rituals.$inferSelect)): CadenceDefinition {
  return {
    slots: [
      {
        name: ritual.title,
        freq: SINGLE_RITUAL_SLOT_FREQ[ritual.defaultCadence] ?? "weekly",
        byweekday: 2,
        durationMin: ritual.durationMin ?? 30,
        rotation: [{ position: 0, ritualSlug: ritual.slug, label: null }],
      },
    ],
    standalone: [],
  };
}

ai.post("/intent/converse", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);

  if (!(await checkRateLimit(db, session.teamId))) return c.json({ error: "AI rate limit reached — try again in a bit" }, 429);

  const body = await c
    .req.json<{
      messages?: ConverseMessage[];
      currentProposal?: { runId: number; definition: CadenceDefinition; durationWeeks: number; candidates: { slug: string; title: string }[] };
    }>()
    .catch(() => ({}) as Record<string, never>);
  const history = (body.messages ?? []).filter(
    (m): m is ConverseMessage => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0,
  );
  if (history.length === 0) return c.json({ error: "messages is required" }, 400);
  if (history.length > 20) return c.json({ error: "this conversation has gotten long — start a new one" }, 400);

  // Once a cadence has already been proposed, a reply is far more often a
  // small edit than a brand new design ask — checked before anything else
  // below, all of which assumes it's starting from zero. See
  // buildEditIntentTool's comment for why this exists: a full regeneration
  // on every turn was the actual root cause of "remove X" silently keeping
  // X, since the model had no memory of the structure it already built.
  if (body.currentProposal) {
    const { definition, candidates, durationWeeks } = body.currentProposal;
    const candidateTitleBySlug = new Map(candidates.map((cand) => [cand.slug, cand.title]));
    const rotationLabel = (r: CadenceRotationItemDef) => r.label ?? (r.ritualSlug ? (candidateTitleBySlug.get(r.ritualSlug) ?? r.ritualSlug) : "untitled");
    // A single-item slot is named as a whole (its own `name`, e.g. "Staff
    // Meeting"); a multi-item rotation is named by its individual positions
    // ("Product Showcase", "Learning") — those are the actual things a
    // "remove X" reply refers to, not the slot's own umbrella name. Missing
    // this the first time meant the model only ever saw one label for the
    // whole slot and could never recognize "product showcase" as anything
    // real to remove, defaulting to 'other' every time.
    const itemLabels = [
      ...definition.slots.flatMap((s) => (s.rotation.length > 1 ? s.rotation.map(rotationLabel) : [s.name])),
      ...definition.standalone.map((o) => (o.ritualSlug ? (candidateTitleBySlug.get(o.ritualSlug) ?? o.ritualSlug) : "a one-off item")),
    ];

    let editResult: EditIntentResult = { action: "other", targets: [], newItems: [], message: "" };
    try {
      const editCallResult = await runChatToolWithRetry(
        c.env.AI,
        CHAT_MODEL,
        {
          messages: [
            {
              role: "system",
              content: `You're revising a recurring meeting cadence you already proposed. Currently proposed: ${itemLabels.join(", ")}. You MUST call classify_edit exactly once.`,
            },
            ...history,
          ],
          tools: [buildEditIntentTool(itemLabels)],
          tool_choice: { type: "function", function: { name: "classify_edit" } },
          chat_template_kwargs: { enable_thinking: false },
          max_completion_tokens: 200,
          temperature: 0.1,
        },
        2,
      );
      const rawArgs = editCallResult.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (rawArgs) editResult = sanitizeEditIntentResult(parseToolCallArguments(rawArgs) as Record<string, unknown>);
    } catch {
      // Classification failed — fall through to the full pipeline below
      // rather than erroring the whole turn out.
    }

    // Defensive fallback, not just a required schema field: verified live
    // that the model sometimes correctly classifies action='remove' and
    // even names the item in its own `message` ("Removing Product
    // Showcase...") while still leaving the structured `targets` array
    // empty. Recover the target(s) by checking which known item labels
    // actually appear in its own message text before giving up and falling
    // through to a full regeneration.
    if (editResult.action === "remove" && editResult.targets.length === 0) {
      editResult = { ...editResult, targets: itemLabels.filter((label) => matchesLabel(editResult.message, [label])) };
    }
    // Same defensive gap for 'add': no fixed vocabulary to intersect
    // against here (unlike remove's known itemLabels), so the fallback is
    // simpler — just search on the user's own latest message verbatim
    // rather than dropping the add request entirely.
    if (editResult.action === "add" && editResult.newItems.length === 0) {
      const lastUser = history.filter((m) => m.role === "user").pop()?.content;
      if (lastUser) editResult = { ...editResult, newItems: [lastUser] };
    }

    if (editResult.action === "confirm") {
      const run = await logRun(db, { teamId: session.teamId, kind: "suggest", input: { converse: true, edit: "confirm" }, output: definition });
      return c.json({
        action: "propose" as const,
        message: editResult.message,
        jobSlugs: [],
        teamSize: null,
        workMode: null,
        horizonWeeks: null,
        destination: null,
        suggestion: { runId: run.id, definition, durationWeeks, candidates },
      });
    }

    if (editResult.action === "remove" && editResult.targets.length > 0) {
      // Applied directly against the persisted definition, not regenerated
      // — everything not matching a target survives byte-for-byte (same
      // ritualSlugs, same labels, same frequency). This is what actually
      // guarantees "keep the original," by construction rather than hope.
      const updated = removeMatchingItems(definition, editResult.targets, candidateTitleBySlug);
      if (updated.slots.length > 0 || updated.standalone.length > 0) {
        const run = await logRun(db, {
          teamId: session.teamId,
          kind: "suggest",
          input: { converse: true, edit: "remove", targets: editResult.targets },
          output: updated,
        });
        return c.json({
          action: "propose" as const,
          message: editResult.message,
          jobSlugs: [],
          teamSize: null,
          workMode: null,
          horizonWeeks: null,
          destination: null,
          suggestion: { runId: run.id, definition: updated, durationWeeks, candidates },
        });
      }
      // Removing everything requested would leave nothing — fall through
      // to a full regeneration instead of erroring the turn out.
    }

    if (editResult.action === "add" && editResult.newItems.length > 0) {
      // Unlike remove/confirm, finding what a new theme actually means
      // needs a real semantic lookup — but everything already proposed is
      // still untouched by construction, since we start from `definition`
      // and only append. This is what was missing before: "add a product
      // showcase" fell through to a full regeneration that didn't
      // recognize it as an incremental addition to the prior state.
      const { items: newRotationItems, newCandidates } = await resolveNewRotationItems(c.env, db, editResult.newItems);
      const updated: CadenceDefinition =
        definition.slots.length > 0
          ? {
              slots: [
                { ...definition.slots[0], rotation: [...definition.slots[0].rotation, ...newRotationItems].map((r, i) => ({ ...r, position: i })) },
                ...definition.slots.slice(1),
              ],
              standalone: definition.standalone,
            }
          : {
              slots: [],
              standalone: [
                ...definition.standalone,
                ...newRotationItems.map((r) => ({ ritualSlug: r.ritualSlug, titleOverride: r.label, dayOffset: 0, spanWeeks: null })),
              ],
            };
      const run = await logRun(db, {
        teamId: session.teamId,
        kind: "suggest",
        input: { converse: true, edit: "add", newItems: editResult.newItems },
        output: updated,
      });
      return c.json({
        action: "propose" as const,
        message: editResult.message,
        jobSlugs: [],
        teamSize: null,
        workMode: null,
        horizonWeeks: null,
        destination: null,
        suggestion: { runId: run.id, definition: updated, durationWeeks, candidates: [...candidates, ...newCandidates] },
      });
    }
    // action === "other" (or an empty-result remove/add): fall through,
    // ignore currentProposal, and proceed with the existing pipeline below
    // exactly as if this were a conversation with no proposal yet.
  }

  // A dominant, unambiguous single-ritual match is checked before the model
  // even runs — this is what actually fixes "a plain '1:1' ask gets odd
  // follow-up questions": a small fast tool-calling model was inconsistent
  // turn to turn about whether that's action='propose' or a
  // destination='ritual' route, and either way it shouldn't need to gather
  // a job/team-size for something that's already a known, fully-specified
  // ritual. Skipping the model call entirely here is both more reliable and
  // cheaper than trying to prompt-engineer around that inconsistency.
  //
  // Only checked on the very first user turn. It used to re-run every turn
  // against the *whole* accumulated conversation, which meant a match found
  // on turn 1 kept winning forever — a "no, something else" reply on turn 2
  // never reached the model at all, because this short-circuit fired first
  // and returned the exact same suggestion again. Once the user starts
  // iterating, the full conversational model (which sees the prior
  // suggestion and the rejection in its own message history) is what should
  // be reacting, not a stateless re-match of everything said so far.
  const userTurns = history.filter((m) => m.role === "user");
  const conversationText = userTurns.map((m) => m.content).join(" ");

  // Checked before anything else, including findSingleRitualMatch below —
  // "ritual audit" naming the sister app must never be treated as a library
  // search at all, not even to lose a close race against the real
  // "Calendar Audit / Meeting Cleanse" ritual.
  if (TEAM_RITUAL_AUDIT_PATTERN.test(conversationText)) {
    return c.json({
      action: "route" as const,
      message: "Team Ritual Audit is a separate app — I'll take you there.",
      jobSlugs: [],
      teamSize: null,
      workMode: null,
      horizonWeeks: null,
      destination: "audit" as const,
      wantsMultiple: false,
      rotationThemes: [],
    });
  }

  const singleMatch = userTurns.length === 1 ? await findSingleRitualMatch(c.env, db, conversationText) : null;
  if (singleMatch) {
    const definition = singleRitualDefinition(singleMatch);
    const run = await logRun(db, { teamId: session.teamId, kind: "suggest", input: { converse: true, text: conversationText }, output: definition });
    return c.json({
      action: "propose" as const,
      message: `Found "${singleMatch.title}" in the library${singleMatch.summary ? ` — ${singleMatch.summary}` : ""} Want me to add it to your calendar?`,
      jobSlugs: [],
      teamSize: null,
      workMode: null,
      horizonWeeks: null,
      destination: null,
      suggestion: {
        runId: run.id,
        definition,
        durationWeeks: 12,
        candidates: [{ slug: singleMatch.slug, title: singleMatch.title }],
      },
    });
  }

  const jobRows = await db.select().from(jobs);
  const jobSlugsAllowed = jobRows.map((j) => j.slug);

  const systemPrompt = [
    "You're a friendly assistant in a team-ritual scheduling app, helping someone design a recurring meeting cadence for their team through a short conversation.",
    `Jobs to be done (only ever use these slugs): ${jobRows.map((j) => `${j.slug} (${j.name})`).join(", ")}`,
    "You MUST call `respond` exactly once per turn.",
    "To design a cadence you need at minimum one job-to-be-done and a team size. Work mode and plan length are optional — default plan length to 12 weeks if it never comes up.",
    "If something required is still missing, set action='ask' and ask for exactly ONE missing thing next — don't list everything at once.",
    "If they're specifically asking for a 1:1 / one-on-one, team size is always 2 — never ask for it. If no other goal is mentioned, default jobSlugs to ['build-cohesion'] and move straight to propose instead of asking what the 1:1 is for.",
    "Naming ANY specific kind of session to schedule — a design jam, a standup, a retro, a 1:1, a demo day, however small or however poorly it maps to the job list above — always means action='ask' or 'propose', NEVER destination='ritual' and NEVER a message offering a choice between 'browse the library' and 'build a custom cadence'. That choice doesn't exist in this flow and must never be presented. If the thing they named doesn't map cleanly to a job slug, just pick the single closest one yourself (e.g. build-cohesion for a social/team activity, raise-quality for a craft/design activity) instead of asking which job it serves or second-guessing whether to route to the library.",
    "destination='ritual' is ONLY for an explicit request to browse or look through the library with no scheduling intent at all (e.g. 'show me what rituals exist', 'let me look through the library') — never for a request to schedule something specific, however unfamiliar.",
    "If they decline your proposal by saying they'll build it themselves, do it manually, do their own thing, or similar — even if a job/team size was already established earlier in this conversation — that is ALWAYS action='route' with destination='plan' (the blank plan builder), so they land somewhere they can actually start typing. NEVER destination='ritual' for this: declining AI help is not the same as wanting to browse the library, and sending them there instead of the plan builder leaves them nowhere to actually build anything.",
    "The moment you have at least one job and a team size, whether given all at once or gathered turn by turn, set action='propose' with a short 1-2 sentence summary of what you're about to build and ask them to confirm.",
    "Default to wantsMultiple=false — one focused recurring activity, which is what most asks actually want. Only set it true when they explicitly ask for more than one: 'more events', 'a few different meetings', 'not just X', pushing back on a single-item proposal, or naming two or more distinct activities themselves. Your own summary message must match this exactly — if wantsMultiple is false, don't describe multiple activities in the message (that's a promise the proposal won't keep); if true, the message should describe more than one.",
    "If the very first message is clearly not about building a cadence at all — they want their existing calendar, an audit, or an entirely blank plan with no specifics — set action='route' instead, and you MUST also set destination to the matching one of plan/ritual/calendar/audit. Never set action='route' without also setting destination, and never phrase a route's message as a question — routing happens immediately, the user won't get a chance to answer.",
    "After you've already proposed something, they may reply asking to change it — 'remove the monthly team pulse', 'drop the retro', 'the weekly sync is plenty' (implicitly dropping whatever else was in a multi-item proposal). Put a short label for whatever they're dropping into excludeThemes and keep action='propose' so you regenerate — do NOT just repeat your previous message unchanged, and do NOT treat this as a brand new ask that forgets the job/teamSize/rotationThemes already established. Your new message must actually acknowledge the change (e.g. 'Just the weekly sync then — confirm?'), not restate the old summary verbatim.",
    "Always carry forward every fact already established earlier in the conversation into jobSlugs/teamSize/workMode/horizonWeeks/wantsMultiple/rotationThemes/excludeThemes, even on turns where you're asking or talking about something else — never drop a fact once given.",
  ].join(" ");

  let result: ChatToolResult;
  try {
    result = await runChatToolWithRetry(
      c.env.AI,
      CHAT_MODEL,
      {
        messages: [{ role: "system", content: systemPrompt }, ...history],
        tools: [buildConverseTool(jobSlugsAllowed)],
        tool_choice: { type: "function", function: { name: "respond" } },
        chat_template_kwargs: { enable_thinking: false },
        max_completion_tokens: 400,
        // Low, not 0.3: this is a classification task (which of a handful of
        // known actions applies), not creative generation — the same input
        // giving a different action/destination turn to turn reads as an
        // outright bug to a user ("I typed the exact same thing and got
        // routed somewhere else"), which temperature 0.3 was doing in
        // practice for ambiguous asks like "schedule a design jam."
        temperature: 0.1,
      },
      2,
    );
  } catch {
    return c.json({ error: "the AI service is temporarily unavailable — try again shortly" }, 502);
  }

  const rawArgs = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!rawArgs) return c.json({ error: "the model did not respond — try again" }, 502);
  const parsed = sanitizeConverseResult(parseToolCallArguments(rawArgs) as Record<string, unknown>, new Set(jobSlugsAllowed));

  // The client never resends jobSlugs — the model has to re-derive it from
  // the raw transcript every single turn, and that extraction is unreliable
  // enough in practice to come back empty even when its own message text
  // shows it understood the ask (see matchJobSlugsFromText's comment). Since
  // an empty jobSlugs is exactly what triggers the "which job?" reprompt
  // below, leaving this unfixed is an infinite identical-question loop.
  if (parsed.jobSlugs.length === 0) {
    parsed.jobSlugs = matchJobSlugsFromText(conversationText, jobRows);
  }

  await logRun(db, { teamId: session.teamId, kind: "intent", input: { messages: history }, output: parsed });

  // Defensive downgrade: "route" with no usable destination would otherwise
  // reach the frontend's switch statement and silently do nothing — the
  // model's own message is usually still fine here, so just keep the
  // conversation open instead of dropping it on the floor.
  if (parsed.action === "route" && !parsed.destination) {
    return c.json({ ...parsed, action: "ask" as const });
  }

  // Defensive downgrade: a "route" whose own message ends in a question mark
  // is self-contradictory — routing navigates immediately, so a question
  // phrased as "browse the library, or want a custom cadence?" would fire
  // off to destination='ritual' before the user ever gets to answer it. This
  // is exactly the observed instability for asks like "schedule a design
  // jam" that don't map cleanly to a job slug: keep the conversation open
  // instead of silently navigating on what the model itself framed as an
  // open question.
  if (parsed.action === "route" && parsed.message.trim().endsWith("?")) {
    return c.json({ ...parsed, action: "ask" as const, destination: null });
  }

  if (parsed.action !== "propose") {
    return c.json(parsed);
  }

  // Defensive downgrade: never claim "propose" without the minimum the
  // model was explicitly told it needs — same discipline as everywhere
  // else here, don't trust the schema alone.
  if (parsed.jobSlugs.length === 0 || !parsed.teamSize) {
    return c.json({
      ...parsed,
      action: "ask" as const,
      message: parsed.jobSlugs.length === 0 ? "Which job or team does this cadence need to serve?" : "How many people are on the team?",
    });
  }

  const outcome = await generateCadenceSuggestion(c.env, db, session.teamId, {
    jobSlugs: parsed.jobSlugs,
    teamSizeMin: parsed.teamSize,
    teamSizeMax: parsed.teamSize,
    workMode: parsed.workMode ?? undefined,
    horizonWeeks: parsed.horizonWeeks ?? 12,
    // "focused" (one activity, no padding) is the default; flips to "broad"
    // once the user has explicitly asked for more than one thing. Hardcoding
    // "focused" here regardless was itself a bug — and the model's own
    // wantsMultiple flag turned out unreliable enough (see
    // WANTS_MULTIPLE_PATTERN above) that a plain text check on what they
    // actually typed is ORed in as a safety net.
    scope: parsed.wantsMultiple || WANTS_MULTIPLE_PATTERN.test(conversationText) ? "broad" : "focused",
    // The very first thing they said, not the whole conversation — later
    // turns are just filling in team size etc. and would only dilute this.
    focusText: userTurns[0]?.content,
    rotationThemes: parsed.rotationThemes,
    excludeThemes: parsed.excludeThemes,
  });

  if (!outcome.ok) {
    return c.json({
      ...parsed,
      action: "ask" as const,
      message: "I couldn't find enough in the library to build that yet — want to try a different job, or start blank instead?",
    });
  }

  return c.json({
    ...parsed,
    suggestion: { runId: outcome.runId, definition: outcome.definition, durationWeeks: outcome.durationWeeks, candidates: outcome.candidates },
  });
});

// ─── Cadence suggestion ─────────────────────────────────────────────────────
// "Design my quarter" (PLAN.md §5.6 #2). Retrieval-grounded: the model only
// ever sees a candidate slug list pulled from Vectorize for the selected
// jobs, but nothing in the tool schema forces it to that list (enums with
// a couple dozen options destabilized the schema — see the comment above
// CHAT_MODEL) — so we still re-check every slug server-side afterward.
// Never trust a model's adherence to its own schema as the only guardrail.

// llama-3.1-8b-instruct was deprecated 2026-05-30. Of Cloudflare's current
// recommended tool-calling replacements: kimi-k2.6 returns clean JSON
// arguments but its "thinking" pass on a 24-slug schema reliably blows past
// the AI binding's response timeout (verified live — every real request
// 504'd). glm-4.7-flash answers in ~5s but leaks its raw <tool_call> template
// markup into `function.arguments` instead of plain JSON — also verified
// live, via a min-repro against the real binding. Fast-and-malformed beats
// correct-and-unusable here, so glm-4.7-flash + parseToolCallArguments()
// below (which repairs that markup) is what's actually wired up.
const CHAT_MODEL = "@cf/zai-org/glm-4.7-flash";

/**
 * glm-4.7-flash sometimes returns `<tool_call>NAME<arg_key>k</arg_key>
 * <arg_value>v</arg_value>...</tool_call>` — its own internal tool-call
 * template, unrendered — instead of a plain JSON object. Each v is itself
 * valid JSON, so this reconstructs the intended object from the key/value
 * pairs when the argument string isn't parseable JSON on its own.
 */
function parseToolCallArguments(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // fall through to template repair below
  }
  const obj: Record<string, unknown> = {};
  const re = /<arg_key>([^<]+)<\/arg_key>\s*<arg_value>([\s\S]*?)<\/arg_value>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    try {
      obj[m[1]] = JSON.parse(m[2]);
    } catch {
      obj[m[1]] = m[2];
    }
  }
  return obj;
}

type ChatToolResult = { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] };

/**
 * glm-4.7-flash's hosted endpoint intermittently 5xxs on otherwise-valid
 * requests (verified live — identical requests succeeded on retry with no
 * changes). A couple of quick retries absorbs that without surfacing a
 * transient infra blip as a hard failure to the user.
 */
async function runChatToolWithRetry(ai: Ai, model: string, args: Record<string, unknown>, attempts = 3): Promise<ChatToolResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (await (ai.run as any)(model, args)) as ChatToolResult;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
const FREQS = ["weekly", "biweekly", "monthly"] as const;

interface SuggestCadenceBody {
  jobSlugs?: string[];
  teamSizeMin?: number;
  teamSizeMax?: number;
  workMode?: "remote" | "hybrid" | "in-person";
  seniority?: string;
  currentLoad?: string;
  horizonWeeks?: number;
  auditScore?: number;
  /**
   * "focused" = the conversational intent box asking for one specific named
   * thing ("schedule a creative jam") — narrow by construction, so a whole
   * quarter's worth of one-off sessions reads as overkill, not helpful.
   * "broad" (default) = the explicit multi-job "Design my quarter" form,
   * where proposing a fuller cadence across several jobs is the actual ask.
   */
  scope?: "focused" | "broad";
  /**
   * The user's own words for a focused ask (e.g. "schedule a creative
   * jam") — jobSlugs alone throw this away, leaving retrieval and the final
   * pick grounded only in the *job's* generic description ("raise the
   * quality of our craft") rather than the specific thing asked for. That's
   * how a "creative jam" ask came back proposing "Design Crit" — a real
   * candidate for that job, but not what was actually named. When present,
   * this text drives retrieval and the model is told the result must
   * clearly match it, not just the general job area.
   */
  focusText?: string;
  /**
   * Explicit named themes for one slot's rotation ("alignment, product
   * showcase, creative jam, learning") — the PLAN.md §1.3 anchor case (one
   * slot, N rituals rotating through it), captured directly instead of
   * left for the model to infer from focusText alone. When present, one
   * slot's rotation gets exactly one item per theme.
   */
  rotationThemes?: string[];
  /**
   * Things explicitly asked to be dropped from an earlier proposal in this
   * conversation ("remove the monthly team pulse") — a hard exclusion, not
   * a preference. Enforced both in the generation prompt and by a
   * server-side filter afterward (never trust the model alone), since
   * verified live: without any memory of what to exclude, a follow-up
   * "remove X" just regenerated from scratch and silently kept X anyway.
   */
  excludeThemes?: string[];
}

function buildCadenceTool() {
  return {
    type: "function" as const,
    function: {
      name: "propose_cadence",
      description: "Propose a recurring meeting cadence assembled only from the given candidate ritual slugs.",
      parameters: {
        type: "object",
        properties: {
          slots: {
            type: "array",
            description: "Recurring weekly/biweekly/monthly meeting slots, each with a rotation of one or more rituals.",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "Human label for the slot, e.g. 'Weekly Design Sync'" },
                freq: { type: "string", enum: FREQS },
                byweekday: { type: "integer", description: "0=Sunday .. 6=Saturday" },
                nth: { type: "integer", description: "monthly frequency only: 1-4 for the nth weekday of the month, or -1 for the last" },
                durationMin: { type: "integer" },
                rotation: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      ritualSlug: { type: "string", description: "must be one of the candidate slugs given in the prompt — omit if nothing on the list is a real match" },
                      label: { type: "string", description: "a short theme name for this position when no candidate is a real match — e.g. 'Creative Jam'. Set exactly one of ritualSlug or label, never both." },
                    },
                  },
                },
              },
              required: ["name", "freq", "byweekday", "rotation"],
            },
          },
          standalone: {
            type: "array",
            description: "One-off sessions or multi-week campaigns not on a weekly rhythm.",
            items: {
              type: "object",
              properties: {
                ritualSlug: { type: "string", description: "must be one of the candidate slugs given in the prompt" },
                dayOffset: { type: "integer", description: "days from the plan's start date, 0-based" },
                spanWeeks: { type: "integer", description: "omit for a single day; set for a multi-week campaign" },
              },
              required: ["ritualSlug", "dayOffset"],
            },
          },
        },
        required: ["slots", "standalone"],
      },
    },
  };
}

interface RawSlot {
  name?: string;
  freq?: string;
  byweekday?: number;
  nth?: number;
  durationMin?: number;
  rotation?: { ritualSlug?: string; label?: string }[];
}
interface RawStandalone {
  ritualSlug?: string;
  dayOffset?: number;
  spanWeeks?: number;
}

/** Coerces the model's raw tool-call arguments into a valid CadenceDefinition, dropping any ritual slug not in `validSlugs` rather than trusting the model kept to its own enum. */
function sanitizeDefinition(raw: { slots?: RawSlot[]; standalone?: RawStandalone[] }, validSlugs: Set<string>): CadenceDefinition {
  const slots: CadenceSlotDef[] = (raw.slots ?? [])
    .filter((s) => s.name && s.freq && typeof s.byweekday === "number")
    .map((s) => ({
      name: s.name!,
      freq: (FREQS as readonly string[]).includes(s.freq!) ? (s.freq as CadenceSlotDef["freq"]) : "weekly",
      byweekday: Math.min(6, Math.max(0, Math.round(s.byweekday!))),
      nth: s.freq === "monthly" && typeof s.nth === "number" ? (s.nth === -1 ? -1 : Math.min(4, Math.max(1, Math.round(s.nth)))) : null,
      durationMin: typeof s.durationMin === "number" ? Math.round(s.durationMin) : null,
      rotation: (s.rotation ?? [])
        .map((r, i) => ({ position: i, ritualSlug: r.ritualSlug && validSlugs.has(r.ritualSlug) ? r.ritualSlug : null, label: r.label?.trim() || null }))
        // Kept as a plain-label position (no ritual yet) rather than
        // dropped outright — an invented/invalid ritualSlug with a real
        // label is still a real, named rotation position, matching how
        // rotation_items.label already works for manually-typed slots.
        .filter((r) => r.ritualSlug !== null || r.label !== null),
    }))
    .filter((s) => s.rotation.length > 0);

  const standalone: CadenceStandaloneDef[] = (raw.standalone ?? [])
    .filter((o) => o.ritualSlug && validSlugs.has(o.ritualSlug) && typeof o.dayOffset === "number")
    .map((o) => ({
      ritualSlug: o.ritualSlug!,
      titleOverride: null,
      dayOffset: Math.max(0, Math.round(o.dayOffset!)),
      spanWeeks: typeof o.spanWeeks === "number" && o.spanWeeks > 0 ? Math.round(o.spanWeeks) : null,
    }));

  return { slots, standalone };
}

type GenerateCadenceOutcome =
  | { ok: true; runId: number; definition: CadenceDefinition; durationWeeks: number; candidates: { slug: string; title: string }[] }
  | { ok: false; status: 400 | 422 | 502; error: string };

/** Fuzzy, case-insensitive, either-direction substring match — "monthly team pulse" matches "Monthly Team Pulse" or a partial phrase either way. */
function matchesLabel(text: string | null | undefined, targets: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return targets.some((target) => {
    const t = target.toLowerCase();
    return lower.includes(t) || t.includes(lower);
  });
}

/**
 * Removes any slot, rotation position, or standalone item matching `targets`
 * from a CadenceDefinition. Shared by two call sites that both need the
 * identical matching behavior: the excludeThemes defensive filter right
 * after a fresh generation, and the patch-based "remove X" edit applied
 * directly against an already-proposed, persisted definition (see
 * `/intent/converse`'s currentProposal branch) — the latter is what
 * actually guarantees "keep everything else exactly as it was," since it
 * operates on the real prior structure instead of asking the model to
 * reconstruct it.
 *
 * Renumbers remaining rotation positions to stay 0..N-1 with no gaps —
 * worker/schedule.ts's `position % cycleLength` rotation math depends on it.
 */
function removeMatchingItems(definition: CadenceDefinition, targets: string[], titleBySlug: Map<string, string>): CadenceDefinition {
  if (targets.length === 0) return definition;
  const resolveTitle = (slug: string | null) => (slug ? titleBySlug.get(slug) : undefined);
  return {
    slots: definition.slots
      .map((s) => ({
        ...s,
        rotation: s.rotation
          .filter((r) => !matchesLabel(r.label, targets) && !matchesLabel(resolveTitle(r.ritualSlug), targets))
          .map((r, i) => ({ ...r, position: i })),
      }))
      .filter((s) => s.rotation.length > 0 && !matchesLabel(s.name, targets)),
    standalone: definition.standalone.filter((o) => !matchesLabel(resolveTitle(o.ritualSlug), targets)),
  };
}

/**
 * The actual generation pipeline, factored out so both the one-shot
 * `/suggest-cadence` endpoint and the conversational builder's "propose"
 * step (below) share one implementation instead of two copies drifting
 * apart. Rate limiting stays with the caller — this runs exactly one
 * generation, however it got triggered.
 */
async function generateCadenceSuggestion(env: Env, db: Db, teamId: string, body: SuggestCadenceBody): Promise<GenerateCadenceOutcome> {
  const jobSlugs = (body.jobSlugs ?? []).filter(Boolean);
  if (jobSlugs.length === 0) return { ok: false, status: 400, error: "at least one job is required" };
  const horizonWeeks = Math.min(52, Math.max(1, Math.round(body.horizonWeeks ?? 12)));

  const jobRows = await db.select().from(jobs).where(inArray(jobs.slug, jobSlugs));
  if (jobRows.length === 0) return { ok: false, status: 400, error: "unknown jobs" };

  const focused = body.scope === "focused";
  // The conversation's own words ("schedule a creative jam") must lead
  // retrieval whenever they're available — falling back to the job's
  // generic description ("raise the quality of our craft") is how a
  // "creative jam" ask came back proposing "Design Crit": a real candidate
  // for that job, but not what was actually named. This applies to any
  // conversational ask (focusText is only ever set by that path, never by
  // the explicit multi-job "design my quarter" form) — not just a focused,
  // single-item one; someone who said "more events, not just a staff
  // meeting" still named specific intent that generic job descriptions
  // alone would wash out. Job names still ride along as secondary
  // grounding, not the primary signal.
  const rotationThemes = body.rotationThemes ?? [];
  const excludeThemes = body.excludeThemes ?? [];
  const retrievalQuery = body.focusText
    ? `${[body.focusText, ...rotationThemes].join(". ")}. Serves: ${jobRows.map((j) => j.name).join(", ")}`
    : jobRows.map((j) => [j.name, j.description].filter(Boolean).join(" — ")).join(". ");
  // A focused ask only needs a handful of close candidates — handing it the
  // same 24 a multi-job "design my quarter" gets just gives the model more
  // material to pad the proposal with. Scales up a bit with more named
  // themes so each one actually has real candidates to draw from, not just
  // whatever's left over after the first couple.
  const topK = focused ? Math.max(8, rotationThemes.length * 4) : 24;
  const matches = await semanticSearch(env, retrievalQuery, { type: "ritual", topK });
  if (matches.length === 0) return { ok: false, status: 422, error: "not enough indexed content yet — run the embedding backfill first" };

  const candidateRows = await db
    .select()
    .from(rituals)
    .where(inArray(rituals.id, matches.map((m) => m.refId)));
  if (candidateRows.length === 0) return { ok: false, status: 422, error: "not enough indexed content yet" };

  const candidateSlugs = candidateRows.map((r) => r.slug);
  const candidateLines = candidateRows
    .map(
      (r) =>
        `- ${r.slug}: "${r.title}" (${r.engagement}, ${r.load} load${r.durationMin ? `, ${r.durationMin}min` : ""}, size ${r.sizeMin ?? "?"}-${r.sizeMax ?? "?"})${r.summary ? ` — ${r.summary}` : ""}`,
    )
    .join("\n");

  // Effective team size for the frequency rule below: prefer the max of the
  // given range (the rule is about avoiding overloading the *largest*
  // plausible group), falling back to the min if only that was given.
  const teamSize = body.teamSizeMax ?? body.teamSizeMin;

  const contextLines = [
    body.focusText ? `The user specifically asked for: "${body.focusText}"` : null,
    rotationThemes.length ? `They named these specific rotation themes, in order: ${rotationThemes.map((t) => `"${t}"`).join(", ")}` : null,
    excludeThemes.length ? `They explicitly asked to REMOVE/EXCLUDE: ${excludeThemes.map((t) => `"${t}"`).join(", ")} — never include anything matching these.` : null,
    `Jobs to serve: ${jobRows.map((j) => j.name).join(", ")}`,
    body.teamSizeMin || body.teamSizeMax ? `Team size: ${body.teamSizeMin ?? "?"}-${body.teamSizeMax ?? "?"}` : null,
    body.workMode ? `Work mode: ${body.workMode}` : null,
    body.seniority ? `Seniority mix: ${body.seniority}` : null,
    body.currentLoad ? `Current meeting load: ${body.currentLoad}` : null,
    typeof body.auditScore === "number" ? `Team Ritual Audit score: ${body.auditScore}/100` : null,
    `Plan horizon: ${horizonWeeks} weeks`,
  ].filter(Boolean);

  const systemPrompt =
    "You design recurring team meeting cadences. You MUST call propose_cadence exactly once. " +
    "Every ritualSlug you use must come from the candidate list — never invent one. " +
    "Prefer a small, sustainable set of slots over cramming in every candidate. " +
    "byweekday is 0=Sunday..6=Saturday. Spread slots across different weekdays rather than stacking them on one day. " +
    (teamSize
      ? `The team size given is ${teamSize}. The larger the team, the less often a whole-team ritual should repeat: for a slot whose rotation is entirely large-group rituals (size range covers ${teamSize} or has no upper bound), prefer biweekly or monthly over weekly once the team is bigger than about 15 people — the larger past that, the less frequent it should be. Smaller-group or pair/subteam rituals (size range well below ${teamSize}) can still repeat weekly regardless of overall team size.`
      : "No team size was given — don't guess one; frequency doesn't need to account for team size here.") +
    (focused
      ? " This is a narrow request for ONE specific activity, not a full quarter plan — propose exactly ONE slot (a second only if it's an unmistakable natural pairing, e.g. a prep session the ritual explicitly depends on). Do NOT add standalone one-off sessions unless the ask itself clearly described more than one activity. Do not use the rest of the candidate list just because it's there."
      : "") +
    (body.focusText
      ? ` The ritual(s) you pick must clearly be what was actually asked for ("${body.focusText}") — a candidate that only serves the general job area but doesn't match the specific activity(ies) named is the wrong pick, even if it's the closest thing on the list. If nothing on the candidate list is a genuine match for what was named, pick the closest real fit and name the slot after what they asked for (e.g. "Creative Jam") rather than the underlying ritual's own title.`
      : "") +
    (rotationThemes.length
      ? ` They named ${rotationThemes.length} specific rotation themes (listed above) — build exactly ONE slot whose rotation array has exactly ${rotationThemes.length} positions, one per theme, in the order given. For each position: use the closest matching candidate ritualSlug if one is a genuine fit for that specific theme; otherwise omit ritualSlug and set label to that theme's name instead (e.g. label: "Creative Jam") rather than forcing a mismatched candidate or dropping the theme. Never merge two named themes into one position, and never add extra positions beyond the ${rotationThemes.length} named.`
      : "") +
    (excludeThemes.length
      ? ` They explicitly asked to remove ${excludeThemes.map((t) => `"${t}"`).join(" and ")} from what was previously proposed — this is a hard exclusion. Do not include any slot, standalone item, or rotation position whose name or theme matches any of these, even if it otherwise fits well. If excluding it leaves only one item, that is the correct, expected result — do not backfill with something else to compensate.`
      : "");

  const userPrompt = `${contextLines.join("\n")}\n\nCandidate rituals (use only these slugs):\n${candidateLines}\n\nPropose a cadence for this team.`;

  const tool = buildCadenceTool();
  let result: ChatToolResult;
  try {
    result = await runChatToolWithRetry(env.AI, CHAT_MODEL, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      tools: [tool],
      // Forces the call instead of leaving the model free to just reply in
      // prose — this endpoint has no use for anything but the structured
      // proposal.
      tool_choice: { type: "function", function: { name: "propose_cadence" } },
      chat_template_kwargs: { enable_thinking: false },
      max_completion_tokens: 2000,
      temperature: 0,
    });
  } catch {
    return { ok: false, status: 502, error: "the AI service is temporarily unavailable — try again shortly" };
  }

  const rawArgs = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!rawArgs) return { ok: false, status: 502, error: "the model did not return a proposal — try again" };
  const parsed = parseToolCallArguments(rawArgs);

  const validSlugs = new Set(candidateSlugs);
  let definition = sanitizeDefinition(parsed as { slots?: RawSlot[]; standalone?: RawStandalone[] }, validSlugs);
  if (definition.slots.length === 0 && definition.standalone.length === 0) {
    return { ok: false, status: 502, error: "the model's proposal didn't use any valid rituals — try again" };
  }

  // Consolidate for rotationThemes BEFORE the focused-cap slice below —
  // the model doesn't reliably keep several named themes in one slot's
  // rotation even when told to (verified live: 4 named themes came back
  // split across 2 slots on different days with one dropped entirely).
  // Flatten whatever it returned into exactly one slot, deterministically,
  // rather than trusting the prompt instruction alone.
  if (rotationThemes.length > 1 && definition.slots.length > 0) {
    const allRotation = definition.slots.flatMap((s) => s.rotation);
    const seen = new Set<string>();
    const consolidatedRotation: CadenceRotationItemDef[] = [];
    for (const item of allRotation) {
      const key = item.ritualSlug ?? item.label ?? "";
      if (!key || seen.has(key)) continue;
      seen.add(key);
      consolidatedRotation.push(item);
      if (consolidatedRotation.length >= rotationThemes.length) break;
    }
    const primary = definition.slots[0];
    definition = {
      slots: [{ ...primary, rotation: consolidatedRotation.map((r, i) => ({ ...r, position: i })) }],
      standalone: [], // a named-rotation ask means one recurring slot, not extra one-offs
    };
  }

  // Defensive cap, not just prompt guidance: a "focused" ask still shouldn't
  // come back as a dozen-item proposal even if the model didn't fully
  // follow the system prompt above — same "never trust the schema alone"
  // discipline as elsewhere in this file. No-op once consolidation above
  // has already reduced to one slot.
  if (focused) {
    definition = { slots: definition.slots.slice(0, 2), standalone: definition.standalone.slice(0, 1) };
  }

  // Same discipline for excludeThemes: strip anything matching a requested
  // removal even if the model included it anyway.
  if (excludeThemes.length) {
    const candidateTitleBySlug = new Map(candidateRows.map((r) => [r.slug, r.title]));
    definition = removeMatchingItems(definition, excludeThemes, candidateTitleBySlug);
    if (definition.slots.length === 0 && definition.standalone.length === 0) {
      return { ok: false, status: 502, error: "excluding everything requested left nothing to propose — try describing what you do want" };
    }
  }

  const run = await logRun(db, { teamId, kind: "suggest", input: body, output: definition });

  return {
    ok: true,
    runId: run.id,
    definition,
    durationWeeks: horizonWeeks,
    candidates: candidateRows.map((r) => ({ slug: r.slug, title: r.title })),
  };
}

ai.post("/suggest-cadence", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);

  if (!(await checkRateLimit(db, session.teamId))) return c.json({ error: "AI rate limit reached — try again in a bit" }, 429);

  const body = await c.req.json<SuggestCadenceBody>().catch(() => ({}) as SuggestCadenceBody);
  const outcome = await generateCadenceSuggestion(c.env, db, session.teamId, body);
  if (!outcome.ok) return c.json({ error: outcome.error }, outcome.status);

  return c.json({ runId: outcome.runId, definition: outcome.definition, durationWeeks: outcome.durationWeeks, candidates: outcome.candidates });
});

ai.post("/suggest-cadence/:runId/accept", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const runId = parseInt(c.req.param("runId"), 10);
  if (Number.isNaN(runId)) return c.json({ error: "invalid run id" }, 400);

  const [run] = await db.select().from(aiRuns).where(and(eq(aiRuns.id, runId), eq(aiRuns.teamId, session.teamId), eq(aiRuns.kind, "suggest"))).limit(1);
  if (!run) return c.json({ error: "not found" }, 404);

  const body = await c
    .req.json<{ definition?: CadenceDefinition; startDate?: string; durationWeeks?: number; name?: string; timezone?: string }>()
    .catch(() => ({}) as Record<string, never>);
  if (!body.startDate) return c.json({ error: "startDate is required" }, 400);
  // The user reviews and can edit the diff before accepting (PLAN.md §5.6 #2)
  // — trust their edited definition over the run's original stored output.
  const definition = body.definition ?? (run.output as CadenceDefinition);

  const plan = await instantiatePlanFromDefinition(db, {
    teamId: session.teamId,
    userId: session.userId,
    definition,
    startDate: body.startDate,
    durationWeeks: Math.min(52, Math.max(1, Math.round(body.durationWeeks ?? 12))),
    name: body.name?.trim() || "AI-suggested plan",
    timezone: body.timezone,
  });

  await db.update(aiRuns).set({ output: definition, accepted: true }).where(eq(aiRuns.id, runId));

  return c.json({ item: plan }, 201);
});

ai.post("/suggest-cadence/:runId/discard", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const runId = parseInt(c.req.param("runId"), 10);
  if (Number.isNaN(runId)) return c.json({ error: "invalid run id" }, 400);

  const [row] = await db.update(aiRuns).set({ accepted: false }).where(and(eq(aiRuns.id, runId), eq(aiRuns.teamId, session.teamId))).returning();
  if (!row) return c.json({ error: "not found" }, 404);
  return c.json({ success: true });
});

// ─── Balance & spacing analysis ─────────────────────────────────────────────
// PLAN.md §5.6 #3: "category mix, hours per person per week, clustering,
// gaps. Mostly arithmetic; the model writes only the narrative." Every
// number below is computed here, not by the model — the AI call only turns
// numbers it's given into two sentences of prose.

ai.get("/plans/:planId/balance", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const plan = await getOwnedPlan(db, c.req.param("planId"), session.teamId);
  if (!plan) return c.json({ error: "not found" }, 404);

  if (!(await checkRateLimit(db, session.teamId))) return c.json({ error: "AI rate limit reached — try again in a bit" }, 429);

  const [rows, warnings] = await Promise.all([
    db
      .select({ occurrence: occurrences, ritual: rituals, category: categories })
      .from(occurrences)
      .innerJoin(rituals, eq(rituals.id, occurrences.ritualId))
      .leftJoin(categories, eq(categories.id, rituals.categoryId))
      .where(and(eq(occurrences.planId, plan.id), eq(occurrences.status, "planned"))),
    computePlanWarnings(db, plan),
  ]);

  const weeksInPlan = Math.max(1, Math.ceil((daysBetweenISO(plan.startDate, plan.endDate) + 1) / 7));

  const categoryCounts = new Map<string, number>();
  let totalMinutes = 0;
  const occurrencesByWeek = new Map<number, number>();
  for (const row of rows) {
    const categoryName = row.category?.name ?? "Uncategorized";
    categoryCounts.set(categoryName, (categoryCounts.get(categoryName) ?? 0) + 1);
    totalMinutes += row.ritual.durationMin ?? 30;
    const wk = weekBucket(row.occurrence.date);
    occurrencesByWeek.set(wk, (occurrencesByWeek.get(wk) ?? 0) + 1);
  }

  const categoryMix = [...categoryCounts.entries()]
    .map(([name, count]) => ({ name, count, pct: Math.round((count / Math.max(1, rows.length)) * 100) }))
    .sort((a, b) => b.count - a.count);

  const startWeek = weekBucket(plan.startDate);
  let gapWeeks = 0;
  let busiestWeekCount = 0;
  for (let i = 0; i < weeksInPlan; i++) {
    const count = occurrencesByWeek.get(startWeek + i) ?? 0;
    if (count === 0) gapWeeks++;
    if (count > busiestWeekCount) busiestWeekCount = count;
  }

  const stats = {
    totalOccurrences: rows.length,
    weeksInPlan,
    avgHoursPerWeek: Math.round((totalMinutes / 60 / weeksInPlan) * 10) / 10,
    busiestWeekCount,
    gapWeeks,
    categoryMix,
  };

  if (rows.length === 0) {
    return c.json({ narrative: "This plan doesn't have any scheduled occurrences yet — add a slot or two before checking balance.", stats });
  }

  const statLines = [
    `${stats.totalOccurrences} occurrences across ${stats.weeksInPlan} weeks.`,
    `~${stats.avgHoursPerWeek} hours/week of meeting time on average.`,
    `Busiest single week has ${stats.busiestWeekCount} occurrences.`,
    `${stats.gapWeeks} week(s) with nothing scheduled.`,
    `Category mix: ${categoryMix.map((m) => `${m.name} ${m.pct}%`).join(", ")}.`,
    ...warnings.slice(0, 5).map((w) => `Rule flag: ${w.message}`),
  ];

  const systemPrompt =
    "You write a short, plain-spoken assessment of a team's meeting cadence balance, given precomputed stats. " +
    "2-4 sentences. Name the single biggest risk if there is one, and one concrete suggestion. No headers, no bullet points, no restating every number.";

  let narrative = "Balance check is temporarily unavailable — the numbers above are still accurate.";
  try {
    const result = await runChatToolWithRetry(
      c.env.AI,
      CHAT_MODEL,
      {
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: statLines.join("\n") }],
        // Without this, glm-4.7-flash spends its whole token budget on a
        // hidden chain-of-thought pass (verified live — `content` came back
        // null with the actual answer stuck mid-sentence in `reasoning`)
        // and never gets to the actual answer.
        chat_template_kwargs: { enable_thinking: false },
        max_completion_tokens: 300,
        temperature: 0.3,
      },
      2,
    );
    const text = (result as unknown as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content;
    if (text?.trim()) narrative = text.trim();
  } catch {
    // keep the fallback narrative — the arithmetic above is the part that matters
  }

  await logRun(db, { teamId: session.teamId, planId: plan.id, kind: "balance", input: { planId: plan.id }, output: { narrative, stats } });

  return c.json({ narrative, stats });
});

// ─── Remix ───────────────────────────────────────────────────────────────
// "Adapt a ritual to context... saved as a team-visibility ritual derived
// from the original" (PLAN.md §5.6 #4). Team-visibility rituals already land
// immediately with no approval step (worker/library.ts's create route) —
// remix follows that same rule, just with a generate-then-save split so the
// draft is reviewable/editable first instead of writing straight to the DB.

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "ritual"
  );
}

function buildRemixTool() {
  return {
    type: "function" as const,
    function: {
      name: "propose_remix",
      description: "Propose an adapted version of a ritual for a new context.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string" },
          purpose: { type: "string" },
          durationMin: { type: "integer" },
          sizeMin: { type: "integer" },
          sizeMax: { type: "integer" },
          format: { type: "string", enum: ["sync", "async", "hybrid"] },
          prepNotes: { type: "string" },
        },
        required: ["title", "summary"],
      },
    },
  };
}

interface RemixDraft {
  title: string;
  summary: string | null;
  purpose: string | null;
  durationMin: number | null;
  sizeMin: number | null;
  sizeMax: number | null;
  format: "sync" | "async" | "hybrid" | null;
  prepNotes: string | null;
}

function sanitizeRemixDraft(raw: Partial<RemixDraft> & Record<string, unknown>, fallbackTitle: string): RemixDraft {
  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : fallbackTitle,
    summary: typeof raw.summary === "string" ? raw.summary.trim() : null,
    purpose: typeof raw.purpose === "string" ? raw.purpose.trim() : null,
    durationMin: typeof raw.durationMin === "number" ? Math.round(raw.durationMin) : null,
    sizeMin: typeof raw.sizeMin === "number" ? Math.round(raw.sizeMin) : null,
    sizeMax: typeof raw.sizeMax === "number" ? Math.round(raw.sizeMax) : null,
    format: raw.format === "sync" || raw.format === "async" || raw.format === "hybrid" ? raw.format : null,
    prepNotes: typeof raw.prepNotes === "string" ? raw.prepNotes.trim() : null,
  };
}

ai.post("/rituals/:id/remix", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const id = parseInt(c.req.param("id"), 10);
  if (Number.isNaN(id)) return c.json({ error: "invalid id" }, 400);

  if (!(await checkRateLimit(db, session.teamId))) return c.json({ error: "AI rate limit reached — try again in a bit" }, 429);

  const body = await c.req.json<{ context?: string }>().catch(() => ({}) as Record<string, never>);
  if (!body.context?.trim()) return c.json({ error: "context is required, e.g. '6 people, remote, 30 minutes'" }, 400);

  const [original] = await db
    .select()
    .from(rituals)
    .where(and(eq(rituals.id, id), eq(rituals.status, "published"), or(eq(rituals.visibility, "public"), eq(rituals.ownerTeamId, session.teamId))))
    .limit(1);
  if (!original) return c.json({ error: "not found" }, 404);

  const systemPrompt =
    "You adapt an existing team ritual to a new context. Keep the spirit and purpose of the original; adjust size, " +
    "duration, format, and prep notes for the new context. You MUST call propose_remix exactly once.";

  const userPrompt = [
    `Original ritual: "${original.title}"`,
    original.summary ? `Summary: ${original.summary}` : null,
    original.purpose ? `Purpose: ${original.purpose}` : null,
    `Default duration: ${original.durationMin ?? "unspecified"} min, size: ${original.sizeMin ?? "?"}-${original.sizeMax ?? "?"}, format: ${original.format}`,
    original.prepNotes ? `Prep notes: ${original.prepNotes}` : null,
    "",
    `New context: ${body.context.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");

  let result: ChatToolResult;
  try {
    result = await runChatToolWithRetry(
      c.env.AI,
      CHAT_MODEL,
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [buildRemixTool()],
        tool_choice: { type: "function", function: { name: "propose_remix" } },
        chat_template_kwargs: { enable_thinking: false },
        max_completion_tokens: 800,
        temperature: 0.4,
      },
      2,
    );
  } catch {
    return c.json({ error: "the AI service is temporarily unavailable — try again shortly" }, 502);
  }

  const rawArgs = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!rawArgs) return c.json({ error: "the model did not return a proposal — try again" }, 502);
  const draft = sanitizeRemixDraft(parseToolCallArguments(rawArgs) as Partial<RemixDraft>, `${original.title} (remix)`);

  const run = await logRun(db, { teamId: session.teamId, kind: "remix", input: { ritualId: id, context: body.context }, output: draft });

  return c.json({ runId: run.id, draft, original: { id: original.id, slug: original.slug, title: original.title } });
});

ai.post("/remix/:runId/save", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);
  const runId = parseInt(c.req.param("runId"), 10);
  if (Number.isNaN(runId)) return c.json({ error: "invalid run id" }, 400);

  const [run] = await db.select().from(aiRuns).where(and(eq(aiRuns.id, runId), eq(aiRuns.teamId, session.teamId), eq(aiRuns.kind, "remix"))).limit(1);
  if (!run) return c.json({ error: "not found" }, 404);

  const input = run.input as { ritualId: number };
  const [original] = await db.select().from(rituals).where(eq(rituals.id, input.ritualId)).limit(1);
  if (!original) return c.json({ error: "original ritual no longer exists" }, 404);

  const body = await c.req.json<Partial<RemixDraft>>().catch(() => ({}) as Record<string, never>);
  const draft = sanitizeRemixDraft({ ...(run.output as RemixDraft), ...body }, `${original.title} (remix)`);

  const [row] = await db
    .insert(rituals)
    .values({
      slug: `${slugify(draft.title)}-${crypto.randomUUID().slice(0, 6)}`,
      title: draft.title,
      summary: draft.summary,
      purpose: draft.purpose ?? original.purpose,
      categoryId: original.categoryId,
      visibility: "team",
      status: "published",
      ownerTeamId: session.teamId,
      createdBy: session.userId,
      engagement: original.engagement,
      defaultCadence: original.defaultCadence,
      durationMin: draft.durationMin ?? original.durationMin,
      load: original.load,
      sizeMin: draft.sizeMin ?? original.sizeMin,
      sizeMax: draft.sizeMax ?? original.sizeMax,
      format: draft.format ?? original.format,
      prepNotes: draft.prepNotes ?? original.prepNotes,
      facilitatorRole: original.facilitatorRole,
      sourceName: original.title,
      attribution: `Remixed via AI from "${original.title}"`,
    })
    .returning();

  await db.update(aiRuns).set({ output: draft, accepted: true }).where(eq(aiRuns.id, runId));

  return c.json({ item: row }, 201);
});

// ─── Autofill ────────────────────────────────────────────────────────────
// "Paste a title/URL/notes, get drafted summary, category, job tags, and
// scheduling metadata for the contributor to correct" (PLAN.md §5.6 #5).
// Categories and jobs are a short, fixed taxonomy (~5-20 rows) — no
// Vectorize retrieval needed, just hand the model the whole list and
// validate its pick against it afterward, same discipline as everywhere
// else in this file.

function buildAutofillTool(categorySlugs: string[], jobSlugsAllowed: string[]) {
  return {
    type: "function" as const,
    function: {
      name: "propose_ritual_draft",
      description: "Draft ritual metadata from pasted text.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          summary: { type: "string", description: "one sentence" },
          purpose: { type: "string", description: "why this ritual exists" },
          categorySlug: { type: "string", description: `one of: ${categorySlugs.join(", ")}` },
          jobSlugs: { type: "array", items: { type: "string", description: `one of: ${jobSlugsAllowed.join(", ")}` } },
          engagement: { type: "string", enum: ["session", "recurring", "series", "campaign"] },
          durationMin: { type: "integer" },
          load: { type: "string", enum: ["light", "medium", "heavy"] },
          format: { type: "string", enum: ["sync", "async", "hybrid"] },
        },
        required: ["title", "summary"],
      },
    },
  };
}

interface AutofillDraft {
  title: string;
  summary: string | null;
  purpose: string | null;
  categorySlug: string | null;
  jobSlugs: string[];
  engagement: "session" | "recurring" | "series" | "campaign" | null;
  durationMin: number | null;
  load: "light" | "medium" | "heavy" | null;
  format: "sync" | "async" | "hybrid" | null;
}

const ENGAGEMENTS = ["session", "recurring", "series", "campaign"] as const;
const LOADS = ["light", "medium", "heavy"] as const;
const FORMATS = ["sync", "async", "hybrid"] as const;

function sanitizeAutofillDraft(raw: Record<string, unknown>, validCategorySlugs: Set<string>, validJobSlugs: Set<string>): AutofillDraft {
  const jobSlugsRaw = Array.isArray(raw.jobSlugs) ? (raw.jobSlugs as unknown[]) : [];
  return {
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Untitled ritual",
    summary: typeof raw.summary === "string" ? raw.summary.trim() : null,
    purpose: typeof raw.purpose === "string" ? raw.purpose.trim() : null,
    categorySlug: typeof raw.categorySlug === "string" && validCategorySlugs.has(raw.categorySlug) ? raw.categorySlug : null,
    jobSlugs: jobSlugsRaw.filter((s): s is string => typeof s === "string" && validJobSlugs.has(s)),
    engagement: (ENGAGEMENTS as readonly string[]).includes(raw.engagement as string) ? (raw.engagement as AutofillDraft["engagement"]) : null,
    durationMin: typeof raw.durationMin === "number" ? Math.round(raw.durationMin) : null,
    load: (LOADS as readonly string[]).includes(raw.load as string) ? (raw.load as AutofillDraft["load"]) : null,
    format: (FORMATS as readonly string[]).includes(raw.format as string) ? (raw.format as AutofillDraft["format"]) : null,
  };
}

ai.post("/autofill", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);

  if (!(await checkRateLimit(db, session.teamId))) return c.json({ error: "AI rate limit reached — try again in a bit" }, 429);

  const body = await c.req.json<{ text?: string }>().catch(() => ({}) as Record<string, never>);
  if (!body.text?.trim()) return c.json({ error: "text is required" }, 400);

  const [categoryRows, jobRows] = await Promise.all([db.select().from(categories), db.select().from(jobs)]);
  const categorySlugs = categoryRows.map((cat) => cat.slug);
  const jobSlugsAllowed = jobRows.map((j) => j.slug);

  const systemPrompt =
    "Extract/draft structured ritual metadata from pasted text (which may be a title, a URL, or freeform notes). " +
    "categorySlug and jobSlugs MUST come only from the lists given — never invent one. You MUST call propose_ritual_draft exactly once.";

  const userPrompt = [
    `Categories: ${categoryRows.map((cat) => `${cat.slug} (${cat.name})`).join(", ")}`,
    `Jobs: ${jobRows.map((j) => `${j.slug} (${j.name})`).join(", ")}`,
    "",
    `Pasted text:\n${body.text.trim()}`,
  ].join("\n");

  let result: ChatToolResult;
  try {
    result = await runChatToolWithRetry(
      c.env.AI,
      CHAT_MODEL,
      {
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        tools: [buildAutofillTool(categorySlugs, jobSlugsAllowed)],
        tool_choice: { type: "function", function: { name: "propose_ritual_draft" } },
        chat_template_kwargs: { enable_thinking: false },
        max_completion_tokens: 600,
        temperature: 0.2,
      },
      2,
    );
  } catch {
    return c.json({ error: "the AI service is temporarily unavailable — try again shortly" }, 502);
  }

  const rawArgs = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!rawArgs) return c.json({ error: "the model did not return a draft — try again" }, 502);
  const draft = sanitizeAutofillDraft(parseToolCallArguments(rawArgs) as Record<string, unknown>, new Set(categorySlugs), new Set(jobSlugsAllowed));

  await logRun(db, { teamId: session.teamId, kind: "autofill", input: { text: body.text }, output: draft });

  return c.json({ draft });
});

export { checkRateLimit, logRun };
