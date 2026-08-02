import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Sparkles } from "lucide-react";
import { buttonClass, cardClass, inputClass, selectClass, labelClass } from "@ops-forward/keel";
import { useJobs } from "../hooks/useLibrary";
import { Chip } from "../components/Chip";
import { SuggestCadenceModal } from "./SuggestCadenceModal";

type Horizon = "week" | "quarter" | "year" | "any";

/** Maps a rough time horizon to a duration_weeks range — the gallery's own duration filter, not a new concept. */
const HORIZON_RANGES: Record<Horizon, { min?: number; max?: number }> = {
  week: { min: 1, max: 2 },
  quarter: { min: 8, max: 16 },
  year: { min: 40, max: 53 },
  any: {},
};

/**
 * "What are you trying to do?" as the front door (PLAN.md §5.2, Phase 5).
 * Answers feed straight into the cadence gallery's own filters via URL
 * params — this isn't a separate ranking engine, it's a faster way to reach
 * the same filtered list the gallery's chips already produce.
 */
export function JobPicker({ onDone }: { onDone?: () => void }) {
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [teamSize, setTeamSize] = useState("");
  const [workMode, setWorkMode] = useState("");
  const [horizon, setHorizon] = useState<Horizon>("any");
  const [showSuggest, setShowSuggest] = useState(false);
  const { data: jobsData } = useJobs();
  const navigate = useNavigate();

  const toggleJob = (slug: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };

  const seeMatches = () => {
    const params = new URLSearchParams();
    if (selectedJobs.size) params.set("job", [...selectedJobs].join(","));
    if (teamSize) params.set("teamSize", teamSize);
    if (workMode) params.set("workMode", workMode);
    const range = HORIZON_RANGES[horizon];
    if (range.min) params.set("durationMin", String(range.min));
    if (range.max) params.set("durationMax", String(range.max));
    navigate(`/cadences?${params}`);
  };

  return (
    <div className={cardClass({ className: "p-6 flex flex-col gap-4" })}>
      <div>
        <h2 className="font-semibold mb-0.5">What are you trying to do?</h2>
        <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
          Pick what matters right now — this filters the cadence gallery, not a separate list.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {jobsData?.items.map((job) => (
          <Chip key={job.slug} active={selectedJobs.has(job.slug)} onClick={() => toggleJob(job.slug)}>
            {job.name}
          </Chip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass()}>Team size</label>
          <input type="number" min={1} className={inputClass({ className: "w-full" })} value={teamSize} onChange={(e) => setTeamSize(e.target.value)} placeholder="Any" />
        </div>
        <div>
          <label className={labelClass()}>Work mode</label>
          <select className={selectClass({ className: "w-full" })} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
            <option value="">Any</option>
            <option value="remote">Remote</option>
            <option value="hybrid">Hybrid</option>
            <option value="in-person">In-person</option>
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass()}>Horizon</label>
        <div className="flex gap-2 mt-1">
          {(["week", "quarter", "year", "any"] as Horizon[]).map((h) => (
            <button key={h} onClick={() => setHorizon(h)} className={buttonClass({ variant: horizon === h ? "primary" : "secondary", size: "sm" })}>
              {h === "any" ? "Any length" : `A ${h}`}
            </button>
          ))}
        </div>
      </div>

      <button className={buttonClass({ variant: "primary" })} onClick={seeMatches}>
        See matching cadences <ArrowRight size={20} strokeWidth={1.75} className="!w-4 !h-4" />
      </button>

      <button className={buttonClass({ variant: "secondary" })} disabled={selectedJobs.size === 0} onClick={() => setShowSuggest(true)} title={selectedJobs.size === 0 ? "Pick at least one job first" : undefined}>
        <Sparkles size={20} strokeWidth={1.75} className="!w-4 !h-4" style={{ color: "var(--of-fg-brand)" }} /> Or let AI design one for you
      </button>

      {showSuggest && (
        <SuggestCadenceModal
          initialJobs={[...selectedJobs]}
          teamSize={teamSize || undefined}
          workMode={workMode || undefined}
          horizonWeeks={HORIZON_RANGES[horizon].min ?? 12}
          onClose={() => setShowSuggest(false)}
          onDone={onDone}
        />
      )}
    </div>
  );
}
