import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface JobDto {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  icon: string | null;
  sortOrder: number;
  typicalSpan: "ongoing" | "bounded" | "one-off";
}

export interface CategoryDto {
  id: number;
  name: string;
  slug: string;
  color: string | null;
  icon: string | null;
  description: string | null;
  sortOrder: number;
}

export interface RitualDto {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  purpose: string | null;
  categoryId: number | null;
  visibility: "public" | "team" | "private";
  status: "draft" | "pending" | "published" | "rejected";
  ownerTeamId: string | null;
  engagement: "session" | "recurring" | "series" | "campaign";
  spanWeeks: number | null;
  defaultCadence: string;
  durationMin: number | null;
  prepLeadDays: number | null;
  load: "light" | "medium" | "heavy";
  participants: string | null;
  format: "sync" | "async" | "hybrid";
  tags: string[];
  sourceName: string | null;
  sourceUrl: string | null;
  sourceVerified: boolean;
}

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
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
  return res.json();
}

export function useJobs() {
  return useQuery({
    queryKey: ["jobs"],
    queryFn: () => getJSON<{ items: JobDto[] }>("/api/jobs"),
    staleTime: Infinity,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => getJSON<{ items: CategoryDto[] }>("/api/categories"),
    staleTime: Infinity,
  });
}

export interface RitualFilters {
  q?: string;
  job?: string;
  load?: string;
  engagement?: string;
}

export function useRituals(filters: RitualFilters) {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.job) params.set("job", filters.job);
  if (filters.load) params.set("load", filters.load);
  if (filters.engagement) params.set("engagement", filters.engagement);
  params.set("limit", "100");

  return useQuery({
    queryKey: ["rituals", filters],
    queryFn: () => getJSON<{ items: RitualDto[]; total: number }>(`/api/rituals?${params}`),
    placeholderData: (prev) => prev,
  });
}

/**
 * Lands as a team-visibility ritual immediately, no approval needed
 * (PLAN.md §5.4). `renderedAt` feeds the spam-timing check on the server —
 * callers must capture it when the form mounts, not at submit time.
 */
export function useCreateRitual() {
  const qc = useQueryClient();
  return useMutation({
    // The spam-timing/honeypot path (worker/library.ts) returns {ok:true}
    // with no ritual attached, on purpose — the type reflects that rather
    // than promising a ritual the caller can't actually rely on getting.
    mutationFn: (body: {
      title: string;
      summary?: string;
      purpose?: string;
      categoryId?: number;
      engagement?: string;
      durationMin?: number;
      load?: string;
      jobSlugs?: string[];
      renderedAt: number;
      honeypot?: string;
    }) => sendJSON<{ item: RitualDto } | { ok: true }>("/api/rituals", "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rituals"] }),
  });
}

/** Moves a team-owned ritual into the public admin queue. */
export function useRequestPublicRitual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => sendJSON<{ item: RitualDto }>(`/api/rituals/${id}/request-public`, "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rituals"] }),
  });
}

/** Team-owned only — the backend refuses to delete a public library ritual. */
export function useDeleteRitual() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => sendJSON<{ success: true }>(`/api/rituals/${id}`, "DELETE"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["rituals"] }),
  });
}
