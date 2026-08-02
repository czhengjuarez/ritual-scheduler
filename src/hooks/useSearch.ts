import { useQuery } from "@tanstack/react-query";
import type { RitualDto } from "./useLibrary";
import type { CadenceTemplateDto } from "./useCadences";

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

interface SemanticSearchResponse<T> {
  items: { type: "ritual" | "cadence"; score: number; item: T }[];
}

/**
 * Ranks by meaning via /api/search (Vectorize), not by the keyword LIKE
 * match the plain gallery endpoints use. Costs an embedding call per query,
 * so callers should debounce harder than they would for keyword search.
 */
export function useRitualSemanticSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["search", "ritual", query],
    queryFn: () => getJSON<SemanticSearchResponse<RitualDto>>(`/api/search?${new URLSearchParams({ q: query, type: "ritual" })}`),
    enabled: enabled && query.trim().length > 0,
    placeholderData: (prev) => prev,
  });
}

export function useCadenceSemanticSearch(query: string, enabled: boolean) {
  return useQuery({
    queryKey: ["search", "cadence", query],
    queryFn: () => getJSON<SemanticSearchResponse<CadenceTemplateDto>>(`/api/search?${new URLSearchParams({ q: query, type: "cadence" })}`),
    enabled: enabled && query.trim().length > 0,
    placeholderData: (prev) => prev,
  });
}
