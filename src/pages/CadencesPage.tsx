import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Search, Sparkles } from "lucide-react";
import { cardClass, badgeClass, selectClass, inputClass } from "@ops-forward/keel";
import { useCadenceGallery } from "../hooks/useCadences";
import { useJobs } from "../hooks/useLibrary";
import { useCadenceSemanticSearch } from "../hooks/useSearch";
import { Chip } from "../components/Chip";
import { CadencePreviewModal } from "../planner/CadencePreviewModal";
import type { CadenceTemplateDto } from "../hooks/useCadences";

const WORK_MODES = ["remote", "hybrid", "in-person"] as const;

/**
 * The primary shareable unit is a whole cadence, not a single ritual
 * (PLAN.md §4) — this gallery, not the ritual library, is where "start from
 * something that already works" lives.
 *
 * Filters live in the URL, not just component state: the JTBD picker
 * (PLAN.md §5.2) is a separate screen that lands here with `job`/`teamSize`/
 * `workMode`/`durationMin`/`durationMax` pre-filled — without URL state,
 * that hand-off would need its own separate query logic instead of reusing
 * this page's own filters.
 */
export function CadencesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selected, setSelected] = useState<CadenceTemplateDto | null>(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
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

  const selectedJobs = useMemo(() => new Set((searchParams.get("job") ?? "").split(",").filter(Boolean)), [searchParams]);
  const workMode = searchParams.get("workMode") ?? "";
  const durationMin = searchParams.get("durationMin") ?? undefined;
  const durationMax = searchParams.get("durationMax") ?? undefined;

  const { data: jobsData } = useJobs();
  const { data, isLoading: keywordLoading } = useCadenceGallery({
    job: selectedJobs.size ? [...selectedJobs].join(",") : undefined,
    workMode: workMode || undefined,
    durationMin: durationMin ? Number(durationMin) : undefined,
    durationMax: durationMax ? Number(durationMax) : undefined,
    q: debouncedSearch || undefined,
  });
  const { data: smartData, isFetching: smartLoading } = useCadenceSemanticSearch(smartQuery, smartMode);

  const items = smartMode ? (smartData?.items.map((c) => c.item) ?? []) : (data?.items ?? []);
  const isLoading = smartMode ? smartLoading : keywordLoading;
  const showEmptyState = smartMode ? smartQuery.trim().length > 0 && !isLoading && items.length === 0 : !isLoading && items.length === 0;

  const toggleJob = (slug: string) => {
    const next = new Set(selectedJobs);
    next.has(slug) ? next.delete(slug) : next.add(slug);
    const params = new URLSearchParams(searchParams);
    next.size ? params.set("job", [...next].join(",")) : params.delete("job");
    setSearchParams(params, { replace: true });
  };

  const setWorkMode = (value: string) => {
    const params = new URLSearchParams(searchParams);
    value ? params.set("workMode", value) : params.delete("workMode");
    setSearchParams(params, { replace: true });
  };

  const clearJobs = () => {
    const params = new URLSearchParams(searchParams);
    params.delete("job");
    setSearchParams(params, { replace: true });
  };

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold mb-1">Cadences</h1>
        <p style={{ color: "var(--of-fg-muted)" }}>
          A whole plan another team already built — clone it onto your own start date, then adjust. Starting from
          scratch is still there on the Plan tab, but this is the fast path.
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
            placeholder={smartMode ? "Describe what you want…" : "Search cadences…"}
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

      <div className="flex flex-wrap items-center gap-2" style={{ opacity: smartMode ? 0.5 : 1 }}>
        <Chip active={selectedJobs.size === 0} onClick={() => !smartMode && clearJobs()}>
          All jobs
        </Chip>
        {jobsData?.items.map((job) => (
          <Chip key={job.slug} active={selectedJobs.has(job.slug)} onClick={() => !smartMode && toggleJob(job.slug)}>
            {job.name}
          </Chip>
        ))}
        <select className={selectClass()} value={workMode} onChange={(e) => !smartMode && setWorkMode(e.target.value)} disabled={smartMode}>
          <option value="">Any work mode</option>
          {WORK_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
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
            describing what you're after, e.g. "keeping a distributed team connected" or "onboarding new hires
            fast". Job and work mode filters are off while it's on.
          </span>
        </div>
      )}

      {smartMode && !smartQuery.trim() ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Type something to search by meaning…</p>
      ) : isLoading ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>
      ) : items.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((cadence) => (
            <button key={cadence.id} onClick={() => setSelected(cadence)} className="text-left">
              <div className={cardClass({ className: "p-4 flex flex-col gap-3 h-full" })}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold leading-snug">{cadence.name}</h3>
                  {cadence.featured && (
                    <span className={badgeClass({ variant: "blue" })}>
                      <Sparkles size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" />
                    </span>
                  )}
                </div>
                {cadence.summary && (
                  <p className="text-sm flex-1" style={{ color: "var(--of-fg-muted)" }}>
                    {cadence.summary}
                  </p>
                )}
                <div className="flex flex-wrap gap-1.5 text-xs" style={{ color: "var(--of-fg-subtle)" }}>
                  <span className={badgeClass({ variant: "default" })}>{cadence.durationWeeks} wk</span>
                  {cadence.discipline && <span className={badgeClass({ variant: "default" })}>{cadence.discipline}</span>}
                  {cadence.workMode && <span className={badgeClass({ variant: "default" })}>{cadence.workMode}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : showEmptyState ? (
        <div className={cardClass({ className: "p-8 text-center" })}>
          <p style={{ color: "var(--of-fg-muted)" }}>
            {smartMode ? "Nothing ranked closely enough — try rephrasing." : "No cadences match those filters."}
          </p>
        </div>
      ) : null}

      {selected && <CadencePreviewModal cadence={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
