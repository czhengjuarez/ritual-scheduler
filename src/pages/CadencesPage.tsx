import { useState } from "react";
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
 */
export function CadencesPage() {
  const [jobSlug, setJobSlug] = useState<string | null>(null);
  const [workMode, setWorkMode] = useState<string>("");
  const [selected, setSelected] = useState<CadenceTemplateDto | null>(null);

  const { data: jobsData } = useJobs();
  const { data, isLoading } = useCadenceGallery({ job: jobSlug ?? undefined, workMode: workMode || undefined });

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
        <Chip active={jobSlug === null} onClick={() => setJobSlug(null)}>
          All jobs
        </Chip>
        {jobsData?.items.map((job) => (
          <Chip key={job.slug} active={jobSlug === job.slug} onClick={() => setJobSlug(job.slug)}>
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
