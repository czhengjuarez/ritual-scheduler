import { Hono } from "hono";
import { and, eq, gte, inArray, or } from "drizzle-orm";
import { getDb, type Db } from "./db";
import { aiRuns, cadenceTemplates, categories, jobs, occurrences, rituals, type CadenceDefinition, type CadenceSlotDef, type CadenceStandaloneDef } from "../db/schema";
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
                    properties: { ritualSlug: { type: "string", description: "must be one of the candidate slugs given in the prompt" } },
                    required: ["ritualSlug"],
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
        .map((r, i) => ({ position: i, ritualSlug: r.ritualSlug && validSlugs.has(r.ritualSlug) ? r.ritualSlug : null, label: r.label ?? null }))
        .filter((r) => r.ritualSlug !== null),
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

ai.post("/suggest-cadence", async (c) => {
  const session = c.get("session");
  const db = getDb(c.env.DB);

  if (!(await checkRateLimit(db, session.teamId))) return c.json({ error: "AI rate limit reached — try again in a bit" }, 429);

  const body = await c.req.json<SuggestCadenceBody>().catch(() => ({}) as SuggestCadenceBody);
  const jobSlugs = (body.jobSlugs ?? []).filter(Boolean);
  if (jobSlugs.length === 0) return c.json({ error: "at least one job is required" }, 400);
  const horizonWeeks = Math.min(52, Math.max(1, Math.round(body.horizonWeeks ?? 12)));

  const jobRows = await db.select().from(jobs).where(inArray(jobs.slug, jobSlugs));
  if (jobRows.length === 0) return c.json({ error: "unknown jobs" }, 400);

  const retrievalQuery = jobRows.map((j) => [j.name, j.description].filter(Boolean).join(" — ")).join(". ");
  const matches = await semanticSearch(c.env, retrievalQuery, { type: "ritual", topK: 24 });
  if (matches.length === 0) return c.json({ error: "not enough indexed content yet — run the embedding backfill first" }, 422);

  const candidateRows = await db
    .select()
    .from(rituals)
    .where(inArray(rituals.id, matches.map((m) => m.refId)));
  if (candidateRows.length === 0) return c.json({ error: "not enough indexed content yet" }, 422);

  const candidateSlugs = candidateRows.map((r) => r.slug);
  const candidateLines = candidateRows
    .map((r) => `- ${r.slug}: "${r.title}" (${r.engagement}, ${r.load} load${r.durationMin ? `, ${r.durationMin}min` : ""})${r.summary ? ` — ${r.summary}` : ""}`)
    .join("\n");

  const contextLines = [
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
    "byweekday is 0=Sunday..6=Saturday. Spread slots across different weekdays rather than stacking them on one day.";

  const userPrompt = `${contextLines.join("\n")}\n\nCandidate rituals (use only these slugs):\n${candidateLines}\n\nPropose a cadence for this team.`;

  const tool = buildCadenceTool();
  let result: ChatToolResult;
  try {
    result = await runChatToolWithRetry(c.env.AI, CHAT_MODEL, {
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
    return c.json({ error: "the AI service is temporarily unavailable — try again shortly" }, 502);
  }

  const rawArgs = result.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!rawArgs) return c.json({ error: "the model did not return a proposal — try again" }, 502);
  const parsed = parseToolCallArguments(rawArgs);

  const validSlugs = new Set(candidateSlugs);
  const definition = sanitizeDefinition(parsed as { slots?: RawSlot[]; standalone?: RawStandalone[] }, validSlugs);
  if (definition.slots.length === 0 && definition.standalone.length === 0) {
    return c.json({ error: "the model's proposal didn't use any valid rituals — try again" }, 502);
  }

  const run = await logRun(db, { teamId: session.teamId, kind: "suggest", input: body, output: definition });

  return c.json({
    runId: run.id,
    definition,
    durationWeeks: horizonWeeks,
    candidates: candidateRows.map((r) => ({ slug: r.slug, title: r.title })),
  });
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
