import { useEffect, useState } from "react";
import { X, Star, Trash2, Download } from "lucide-react";
import { buttonClass, inputClass, labelClass, textareaClass, badgeClass } from "@ops-forward/keel";
import { useAddReflection, useDeleteOccurrence, useUpdateOccurrence } from "../hooks/usePlanner";
import type { OccurrenceDto } from "../hooks/usePlanner";

const STATUS_OPTIONS: OccurrenceDto["status"][] = ["planned", "confirmed", "done", "skipped", "cancelled"];

export function OccurrenceDrawer({ planId, occurrence, onClose }: { planId: string; occurrence: OccurrenceDto; onClose: () => void }) {
  const [facilitator, setFacilitator] = useState(occurrence.facilitator ?? "");
  const [guestName, setGuestName] = useState(occurrence.guestName ?? "");
  const [notes, setNotes] = useState(occurrence.notes ?? "");
  const [rating, setRating] = useState(0);
  const [whatWorked, setWhatWorked] = useState("");
  const [whatDidnt, setWhatDidnt] = useState("");

  useEffect(() => {
    setFacilitator(occurrence.facilitator ?? "");
    setGuestName(occurrence.guestName ?? "");
    setNotes(occurrence.notes ?? "");
  }, [occurrence.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const update = useUpdateOccurrence(planId);
  const remove = useDeleteOccurrence(planId);
  const addReflection = useAddReflection(planId);

  const title = occurrence.titleOverride || occurrence.ritual?.title || "Untitled";
  const isSpan = !!occurrence.endDate && occurrence.endDate !== occurrence.date;

  const save = () => update.mutate({ id: occurrence.id, facilitator: facilitator || null, guestName: guestName || null, notes: notes || null });
  const setStatus = (status: OccurrenceDto["status"]) => update.mutate({ id: occurrence.id, status });
  const saveReflection = () => {
    if (!rating && !whatWorked && !whatDidnt) return;
    addReflection.mutate({ occurrenceId: occurrence.id, rating: rating || undefined, whatWorked: whatWorked || undefined, whatDidnt: whatDidnt || undefined });
    setRating(0);
    setWhatWorked("");
    setWhatDidnt("");
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.3)" }} onClick={onClose}>
      <div
        className="w-full max-w-md h-full overflow-y-auto p-6 flex flex-col gap-5"
        style={{ background: "var(--of-bg-elevated)", borderLeft: "1px solid var(--of-border-line)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
              {occurrence.date}
              {isSpan && ` → ${occurrence.endDate}`}
              {occurrence.startTime && ` · ${occurrence.startTime}`}
            </p>
          </div>
          <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={onClose}>
            <X size={20} strokeWidth={1.75} className="!w-4 !h-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={badgeClass({ variant: s === occurrence.status ? "blue" : "default" })}
              style={{ cursor: "pointer" }}
            >
              {s}
            </button>
          ))}
        </div>

        {occurrence.ritual?.purpose && (
          <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
            {occurrence.ritual.purpose}
          </p>
        )}

        <div className="flex flex-col gap-3">
          <div>
            <label className={labelClass()}>Facilitator</label>
            <input className={inputClass({ className: "w-full" })} value={facilitator} onChange={(e) => setFacilitator(e.target.value)} placeholder="Who's running this one" />
          </div>
          <div>
            <label className={labelClass()}>Guest</label>
            <input className={inputClass({ className: "w-full" })} value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className={labelClass()}>Notes</label>
            <textarea className={textareaClass({ className: "w-full" })} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <button className={buttonClass({ variant: "secondary", size: "sm" })} onClick={save} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </button>
        </div>

        <div className="border-t pt-4 flex flex-col gap-3" style={{ borderColor: "var(--of-border-line)" }}>
          <label className={labelClass()}>Log a reflection</label>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)} aria-label={`${n} star${n === 1 ? "" : "s"}`}>
                <Star size={20} strokeWidth={1.75} fill={n <= rating ? "var(--of-fg-brand)" : "none"} style={{ color: "var(--of-fg-brand)" }} />
              </button>
            ))}
          </div>
          <textarea className={textareaClass({ className: "w-full" })} rows={2} placeholder="What worked?" value={whatWorked} onChange={(e) => setWhatWorked(e.target.value)} />
          <textarea className={textareaClass({ className: "w-full" })} rows={2} placeholder="What didn't?" value={whatDidnt} onChange={(e) => setWhatDidnt(e.target.value)} />
          <button className={buttonClass({ variant: "secondary", size: "sm" })} onClick={saveReflection} disabled={addReflection.isPending}>
            {addReflection.isPending ? "Saving…" : "Save reflection"}
          </button>
        </div>

        <div className="flex gap-2">
          <a href={`/api/occurrences/${occurrence.id}/ics`} className={buttonClass({ variant: "secondary", size: "sm" })}>
            <Download size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Add to my calendar
          </a>
          {occurrence.origin === "manual" && (
            <button
              className={buttonClass({ variant: "danger", size: "sm" })}
              onClick={() => remove.mutate(occurrence.id, { onSuccess: onClose })}
              disabled={remove.isPending}
            >
              <Trash2 size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Remove from plan
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
