import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { buttonClass, cardClass, inputClass, labelClass } from "@ops-forward/keel";
import { useCreatePlan } from "../hooks/usePlanner";
import { JobPicker } from "./JobPicker";

function defaultEndDate(start: string): string {
  const d = new Date(start + "T00:00:00");
  d.setFullYear(d.getFullYear() + 1);
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * "What are you trying to do?" is the front door (PLAN.md §5.2, Phase 5) —
 * not a static link to the gallery anymore. Building from scratch stays
 * available as the secondary path, and a plain "browse everything" escape
 * hatch stays one click away for anyone who'd rather skip the questions.
 */
export function CreatePlanForm() {
  const today = new Date().toISOString().slice(0, 10);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(defaultEndDate(today));
  const createPlan = useCreatePlan();

  return (
    <div className="max-w-lg mx-auto flex flex-col gap-4">
      <JobPicker />

      <Link to="/cadences" className="text-sm text-center" style={{ color: "var(--of-fg-muted)" }}>
        or just browse every cadence
      </Link>

      <div className="flex items-center gap-3 my-1">
        <div className="flex-1 h-px" style={{ background: "var(--of-border-line)" }} />
        <span className="text-xs" style={{ color: "var(--of-fg-subtle)" }}>
          or start from scratch
        </span>
        <div className="flex-1 h-px" style={{ background: "var(--of-border-line)" }} />
      </div>

      <div className={cardClass({ className: "p-8" })}>
        <CalendarDays size={20} strokeWidth={1.75} className="mb-3" style={{ color: "var(--of-fg-brand)" }} />
        <h1 className="text-xl font-semibold mb-1">Start your plan</h1>
        <p className="mb-6" style={{ color: "var(--of-fg-muted)" }}>
          A plan can be a week, a quarter, or a year — rituals in it can be any span too (PLAN.md §1.2).
        </p>

        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass()}>Plan name</label>
            <input className={inputClass({ className: "w-full" })} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Design Team FY26" />
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
            onClick={() => createPlan.mutate({ name: name.trim(), startDate, endDate })}
          >
            {createPlan.isPending ? "Creating…" : "Create plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
