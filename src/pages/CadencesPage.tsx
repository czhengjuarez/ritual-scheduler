import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { cardClass, badgeClass, selectClass } from "@ops-forward/keel";
import { useCadenceGallery } from "../hooks/useCadences";
import { useJobs } from "../hooks/useLibrary";
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

  const selectedJobs = useMemo(() => new Set((searchParams.get("job") ?? "").split(",").filter(Boolean)), [searchParams]);
  const workMode = searchParams.get("workMode") ?? "";
  const durationMin = searchParams.get("durationMin") ?? undefined;
  const durationMax = searchParams.get("durationMax") ?? undefined;

  const { data: jobsData } = useJobs();
  const { data, isLoading } = useCadenceGallery({
    job: selectedJobs.size ? [...selectedJobs].join(",") : undefined,
    workMode: workMode || undefined,
    durationMin: durationMin ? Number(durationMin) : undefined,
    durationMax: durationMax ? Number(durationMax) : undefined,
  });

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

      <div className="flex flex-wrap items-center gap-2">
        <Chip active={selectedJobs.size === 0} onClick={clearJobs}>
          All jobs
        </Chip>
        {jobsData?.items.map((job) => (
          <Chip key={job.slug} active={selectedJobs.has(job.slug)} onClick={() => toggleJob(job.slug)}>
            {job.name}
          </Chip>
        ))}
        <select className={selectClass()} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
          <option value="">Any work mode</option>
          {WORK_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>
      ) : data && data.items.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.items.map((cadence) => (
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
      ) : (
        <div className={cardClass({ className: "p-8 text-center" })}>
          <p style={{ color: "var(--of-fg-muted)" }}>No cadences match those filters.</p>
        </div>
      )}

      {selected && <CadencePreviewModal cadence={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
