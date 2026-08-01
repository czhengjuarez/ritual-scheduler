/**
 * Calendar-date math for the planner. Deliberately not `Date`-timestamp based:
 * these are calendar dates (YYYY-MM-DD), not instants, and mixing the two is
 * the classic source of "my Thursday ritual moved to Wednesday" bugs
 * (PLAN.md §4). Every computation here works in whole days via an epoch-day
 * integer, so DST and local-timezone quirks of the host runtime never enter
 * the picture — timezone only matters at ICS export time (Phase 3).
 */

export type Freq = "weekly" | "biweekly" | "monthly";

export interface SlotLike {
  anchorDate: string;
  freq: Freq;
  cycleLength: number;
  activeFrom?: string | null;
  activeTo?: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

function parseISODate(s: string): YMD {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}

function toEpochDay({ y, m, d }: YMD): number {
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

function fromEpochDay(epoch: number): string {
  const dt = new Date(epoch * 86_400_000);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Sunday .. 6 = Saturday, matching `Date#getUTCDay()`. */
export function weekdayOf(dateStr: string): number {
  const { y, m, d } = parseISODate(dateStr);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function todayISO(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
}

export function addDaysISO(dateStr: string, days: number): string {
  return fromEpochDay(toEpochDay(parseISODate(dateStr)) + days);
}

export function daysBetweenISO(a: string, b: string): number {
  return toEpochDay(parseISODate(b)) - toEpochDay(parseISODate(a));
}

/** Consistent 7-day bucket for "is this in the same week" clustering checks (§5.1 warnings). Not a calendar-accurate ISO week — just a stable grouping. */
export function weekBucket(dateStr: string): number {
  return Math.floor(toEpochDay(parseISODate(dateStr)) / 7);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, nth: number): YMD | null {
  if (nth > 0) {
    const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    const day = 1 + ((weekday - firstWeekday + 7) % 7) + (nth - 1) * 7;
    return day <= daysInMonth(year, month) ? { y: year, m: month, d: day } : null;
  }
  // nth === -1: the last occurrence of `weekday` in the month
  const last = daysInMonth(year, month);
  const lastWeekday = new Date(Date.UTC(year, month - 1, last)).getUTCDay();
  const day = last - ((lastWeekday - weekday + 7) % 7);
  return { y: year, m: month, d: day };
}

/**
 * Which occurrence of its weekday `anchor` is within its month (1..4), or -1
 * if it's the last one. Derived, never client-supplied, so it can't disagree
 * with anchorDate.
 *
 * Deliberately: any anchor that falls in a month's final 7 days — including a
 * literal "5th Friday" — is treated as "last Friday of the month", not
 * "5th occurrence, skip in months without one". A monthly ritual anchored on
 * a 5th-occurrence date would otherwise vanish in most months, since only
 * some months have 5 of a given weekday; "last weekday of month" is what a
 * user picking that date almost always means, and it's what mainstream
 * calendar tools do with the same input.
 */
function deriveNth(anchor: YMD): number {
  const occurrence = Math.floor((anchor.d - 1) / 7) + 1;
  const isLast = anchor.d + 7 > daysInMonth(anchor.y, anchor.m);
  return isLast ? -1 : occurrence;
}

/**
 * `byweekday` is always derived from `anchorDate`, never accepted as
 * independent input — the two fields could otherwise silently disagree
 * (PLAN.md §4: "slots.byweekday").
 */
export function deriveByweekday(anchorDate: string): number {
  return weekdayOf(anchorDate);
}

const MAX_ITERATIONS = 400; // safety cap; a 1-year weekly plan needs ~52

/**
 * The core occurrence-generation algorithm (PLAN.md §4): every date matching
 * the slot's recurrence between its anchor and `to`, each tagged with its
 * rotation-cycle position. Always walks from `anchorDate` regardless of the
 * requested `from` — the rotation phase (§1.3's 4-week cadence) depends on
 * the absolute occurrence index since anchor, not on the window being
 * queried, so slicing the walk to `from` would silently shift the phase.
 * The `from`/`to`/active-range filtering happens only on the output.
 */
export function generateSlotDates(slot: SlotLike, from: string, to: string): { date: string; position: number }[] {
  const results: { date: string; position: number }[] = [];
  const cycleLength = Math.max(1, slot.cycleLength);
  const lowerBound = slot.activeFrom && slot.activeFrom > from ? slot.activeFrom : from;
  const upperBound = slot.activeTo && slot.activeTo < to ? slot.activeTo : to;
  if (lowerBound > upperBound) return results;

  const pushIfInRange = (date: string, index: number) => {
    if (date >= lowerBound && date <= upperBound) {
      results.push({ date, position: index % cycleLength });
    }
  };

  if (slot.freq === "weekly" || slot.freq === "biweekly") {
    const step = slot.freq === "weekly" ? 7 : 14;
    let epoch = toEpochDay(parseISODate(slot.anchorDate));
    const toEpoch = toEpochDay(parseISODate(upperBound));
    for (let index = 0; epoch <= toEpoch && index < MAX_ITERATIONS; index++, epoch += step) {
      pushIfInRange(fromEpochDay(epoch), index);
    }
    return results;
  }

  // monthly
  const anchor = parseISODate(slot.anchorDate);
  const weekday = weekdayOf(slot.anchorDate);
  const nth = deriveNth(anchor);
  const toEpoch = toEpochDay(parseISODate(upperBound));
  let y = anchor.y;
  let m = anchor.m;
  let index = 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const candidate = nthWeekdayOfMonth(y, m, weekday, nth);
    if (candidate) {
      const epoch = toEpochDay(candidate);
      if (epoch > toEpoch) break;
      pushIfInRange(fromEpochDay(epoch), index);
      index++;
    }
    // A month with no valid Nth weekday (e.g. a "5th Friday" that doesn't
    // exist that month) is skipped without advancing the rotation index —
    // the rotation shouldn't lose a turn just because a month was short.
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return results;
}
