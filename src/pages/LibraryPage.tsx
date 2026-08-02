import { useEffect, useMemo, useState } from "react";
import { Search, Sparkles } from "lucide-react";
import { inputClass, cardClass } from "@ops-forward/keel";
import { useCategories, useJobs, useRituals } from "../hooks/useLibrary";
import { useRitualSemanticSearch } from "../hooks/useSearch";
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
  const [smartMode, setSmartMode] = useState(false);
  const [smartQuery, setSmartQuery] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Smart search costs an AI embedding call per query — debounce harder so
  // we don't fire one on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSmartQuery(search), 700);
    return () => clearTimeout(t);
  }, [search]);

  const { data: jobsData } = useJobs();
  const { data: categoriesData } = useCategories();
  const { data: ritualsData, isLoading: keywordLoading } = useRituals({
    q: debouncedSearch || undefined,
    job: jobSlug ?? undefined,
    load: load ?? undefined,
  });
  const { data: smartData, isFetching: smartLoading } = useRitualSemanticSearch(smartQuery, smartMode);

  const items = smartMode ? (smartData?.items.map((r) => r.item) ?? []) : (ritualsData?.items ?? []);
  const total = smartMode ? items.length : (ritualsData?.total ?? 0);
  const isLoading = smartMode ? smartLoading : keywordLoading;
  const showEmptyState = smartMode ? smartQuery.trim().length > 0 && !isLoading && items.length === 0 : !isLoading && items.length === 0;

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

      <div className="flex items-center gap-2 max-w-lg">
        <div className="relative flex-1">
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
            placeholder={smartMode ? "Describe what you want…" : "Search rituals…"}
            className={inputClass({ className: "pl-10 w-full" })}
          />
        </div>
        <button
          onClick={() => setSmartMode(!smartMode)}
          title={smartMode ? "Smart search on — ranks by meaning, not keywords" : "Turn on Smart search (AI-ranked by meaning)"}
          className="flex h-[38px] shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors"
          style={{
            background: smartMode ? "var(--of-bg-brand-tint)" : "var(--of-bg-recessed)",
            color: smartMode ? "var(--of-fg-brand)" : "var(--of-fg-subtle)",
            border: `1px solid ${smartMode ? "color-mix(in srgb, var(--of-magenta-400) 35%, transparent)" : "var(--of-border-line)"}`,
          }}
        >
          <Sparkles size={16} strokeWidth={1.75} />
          <span className="hidden sm:inline">Smart</span>
        </button>
      </div>

      <div className="flex flex-col gap-2" style={{ opacity: smartMode ? 0.5 : 1 }}>
        <div className="flex flex-wrap gap-2">
          <Chip active={jobSlug === null} onClick={() => !smartMode && setJobSlug(null)}>
            All jobs
          </Chip>
          {jobsData?.items.map((job) => (
            <Chip key={job.slug} active={jobSlug === job.slug} onClick={() => !smartMode && setJobSlug(job.slug)}>
              {job.name}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <Chip active={load === null} onClick={() => !smartMode && setLoad(null)}>
            Any load
          </Chip>
          {LOADS.map((l) => (
            <Chip key={l} active={load === l} onClick={() => !smartMode && setLoad(l)}>
              {l}
            </Chip>
          ))}
        </div>
      </div>

      {smartMode && (
        <div
          className="flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm"
          style={{
            background: "var(--of-bg-brand-tint)",
            borderColor: "color-mix(in srgb, var(--of-magenta-400) 30%, transparent)",
            color: "var(--of-fg-brand)",
          }}
        >
          <Sparkles size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>
            <strong>Smart search</strong> ranks results by meaning rather than exact keyword matches — try
            describing what you're after, e.g. "getting quiet feedback from introverts" or "celebrating a
            launch". Job and load filters are off while it's on.
          </span>
        </div>
      )}

      {smartMode && !smartQuery.trim() ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Type something to search by meaning…</p>
      ) : isLoading ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>
      ) : items.length > 0 ? (
        <>
          <p className="text-sm" style={{ color: "var(--of-fg-subtle)" }}>
            {total} ritual{total === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {items.map((ritual) => (
              <RitualCard
                key={ritual.id}
                ritual={ritual}
                category={ritual.categoryId ? categoryById.get(ritual.categoryId) : undefined}
              />
            ))}
          </div>
        </>
      ) : showEmptyState ? (
        <div className={cardClass({ className: "p-8 text-center" })}>
          <p style={{ color: "var(--of-fg-muted)" }}>
            {smartMode ? "Nothing ranked closely enough — try rephrasing." : "No rituals match those filters."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
