import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { inputClass, cardClass } from "@ops-forward/keel";
import { useCategories, useJobs, useRituals } from "../hooks/useLibrary";
import { Chip } from "../components/Chip";
import { RitualCard } from "../components/RitualCard";

const LOADS = ["light", "medium", "heavy"] as const;

/**
 * "Minimal browse + the picker" (PLAN.md §8, Phase 1) — filter by job and
 * load (how someone actually chooses a ritual for a slot), plus search.
 * No drag-and-drop yet; that's the cycle editor in Phase 2. This becomes
 * that editor's picker component once the planner exists.
 */
export function LibraryPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [jobSlug, setJobSlug] = useState<string | null>(null);
  const [load, setLoad] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: jobsData } = useJobs();
  const { data: categoriesData } = useCategories();
  const { data: ritualsData, isLoading } = useRituals({
    q: debouncedSearch || undefined,
    job: jobSlug ?? undefined,
    load: load ?? undefined,
  });

  const categoryById = useMemo(
    () => new Map((categoriesData?.items ?? []).map((c) => [c.id, c])),
    [categoriesData],
  );

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Ritual library</h1>
        <p style={{ color: "var(--of-fg-muted)" }}>
          The ingredients, not the product — search or filter by job, then drag one into your
          cadence once the planner lands in Phase 2.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search
          size={20}
          strokeWidth={1.75}
          className="absolute left-3 top-1/2 -translate-y-1/2"
          style={{ color: "var(--of-fg-subtle)" }}
        />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search rituals…"
          className={inputClass({ className: "pl-10 w-full" })}
        />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Chip active={jobSlug === null} onClick={() => setJobSlug(null)}>
            All jobs
          </Chip>
          {jobsData?.items.map((job) => (
            <Chip key={job.slug} active={jobSlug === job.slug} onClick={() => setJobSlug(job.slug)}>
              {job.name}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active={load === null} onClick={() => setLoad(null)}>
            Any load
          </Chip>
          {LOADS.map((l) => (
            <Chip key={l} active={load === l} onClick={() => setLoad(l)}>
              {l}
            </Chip>
          ))}
        </div>
      </div>

      {isLoading ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>
      ) : ritualsData && ritualsData.items.length > 0 ? (
        <>
          <p className="text-sm" style={{ color: "var(--of-fg-subtle)" }}>
            {ritualsData.total} ritual{ritualsData.total === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ritualsData.items.map((ritual) => (
              <RitualCard
                key={ritual.id}
                ritual={ritual}
                category={ritual.categoryId ? categoryById.get(ritual.categoryId) : undefined}
              />
            ))}
          </div>
        </>
      ) : (
        <div className={cardClass({ className: "p-8 text-center" })}>
          <p style={{ color: "var(--of-fg-muted)" }}>No rituals match those filters.</p>
        </div>
      )}
    </div>
  );
}
