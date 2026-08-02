import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CadenceDefinition } from "../../db/schema";

export interface CadenceTemplateDto {
  id: number;
  slug: string;
  name: string;
  summary: string | null;
  visibility: "public" | "team" | "private";
  status: "draft" | "pending" | "published" | "rejected";
  durationWeeks: number;
  discipline: string | null;
  teamSizeMin: number | null;
  teamSizeMax: number | null;
  workMode: "remote" | "hybrid" | "in-person" | null;
  goals: string[];
  definition: CadenceDefinition;
  sourceName: string | null;
  sourceUrl: string | null;
  cloneCount: number;
  featured: boolean;
  jobs?: { slug: string; name: string }[];
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

export interface CadenceFilters {
  job?: string;
  discipline?: string;
  workMode?: string;
  teamSize?: number;
  q?: string;
}

export function useCadenceGallery(filters: CadenceFilters) {
  const params = new URLSearchParams();
  if (filters.job) params.set("job", filters.job);
  if (filters.discipline) params.set("discipline", filters.discipline);
  if (filters.workMode) params.set("workMode", filters.workMode);
  if (filters.teamSize) params.set("teamSize", String(filters.teamSize));
  if (filters.q) params.set("q", filters.q);

  return useQuery({
    queryKey: ["cadences", filters],
    queryFn: () => getJSON<{ items: CadenceTemplateDto[] }>(`/api/cadences?${params}`),
    placeholderData: (prev) => prev,
  });
}

export function useCadenceDetail(slug: string | null) {
  return useQuery({
    queryKey: ["cadence", slug],
    queryFn: () => getJSON<{ item: CadenceTemplateDto }>(`/api/cadences/${slug}`),
    enabled: !!slug,
  });
}

export function useCloneCadence() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: number; startDate: string; name?: string; timezone?: string }) =>
      sendJSON<{ item: { id: string } }>(`/api/cadences/${id}/clone`, "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plans"] }),
  });
}

export interface PublishPreview {
  definition: CadenceDefinition;
  stripped: { slug: string; title: string }[];
  durationWeeks: number;
}

/** dryRun (default) returns a preview without writing anything; pass dryRun:false to actually publish. */
export function usePublishPlan(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { visibility: "team" | "public"; name?: string; summary?: string; dryRun?: boolean }) =>
      sendJSON<{ preview: PublishPreview } | { item: CadenceTemplateDto; stripped: { slug: string; title: string }[] }>(
        `/api/plans/${planId}/publish`,
        "POST",
        body,
      ),
    onSuccess: (result) => {
      if ("item" in result) qc.invalidateQueries({ queryKey: ["cadences"] });
    },
  });
}
