import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CadenceDefinition } from "../../db/schema";

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

async function sendJSON<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error((detail as { error?: string } | null)?.error || `${method} ${url} failed: ${res.status}`);
  }
  return res.json();
}

export interface SuggestCadenceInput {
  jobSlugs: string[];
  teamSizeMin?: number;
  teamSizeMax?: number;
  workMode?: "remote" | "hybrid" | "in-person";
  seniority?: string;
  currentLoad?: string;
  horizonWeeks?: number;
  auditScore?: number;
}

export interface SuggestCadenceResult {
  runId: number;
  definition: CadenceDefinition;
  durationWeeks: number;
  candidates: { slug: string; title: string }[];
}

/** ~10-60s: the model call is retried on transient failures server-side, so a single request may sit for a while before resolving. */
export function useSuggestCadence() {
  return useMutation({
    mutationFn: (input: SuggestCadenceInput) => sendJSON<SuggestCadenceResult>("/api/suggest-cadence", "POST", input),
  });
}

export interface BalanceAnalysis {
  narrative: string;
  stats: {
    totalOccurrences: number;
    weeksInPlan: number;
    avgHoursPerWeek: number;
    busiestWeekCount: number;
    gapWeeks: number;
    categoryMix: { name: string; count: number; pct: number }[];
  };
}

/** Disabled until triggered — the AI call is on-demand, not fetched every time the plan page loads (PLAN.md §5.6 #3: rate-limited, human-initiated). */
export function useBalanceAnalysis(planId: string, enabled: boolean) {
  return useQuery({
    queryKey: ["balance", planId],
    queryFn: () => getJSON<BalanceAnalysis>(`/api/plans/${planId}/balance`),
    enabled,
    staleTime: Infinity,
  });
}

export function useAcceptSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, ...body }: { runId: number; definition: CadenceDefinition; startDate: string; durationWeeks: number; name?: string; timezone?: string }) =>
      sendJSON<{ item: { id: string } }>(`/api/suggest-cadence/${runId}/accept`, "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plans"] }),
  });
}

export interface RemixDraft {
  title: string;
  summary: string | null;
  purpose: string | null;
  durationMin: number | null;
  sizeMin: number | null;
  sizeMax: number | null;
  format: "sync" | "async" | "hybrid" | null;
  prepNotes: string | null;
}

export interface RemixResult {
  runId: number;
  draft: RemixDraft;
  original: { id: number; slug: string; title: string };
}

/** ~5-15s; not instant, so callers should show a loading state rather than expecting a snappy response. */
export function useRemixRitual() {
  return useMutation({
    mutationFn: ({ ritualId, context }: { ritualId: number; context: string }) => sendJSON<RemixResult>(`/api/rituals/${ritualId}/remix`, "POST", { context }),
  });
}

export function useSaveRemix() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, ...draft }: { runId: number } & Partial<RemixDraft>) => sendJSON<{ item: { id: number } }>(`/api/remix/${runId}/save`, "POST", draft),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rituals"] }),
  });
}

export interface AutofillDraft {
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

export function useAutofill() {
  return useMutation({
    mutationFn: (text: string) => sendJSON<{ draft: AutofillDraft }>("/api/autofill", "POST", { text }),
  });
}

export interface ConverseMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ConverseResult {
  action: "ask" | "propose" | "route";
  message: string;
  jobSlugs: string[];
  teamSize: number | null;
  workMode: "remote" | "hybrid" | "in-person" | null;
  horizonWeeks: number | null;
  destination: "plan" | "ritual" | "calendar" | "audit" | null;
  wantsMultiple?: boolean;
  rotationThemes?: string[];
  excludeThemes?: string[];
  suggestion?: SuggestCadenceResult;
}

/**
 * The front door's conversational cadence builder (PLAN.md §5.2) — each call
 * sends the whole transcript so far and gets back either a follow-up
 * question, a route (they wanted something else entirely), or a ready
 * SuggestCadenceResult to review once enough has been gathered.
 *
 * `currentProposal` carries the last proposal's actual structure (not just
 * chat text) once one exists — the caller (IntentBox) persists it across
 * turns so a plain "remove X"/"confirm" reply can be applied as a patch to
 * the real prior structure server-side, instead of the model trying to
 * regenerate everything from the transcript alone.
 */
export function useConverseIntent() {
  return useMutation({
    mutationFn: ({ messages, currentProposal }: { messages: ConverseMessage[]; currentProposal?: SuggestCadenceResult }) =>
      sendJSON<ConverseResult>("/api/intent/converse", "POST", { messages, currentProposal }),
  });
}
