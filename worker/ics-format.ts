/**
 * Pure RFC 5545 (iCalendar) formatting — no DB, no Hono, no Workers globals.
 * Kept separate from ics.ts (routing + D1 reads) the same way schedule.ts is
 * kept separate from planner.ts: this half is unit-testable directly under
 * plain Node (worker/ics.test.mjs), the other half only runs in a Worker.
 */
import { addDaysISO } from "./schedule";

export interface IcsOccurrence {
  id: string;
  date: string;
  endDate: string | null;
  startTime: string | null;
  durationMin: number | null;
  titleOverride: string | null;
  status: string;
  facilitator: string | null;
  guestName: string | null;
  notes: string | null;
  ritualTitle: string | null;
  ritualPurpose: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

/** RFC 5545 requires folding lines over 75 octets; most clients tolerate long lines anyway, but this keeps the feed spec-correct. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const parts = [line.slice(0, 75)];
  let rest = line.slice(75);
  while (rest.length > 0) {
    parts.push(" " + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join("\r\n");
}

function nowUtcStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function formatDateOnly(date: string): string {
  return date.replace(/-/g, "");
}

function formatDateTime(date: string, time: string): string {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

/** Wall-clock addition (no timezone conversion — the result is tagged with TZID as metadata, per PLAN.md §4's "no UTC conversion until ICS export"). */
function addMinutesToDateTime(date: string, time: string, minutes: number): { date: string; time: string } {
  const [hh, mm] = time.split(":").map(Number);
  const total = hh * 60 + mm + minutes;
  const dayOffset = Math.floor(total / 1440);
  const rem = ((total % 1440) + 1440) % 1440;
  return {
    date: dayOffset ? addDaysISO(date, dayOffset) : date,
    time: `${pad(Math.floor(rem / 60))}:${pad(rem % 60)}`,
  };
}

function buildEvent(occ: IcsOccurrence, timezone: string): string[] {
  const lines: string[] = [];
  lines.push("BEGIN:VEVENT");
  lines.push(`UID:${occ.id}@ritual-builder`);
  lines.push(`DTSTAMP:${nowUtcStamp()}`);

  if (!occ.startTime) {
    // All-day (week-granularity planning is first-class — PLAN.md §4).
    // DTEND for an all-day event is exclusive: the day AFTER the last day.
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(occ.date)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateOnly(addDaysISO(occ.endDate ?? occ.date, 1))}`);
  } else {
    lines.push(`DTSTART;TZID=${timezone}:${formatDateTime(occ.date, occ.startTime)}`);
    const end = addMinutesToDateTime(occ.date, occ.startTime, occ.durationMin ?? 60);
    lines.push(`DTEND;TZID=${timezone}:${formatDateTime(end.date, end.time)}`);
  }

  lines.push(`SUMMARY:${escapeText(occ.titleOverride || occ.ritualTitle || "Ritual")}`);

  const descriptionParts = [
    occ.ritualPurpose,
    occ.facilitator && `Facilitator: ${occ.facilitator}`,
    occ.guestName && `Guest: ${occ.guestName}`,
    occ.notes,
  ].filter((p): p is string => !!p);
  if (descriptionParts.length) lines.push(`DESCRIPTION:${escapeText(descriptionParts.join("\\n"))}`);

  // A skipped instance still shows on the calendar (as cancelled) so its
  // absence reads as "this didn't happen" rather than "the feed is broken".
  lines.push(`STATUS:${occ.status === "skipped" ? "CANCELLED" : "CONFIRMED"}`);
  lines.push("END:VEVENT");
  return lines;
}

export function buildCalendar(calendarName: string, timezone: string, occs: IcsOccurrence[]): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ritual Builder//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
  ];
  // Genuinely cancelled instances are omitted; skipped ones are kept (see buildEvent).
  for (const occ of occs.filter((o) => o.status !== "cancelled")) {
    lines.push(...buildEvent(occ, timezone));
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
