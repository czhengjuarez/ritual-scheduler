// Verifies RFC 5545 formatting: all-day exclusive DTEND, timed events with
// duration (including a midnight rollover), text escaping, line folding,
// and skipped/cancelled handling.
import { buildCalendar } from "./ics-format.ts";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};

const base = { id: "occ-1", date: "2026-03-05", endDate: null, startTime: null, durationMin: null, titleOverride: null, status: "planned", facilitator: null, guestName: null, notes: null, ritualTitle: "Design Crit", ritualPurpose: "Catch problems early." };

console.log("\nAll-day event");
{
  const ics = buildCalendar("Test Plan", "America/New_York", [base]);
  check("has VCALENDAR wrapper", ics.includes("BEGIN:VCALENDAR") && ics.includes("END:VCALENDAR"));
  check("DTSTART is a bare DATE value", ics.includes("DTSTART;VALUE=DATE:20260305"));
  check("DTEND is the day after (exclusive end)", ics.includes("DTEND;VALUE=DATE:20260306"));
  check("SUMMARY uses the ritual title", ics.includes("SUMMARY:Design Crit"));
  check("uses CRLF line endings", ics.includes("\r\n"));
}

console.log("\nMulti-day all-day span (a campaign)");
{
  const span = { ...base, endDate: "2026-03-11" }; // a 1-week campaign
  const ics = buildCalendar("Test Plan", "UTC", [span]);
  check("DTSTART is the first day", ics.includes("DTSTART;VALUE=DATE:20260305"));
  check("DTEND is the day AFTER the last day (the 12th, not the 11th)", ics.includes("DTEND;VALUE=DATE:20260312"));
}

console.log("\nTimed event with duration");
{
  const timed = { ...base, startTime: "10:00", durationMin: 60 };
  const ics = buildCalendar("Test Plan", "America/New_York", [timed]);
  check("DTSTART carries the TZID", ics.includes("DTSTART;TZID=America/New_York:20260305T100000"));
  check("DTEND is start + duration", ics.includes("DTEND;TZID=America/New_York:20260305T110000"));
}

console.log("\nTimed event with no duration set falls back to 60 minutes");
{
  const timed = { ...base, startTime: "14:30", durationMin: null };
  const ics = buildCalendar("Test Plan", "UTC", [timed]);
  check("defaults to a 60-minute block", ics.includes("DTSTART;TZID=UTC:20260305T143000") && ics.includes("DTEND;TZID=UTC:20260305T153000"));
}

console.log("\nDuration crossing midnight rolls to the next day");
{
  const timed = { ...base, startTime: "23:30", durationMin: 90 };
  const ics = buildCalendar("Test Plan", "UTC", [timed]);
  check("DTEND lands on the next calendar day", ics.includes("DTEND;TZID=UTC:20260306T010000"), ics);
}

console.log("\nText escaping (RFC 5545 §3.3.11)");
{
  const nasty = { ...base, ritualPurpose: "Uses; commas, semicolons\\backslashes and\nnewlines" };
  const ics = buildCalendar("Test Plan", "UTC", [nasty]);
  check("semicolons escaped", ics.includes("commas\\, semicolons"));
  check("backslash escaped", ics.includes("semicolons\\\\backslashes"));
  check("newline escaped to literal \\n", ics.includes("and\\nnewlines"));
}

console.log("\nStatus handling");
{
  const skipped = { ...base, id: "occ-skip", status: "skipped" };
  const cancelled = { ...base, id: "occ-cancel", status: "cancelled" };
  const planned = { ...base, id: "occ-plan", status: "planned" };
  const ics = buildCalendar("Test Plan", "UTC", [skipped, cancelled, planned]);
  check("skipped occurrences are kept but marked CANCELLED", ics.includes("UID:occ-skip@ritual-builder") && /UID:occ-skip@ritual-builder\r\n[\s\S]*?STATUS:CANCELLED/.test(ics));
  check("genuinely cancelled occurrences are omitted entirely", !ics.includes("UID:occ-cancel@ritual-builder"));
  check("planned occurrences are marked CONFIRMED", /UID:occ-plan@ritual-builder\r\n[\s\S]*?STATUS:CONFIRMED/.test(ics));
}

console.log("\nLine folding (RFC 5545 §3.1) — lines over 75 octets get folded");
{
  const longSummary = { ...base, ritualTitle: "A".repeat(120) };
  const ics = buildCalendar("Test Plan", "UTC", [longSummary]);
  const summaryLine = ics.split("\r\n").find((l) => l.startsWith("SUMMARY:"));
  check("the first physical line of a folded SUMMARY is <=75 chars", summaryLine.length <= 75, `got ${summaryLine.length}`);
  check("a continuation line (starting with a space) follows", ics.split("\r\n").some((l) => l.startsWith(" AAAA")));
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
