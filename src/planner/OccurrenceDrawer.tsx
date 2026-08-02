import { useEffect, useState } from "react";
import { X, Star, Trash2, Download, CalendarPlus } from "lucide-react";
import { buttonClass, inputClass, labelClass, textareaClass, badgeClass } from "@ops-forward/keel";
import { useAddReflection, useDeleteOccurrence, useUpdateOccurrence } from "../hooks/usePlanner";
import type { OccurrenceDto } from "../hooks/usePlanner";
import { addDaysISO } from "../lib/calendar";

const STATUS_OPTIONS: OccurrenceDto["status"][] = ["planned", "confirmed", "done", "skipped", "cancelled"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Mirrors worker/ics-format.ts's addMinutesToDateTime — wall-clock addition, no timezone conversion. */
function addMinutes(date: string, time: string, minutes: number): { date: string; time: string } {
  const [hh, mm] = time.split(":").map(Number);
  const total = hh * 60 + mm + minutes;
  const dayOffset = Math.floor(total / 1440);
  const rem = ((total % 1440) + 1440) % 1440;
  return {
    date: dayOffset ? addDaysISO(date, dayOffset) : date,
    time: `${pad(Math.floor(rem / 60))}:${pad(rem % 60)}`,
  };
}

/**
 * Google's "render" template URL needs no auth/API key and works for a
 * single one-off event. Dates without a trailing Z are read as wall-clock
 * time in whatever IANA zone `ctz` names — matching the "no UTC conversion"
 * rule the ICS export follows (see worker/ics-format.ts).
 */
function googleCalendarUrl(occ: OccurrenceDto, timezone: string): string {
  const title = occ.titleOverride || occ.ritual?.title || "Ritual";
  const details = [occ.ritual?.purpose, occ.facilitator && `Facilitator: ${occ.facilitator}`, occ.guestName && `Guest: ${occ.guestName}`, occ.notes]
    .filter((p): p is string => !!p)
    .join("\n");

  const params = new URLSearchParams({ action: "TEMPLATE", text: title });
  if (details) params.set("details", details);

  if (!occ.startTime) {
    // All-day: DTEND-equivalent is exclusive, same as the ICS export.
    const start = occ.date.replace(/-/g, "");
    const end = addDaysISO(occ.endDate ?? occ.date, 1).replace(/-/g, "");
    params.set("dates", `${start}/${end}`);
  } else {
    const start = `${occ.date.replace(/-/g, "")}T${occ.startTime.replace(":", "")}00`;
    const endDt = addMinutes(occ.date, occ.startTime, occ.durationMin ?? 60);
    const end = `${endDt.date.replace(/-/g, "")}T${endDt.time.replace(":", "")}00`;
    params.set("dates", `${start}/${end}`);
    params.set("ctz", timezone);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function OccurrenceDrawer({
  planId,
  occurrence,
  timezone,
  onClose,
}: {
  planId: string;
  occurrence: OccurrenceDto;
  timezone: string;
  onClose: () => void;
}) {
  const [titleOverride, setTitleOverride] = useState(occurrence.titleOverride ?? "");
  const [date, setDate] = useState(occurrence.date);
  const [startTime, setStartTime] = useState(occurrence.startTime ?? "");
  const [durationMin, setDurationMin] = useState(occurrence.durationMin != null ? String(occurrence.durationMin) : "");
  const [facilitator, setFacilitator] = useState(occurrence.facilitator ?? "");
  const [guestName, setGuestName] = useState(occurrence.guestName ?? "");
  const [notes, setNotes] = useState(occurrence.notes ?? "");
  const [rating, setRating] = useState(0);
  const [whatWorked, setWhatWorked] = useState("");
  const [whatDidnt, setWhatDidnt] = useState("");
  // The PATCH round-trips fine, but with no visible change on success (the
  // fields already show what was just typed) a save looked like a no-op —
  // this drives an explicit "Saved" state on the button instead.
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setTitleOverride(occurrence.titleOverride ?? "");
    setDate(occurrence.date);
    setStartTime(occurrence.startTime ?? "");
    setDurationMin(occurrence.durationMin != null ? String(occurrence.durationMin) : "");
    setFacilitator(occurrence.facilitator ?? "");
    setGuestName(occurrence.guestName ?? "");
    setNotes(occurrence.notes ?? "");
    setJustSaved(false);
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

  const save = () =>
    update.mutate(
      {
        id: occurrence.id,
        titleOverride: titleOverride.trim() || null,
        ...(isSpan ? {} : { date, startTime: startTime || null, durationMin: durationMin.trim() ? Number(durationMin) : null }),
        facilitator: facilitator || null,
        guestName: guestName || null,
        notes: notes || null,
      },
      { onSuccess: () => setJustSaved(true) },
    );
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
              disabled={update.isPending}
              className={badgeClass({ variant: s === occurrence.status ? "blue" : "default", className: "hover:opacity-70 transition-opacity" })}
              style={{ cursor: update.isPending ? "wait" : "pointer", borderStyle: s === occurrence.status ? "solid" : "dashed" }}
              title={s === occurrence.status ? undefined : `Mark as ${s}`}
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
            <label className={labelClass()}>Title</label>
            <input
              className={inputClass({ className: "w-full" })}
              value={titleOverride}
              onChange={(e) => { setTitleOverride(e.target.value); setJustSaved(false); }}
              placeholder={occurrence.ritual?.title ?? "Untitled"}
            />
          </div>
          {!isSpan && (
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass()}>Date</label>
                <input
                  type="date"
                  className={inputClass({ className: "w-full" })}
                  value={date}
                  onChange={(e) => { setDate(e.target.value); setJustSaved(false); }}
                />
              </div>
              <div>
                <label className={labelClass()}>Time</label>
                <input
                  type="time"
                  className={inputClass({ className: "w-full" })}
                  value={startTime}
                  onChange={(e) => { setStartTime(e.target.value); setJustSaved(false); }}
                />
              </div>
              <div>
                <label className={labelClass()}>Duration (min)</label>
                <input
                  type="number"
                  min={0}
                  className={inputClass({ className: "w-full" })}
                  value={durationMin}
                  onChange={(e) => { setDurationMin(e.target.value); setJustSaved(false); }}
                />
              </div>
            </div>
          )}
          <div>
            <label className={labelClass()}>Facilitator</label>
            <input
              className={inputClass({ className: "w-full" })}
              value={facilitator}
              onChange={(e) => { setFacilitator(e.target.value); setJustSaved(false); }}
              placeholder="Who's running this one"
            />
          </div>
          <div>
            <label className={labelClass()}>Guest</label>
            <input
              className={inputClass({ className: "w-full" })}
              value={guestName}
              onChange={(e) => { setGuestName(e.target.value); setJustSaved(false); }}
              placeholder="Optional"
            />
          </div>
          <div>
            <label className={labelClass()}>Notes</label>
            <textarea
              className={textareaClass({ className: "w-full" })}
              rows={3}
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setJustSaved(false); }}
            />
          </div>
          <div className="flex items-center gap-2">
            <button className={buttonClass({ variant: "secondary", size: "sm" })} onClick={save} disabled={update.isPending}>
              {update.isPending ? "Saving…" : justSaved ? "Saved ✓" : "Save"}
            </button>
            {update.isError && <span className="text-sm" style={{ color: "var(--of-fg-danger)" }}>Couldn't save — try again.</span>}
          </div>
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

        <div className="flex flex-wrap gap-2">
          <a href={`/api/occurrences/${occurrence.id}/ics`} className={buttonClass({ variant: "secondary", size: "sm" })}>
            <Download size={20} strokeWidth={1.75} className="!w-4 !h-4" /> .ics
          </a>
          <a
            href={googleCalendarUrl(occurrence, timezone)}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass({ variant: "secondary", size: "sm" })}
          >
            <CalendarPlus size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Google Calendar
          </a>
          <button
            className={buttonClass({ variant: "danger", size: "sm" })}
            onClick={() => remove.mutate(occurrence.id, { onSuccess: onClose })}
            disabled={remove.isPending}
          >
            <Trash2 size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Remove
          </button>
        </div>
      </div>
    </div>
  );
}
