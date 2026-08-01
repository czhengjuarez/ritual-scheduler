import { useQuery } from "@tanstack/react-query";

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
}

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
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
