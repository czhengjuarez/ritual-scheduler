// Verifies the occurrence-generation date math against known scenarios,
// including the anchor 4-week rotation from PLAN.md §1.3 and the month-length
// edge cases that are the classic source of off-by-one bugs in this kind of code.
import { generateSlotDates, deriveByweekday, weekdayOf, addDaysISO, daysBetweenISO, weekBucket, firstMatchingDate } from "./schedule.ts";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${detail}`); }
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

console.log("\nWeekly rotation (the PLAN.md §1.3 anchor case)");
{
  // 2026-01-01 is a Thursday
  const slot = { anchorDate: "2026-01-01", freq: "weekly", cycleLength: 4 };
  const dates = generateSlotDates(slot, "2026-01-01", "2026-03-31");
  check("first date is the anchor itself", dates[0].date === "2026-01-01", JSON.stringify(dates[0]));
  check("anchor is position 0", dates[0].position === 0);
  check("generates ~13 weeks in a quarter", dates.length === 13, `got ${dates.length}`);
  check("positions cycle 0,1,2,3,0,1,2,3...", eq(dates.slice(0, 8).map(d => d.position), [0, 1, 2, 3, 0, 1, 2, 3]));
  check("every date is 7 days after the previous", dates.every((d, i) => i === 0 || daysBetweenISO(dates[i - 1].date, d.date) === 7));
  check("every date falls on the anchor's weekday", dates.every(d => weekdayOf(d.date) === weekdayOf("2026-01-01")));
}

console.log("\nPhase doesn't shift when querying a sub-window");
{
  const slot = { anchorDate: "2026-01-01", freq: "weekly", cycleLength: 4 };
  const full = generateSlotDates(slot, "2026-01-01", "2026-06-30");
  const target = full[10]; // some occurrence well past the anchor
  const windowed = generateSlotDates(slot, target.date, target.date);
  check("querying just that date returns exactly it with the same position",
    windowed.length === 1 && windowed[0].position === target.position,
    `expected position ${target.position}, got ${JSON.stringify(windowed)}`);
}

console.log("\nBiweekly");
{
  const slot = { anchorDate: "2026-01-01", freq: "biweekly", cycleLength: 2 };
  const dates = generateSlotDates(slot, "2026-01-01", "2026-04-01");
  check("steps by 14 days", dates.every((d, i) => i === 0 || daysBetweenISO(dates[i - 1].date, d.date) === 14));
  check("positions alternate 0,1,0,1...", eq(dates.slice(0, 4).map(d => d.position), [0, 1, 0, 1]));
}

console.log("\nMonthly — nth weekday derived from anchor, not client-supplied");
{
  // 2026-01-08 is the 2nd Thursday of January 2026.
  const slot = { anchorDate: "2026-01-08", freq: "monthly", cycleLength: 3 };
  const dates = generateSlotDates(slot, "2026-01-01", "2026-12-31");
  check("first is the anchor", dates[0].date === "2026-01-08");
  check("12 monthly occurrences in a year", dates.length === 12, `got ${dates.length}`);
  check("every occurrence is a Thursday", dates.every(d => weekdayOf(d.date) === 4));
  // spot-check a later month: 2nd Thursday of July 2026 is July 9.
  const july = dates.find(d => d.date.startsWith("2026-07"));
  check("2nd Thursday of July 2026 is the 9th", july?.date === "2026-07-09", JSON.stringify(july));
}

console.log("\nMonthly — 'last weekday of month' (nth = -1)");
{
  // 2026-01-29 is the last Thursday of January 2026 (the only other Thursdays are 1,8,15,22).
  const slot = { anchorDate: "2026-01-29", freq: "monthly", cycleLength: 1 };
  const dates = generateSlotDates(slot, "2026-01-01", "2026-06-30");
  const feb = dates.find(d => d.date.startsWith("2026-02"));
  // Last Thursday of Feb 2026 is Feb 26.
  check("last Thursday of Feb 2026 is the 26th", feb?.date === "2026-02-26", JSON.stringify(feb));
}

console.log("\nMonthly — a '5th weekday' anchor means 'last weekday of month', not 'skip if absent'");
{
  // 2026-01-30 is the 5th Friday of January 2026 (Fridays: 2,9,16,23,30) —
  // and also, not coincidentally, January's *last* Friday.
  const slot = { anchorDate: "2026-01-30", freq: "monthly", cycleLength: 1 };
  const dates = generateSlotDates(slot, "2026-01-01", "2026-12-31");
  check("12 occurrences in a year — no month is skipped", dates.length === 12, `got ${dates.length}`);
  // February 2026 has no 5th Friday at all (Fridays: 6,13,20,27) — this is
  // exactly the case that would vanish under literal "5th occurrence" semantics.
  const feb = dates.find(d => d.date.startsWith("2026-02"));
  check("February still gets its (last) Friday, the 27th", feb?.date === "2026-02-27", JSON.stringify(feb));
}

console.log("\nactiveFrom / activeTo bounding");
{
  const slot = { anchorDate: "2026-01-01", freq: "weekly", cycleLength: 1, activeFrom: "2026-02-01", activeTo: "2026-02-28" };
  const dates = generateSlotDates(slot, "2026-01-01", "2026-12-31");
  check("no dates before activeFrom", dates.every(d => d.date >= "2026-02-01"));
  check("no dates after activeTo", dates.every(d => d.date <= "2026-02-28"));
  check("some dates in February", dates.length > 0);
}

console.log("\nHelpers");
{
  check("deriveByweekday matches Date#getUTCDay()", deriveByweekday("2026-01-01") === new Date("2026-01-01T00:00:00Z").getUTCDay());
  check("addDaysISO adds calendar days correctly across a month boundary", addDaysISO("2026-01-30", 3) === "2026-02-02");
  check("weekBucket groups a 7-day span into buckets that differ by exactly one across a 7-day gap",
    weekBucket(addDaysISO("2026-01-01", 7)) - weekBucket("2026-01-01") === 1);
}

console.log("\nfirstMatchingDate — reconstructing an anchor from a cadence template's date-free pattern (PLAN.md §4)");
{
  // 2026-01-01 is a Thursday (weekday 4).
  check("weekly: from date already on the target weekday returns that date unchanged",
    firstMatchingDate("weekly", 4, null, "2026-01-01") === "2026-01-01");
  check("weekly: from a Monday, the next Thursday is 3 days later",
    firstMatchingDate("weekly", 4, null, "2026-01-05") === "2026-01-08");
  check("weekly: from a Friday, wraps to *next* week's Thursday, not backwards",
    firstMatchingDate("weekly", 4, null, "2026-01-02") === "2026-01-08");
  check("biweekly uses the same weekday-only logic as weekly for the first anchor",
    firstMatchingDate("biweekly", 4, null, "2026-01-05") === "2026-01-08");

  // Round-trip: derive a pattern from a real date, reconstruct a date from
  // that pattern starting earlier, and land on the *same* calendar date —
  // this is the exact clone-time operation (template pattern -> new anchor).
  const original = "2026-01-08"; // 2nd Thursday of January 2026
  const weekday = weekdayOf(original);
  const dates = generateSlotDates({ anchorDate: original, freq: "monthly", cycleLength: 1 }, original, original);
  check("sanity: monthly generation confirms 2026-01-08 is a valid monthly anchor", dates.length === 1 && dates[0].date === original);
  // Search from the day *after* December's own 2nd Thursday, so December
  // can't match and the search must roll into January to find the original.
  const reconstructed = firstMatchingDate("monthly", weekday, 2, "2025-12-12");
  check("monthly: reconstructing '2nd Thursday' rolls forward to the original date",
    reconstructed === original, `got ${reconstructed}`);

  check("monthly 'last Friday': from mid-month lands on that month's last Friday",
    firstMatchingDate("monthly", 5, -1, "2026-01-15") === "2026-01-30");
  check("monthly 'last Friday': from just after it rolls to *next* month's last Friday",
    firstMatchingDate("monthly", 5, -1, "2026-01-31") === "2026-02-27");
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
