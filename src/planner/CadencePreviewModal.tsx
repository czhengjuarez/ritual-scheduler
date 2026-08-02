import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Repeat, CalendarRange } from "lucide-react";
import { buttonClass, badgeClass, inputClass, labelClass, cardClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { useCloneCadence } from "../hooks/useCadences";
import { WEEKDAY_LABELS } from "../lib/calendar";
import type { CadenceTemplateDto } from "../hooks/useCadences";

function ritualLabel(slug: string | null, label: string | null | undefined): string {
  return label || slug || "Unassigned";
}

function offsetLabel(dayOffset: number): string {
  // Deliberately not a weekday name: dayOffset is relative to a start date
  // that doesn't exist yet, so "day 1 of week 13" is honest — "Sunday" would
  // claim a real calendar day this template doesn't have until it's cloned.
  const week = Math.floor(dayOffset / 7) + 1;
  const dayInWeek = (dayOffset % 7) + 1;
  return `Week ${week}, day ${dayInWeek}`;
}

/**
 * A structured preview, not a rendered mini calendar grid — the definition
 * is date-free until cloned, and computing concrete dates for preview would
 * mean duplicating worker/schedule.ts's weekday-search logic in the browser,
 * which is exactly the client/server split PLAN.md §4 draws a hard line
 * around. This shows the same information a grid would, just as a list.
 */
export function CadencePreviewModal({ cadence, onClose }: { cadence: CadenceTemplateDto; onClose: () => void }) {
  const [startDate, setStartDate] = useState("");
  const [name, setName] = useState(cadence.name);
  const clone = useCloneCadence();
  const navigate = useNavigate();

  const submit = () => {
    if (!startDate) return;
    clone.mutate({ id: cadence.id, startDate, name: name.trim() || cadence.name }, { onSuccess: () => navigate("/plan") });
  };

  return (
    <Modal title={cadence.name} onClose={onClose} wide>
      <div className="flex flex-col gap-5">
        {cadence.summary && <p style={{ color: "var(--of-fg-muted)" }}>{cadence.summary}</p>}

        <div className="flex flex-wrap gap-2 text-xs">
          <span className={badgeClass({ variant: "default" })}>{cadence.durationWeeks} weeks</span>
          {cadence.discipline && <span className={badgeClass({ variant: "default" })}>{cadence.discipline}</span>}
          {cadence.workMode && <span className={badgeClass({ variant: "default" })}>{cadence.workMode}</span>}
          {(cadence.teamSizeMin || cadence.teamSizeMax) && (
            <span className={badgeClass({ variant: "default" })}>
              {cadence.teamSizeMin ?? "1"}–{cadence.teamSizeMax ?? "any"} people
            </span>
          )}
          <span className={badgeClass({ variant: "default" })}>{cadence.cloneCount} teams have used this</span>
        </div>

        {cadence.definition.slots.map((slot, i) => (
          <div key={i} className={cardClass({ className: "p-3" })}>
            <div className="flex items-center gap-2 text-sm font-medium mb-2">
              <Repeat size={20} strokeWidth={1.75} className="!w-4 !h-4" />
              {slot.name} — {WEEKDAY_LABELS[slot.byweekday]}s, {slot.freq}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm">
              {slot.rotation.map((r, j) => (
                <span key={j} className="flex items-center gap-1.5">
                  <span className={badgeClass({ variant: "default" })}>{ritualLabel(r.ritualSlug, r.label)}</span>
                  {j < slot.rotation.length - 1 && <span style={{ color: "var(--of-fg-subtle)" }}>→</span>}
                </span>
              ))}
            </div>
          </div>
        ))}

        {cadence.definition.standalone.length > 0 && (
          <div className={cardClass({ className: "p-3 flex flex-col gap-1.5" })}>
            <div className="flex items-center gap-2 text-sm font-medium mb-1">
              <CalendarRange size={20} strokeWidth={1.75} className="!w-4 !h-4" />
              Standalone rituals
            </div>
            {cadence.definition.standalone.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span>{ritualLabel(s.ritualSlug, s.titleOverride)}</span>
                <span style={{ color: "var(--of-fg-subtle)" }}>
                  {offsetLabel(s.dayOffset)}
                  {s.spanWeeks ? ` (${s.spanWeeks}-week span)` : ""}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t pt-4 flex flex-col gap-3" style={{ borderColor: "var(--of-border-line)" }}>
          <div>
            <label className={labelClass()}>Plan name</label>
            <input className={inputClass({ className: "w-full" })} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass()}>Start date</label>
            <input type="date" className={inputClass({ className: "w-full" })} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <button className={buttonClass({ variant: "primary" })} disabled={!startDate || clone.isPending} onClick={submit}>
            {clone.isPending ? "Cloning…" : "Clone this cadence"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
