import { useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Sparkles } from "lucide-react";
import { buttonClass, cardClass, inputClass, labelClass, selectClass } from "@ops-forward/keel";
import { useCreatePlan } from "../hooks/usePlanner";
import { useJobs } from "../hooks/useLibrary";
import { Chip } from "../components/Chip";
import { SuggestCadenceModal } from "./SuggestCadenceModal";

const WORK_MODES = ["remote", "hybrid", "in-person"] as const;

function defaultEndDate(start: string): string {
  const d = new Date(start + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The default body of `/plan` when there's no active plan (or "Start
 * something new" was clicked) — PLAN.md §5.2. The JTBD chip picker that used
 * to sit here was removed 2026-08-02 for repeating the front door's intent
 * box — but "start from scratch, or answer a few questions and let AI
 * design one" is a distinct fork from "what are you trying to do", so the
 * job/team-size/work-mode inputs came back as the seed for "Design my
 * quarter" specifically, not as a second front door.
 */
/**
 * `onDone` fires both on cancel AND on a successful create — either way,
 * the parent's "show the create flow instead of the calendar" flag needs
 * to clear. On a successful create it also carries the new plan's id, so
 * the parent can switch its plan-switcher over to it (see PlanPage.tsx's
 * `viewPlanId` / `startingNew` state) — without that, creating a second
 * plan while viewing an existing one would leave the switcher pointed at
 * the old one instead of the plan you just made.
 */
export function CreatePlanForm({ onDone, nameInputRef }: { onDone?: (planId?: string) => void; nameInputRef: RefObject<HTMLInputElement | null> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(defaultEndDate(today));
  const createPlan = useCreatePlan();

  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  const [workMode, setWorkMode] = useState("");
  const [teamSize, setTeamSize] = useState("");
  const [showSuggest, setShowSuggest] = useState(false);
  const { data: jobsData } = useJobs();

  const toggleJob = (slug: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-4">
      {onDone && (
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
            Your existing plans stay put — this adds another one you can switch between.
          </p>
          <button onClick={() => onDone?.()} className="text-sm shrink-0 ml-3" style={{ color: "var(--of-fg-brand)" }}>
            Cancel
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        <div className={cardClass({ className: "p-8 h-full" })}>
          <CalendarDays size={20} strokeWidth={1.75} className="mb-3" style={{ color: "var(--of-fg-brand)" }} />
          <h1 className="text-xl font-semibold mb-1">Start a plan</h1>
          <p className="mb-6" style={{ color: "var(--of-fg-muted)" }}>
            A plan can be a week, a quarter, or a year — rituals in it can be any span too.
          </p>

          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass()}>Plan name</label>
              <input ref={nameInputRef} className={inputClass({ className: "w-full" })} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Design Team FY26" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Start date</label>
                <input type="date" className={inputClass({ className: "w-full" })} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className={labelClass()}>End date</label>
                <input type="date" className={inputClass({ className: "w-full" })} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>
            <button
              className={buttonClass({ variant: "primary" })}
              disabled={!name.trim() || createPlan.isPending}
              onClick={() => createPlan.mutate({ name: name.trim(), startDate, endDate }, { onSuccess: (r) => onDone?.(r.item.id) })}
            >
              {createPlan.isPending ? "Creating…" : "Create plan"}
            </button>
          </div>
        </div>

        <div className={cardClass({ className: "p-8 h-full" })}>
          <div className="flex items-center gap-2 mb-1">
            <Sparkles size={20} strokeWidth={1.75} style={{ color: "var(--of-fg-brand)" }} />
            <h2 className="text-xl font-semibold">Or let AI design one for you</h2>
          </div>
          <p className="mb-6" style={{ color: "var(--of-fg-muted)" }}>
            Tell us the job(s), team size, and work mode — AI proposes a cadence from real rituals in the library,
            and you review it before anything's created.
          </p>

          <div className="flex flex-col gap-4">
            <div>
              <label className={labelClass()}>Jobs to be done</label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {jobsData?.items.map((job) => (
                  <Chip key={job.slug} active={selectedJobs.has(job.slug)} onClick={() => toggleJob(job.slug)}>
                    {job.name}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass()}>Team size</label>
                <input
                  type="number"
                  min={1}
                  className={inputClass({ className: "w-full" })}
                  value={teamSize}
                  onChange={(e) => setTeamSize(e.target.value)}
                  placeholder="e.g. 8"
                />
              </div>
              <div>
                <label className={labelClass()}>Work mode</label>
                <select className={selectClass({ className: "w-full" })} value={workMode} onChange={(e) => setWorkMode(e.target.value)}>
                  <option value="">Any</option>
                  {WORK_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button
              className={buttonClass({ variant: "secondary" })}
              disabled={selectedJobs.size === 0}
              title={selectedJobs.size === 0 ? "Pick at least one job above first" : undefined}
              onClick={() => setShowSuggest(true)}
            >
              <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--of-fg-brand)" }} /> Design my quarter
            </button>
          </div>
        </div>
      </div>

      <Link to="/cadences" className="text-sm text-center" style={{ color: "var(--of-fg-muted)" }}>
        or clone a cadence another team already built
      </Link>

      {showSuggest && (
        <SuggestCadenceModal
          initialJobs={[...selectedJobs]}
          teamSize={teamSize || undefined}
          workMode={workMode || undefined}
          onClose={() => setShowSuggest(false)}
          onDone={onDone}
        />
      )}
    </div>
  );
}
