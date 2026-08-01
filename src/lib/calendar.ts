/**
 * Client-side month-grid math. Deliberately separate from worker/schedule.ts
 * — that module computes recurrence dates for generation and must never ship
 * to the browser; this one only lays out a calendar grid for display.
 */

export interface DayCell {
  date: string; // YYYY-MM-DD
  inMonth: boolean;
  isToday: boolean;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isoDate(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function todayISO(): string {
  const now = new Date();
  return isoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = month - 1 + delta;
  const y = year + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return { year: y, month: m + 1 };
}

/** Weeks (Sun-first) covering the given month, including leading/trailing days from adjacent months so the grid is always a full set of 7-day rows. */
export function getMonthGrid(year: number, month: number): DayCell[][] {
  const today = todayISO();
  const firstOfMonth = new Date(year, month - 1, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=Sun
  const daysInMonth = new Date(year, month, 0).getDate();
  const daysInPrevMonth = new Date(year, month - 1, 0).getDate();

  const cells: DayCell[] = [];

  for (let i = startWeekday - 1; i >= 0; i--) {
    const { year: py, month: pm } = addMonths(year, month, -1);
    const d = daysInPrevMonth - i;
    const date = isoDate(py, pm, d);
    cells.push({ date, inMonth: false, isToday: date === today });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = isoDate(year, month, d);
    cells.push({ date, inMonth: true, isToday: date === today });
  }
  while (cells.length % 7 !== 0) {
    const { year: ny, month: nm } = addMonths(year, month, 1);
    const d = cells.length - (startWeekday + daysInMonth) + 1;
    const date = isoDate(ny, nm, d);
    cells.push({ date, inMonth: false, isToday: date === today });
  }

  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toEpochDay(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Math.floor(new Date(y, m - 1, d).getTime() / 86_400_000);
}

export function addDaysISO(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return isoDate(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

export function daysBetweenISO(a: string, b: string): number {
  return toEpochDay(b) - toEpochDay(a);
}

export interface YearWeek {
  index: number;
  start: string;
  end: string;
  month: number; // 1-12, of `start`
  year: number;
}

/**
 * Week columns for the year grid — the signature view (PLAN.md §5.1): one
 * column per 7-day span from the plan's start date, so "no occurrence this
 * week" reads as a visibly empty cell rather than being hidden by month
 * boundaries. `daysBetweenISO(plan.startDate, date) / 7` (floored) maps any
 * date straight to its column index without re-walking this array.
 */
export function getYearWeeks(startDate: string, endDate: string): YearWeek[] {
  const weeks: YearWeek[] = [];
  let cur = startDate;
  let i = 0;
  while (cur <= endDate) {
    const [y, m] = cur.split("-").map(Number);
    weeks.push({ index: i, start: cur, end: addDaysISO(cur, 6), year: y, month: m });
    cur = addDaysISO(cur, 7);
    i++;
  }
  return weeks;
}

/** Groups consecutive weeks under one month label, for a header row spanning multiple columns per month. */
export function getMonthSpans(weeks: YearWeek[]): { label: string; span: number }[] {
  const spans: { label: string; span: number }[] = [];
  for (const week of weeks) {
    const label = new Date(week.year, week.month - 1, 1).toLocaleDateString(undefined, { month: "short" });
    const last = spans.at(-1);
    if (last && last.label === label) last.span++;
    else spans.push({ label, span: 1 });
  }
  return spans;
}

const QUARTER_START_MONTHS = new Set([1, 4, 7, 10]);

/**
 * True for the first week whose month begins a calendar quarter (Jan/Apr/
 * Jul/Oct) — real quarters, not every 13th column, so the divider doesn't
 * drift for a plan that starts mid-quarter.
 */
export function isQuarterStart(weeks: YearWeek[], index: number): boolean {
  const week = weeks[index];
  if (!QUARTER_START_MONTHS.has(week.month)) return false;
  const prev = weeks[index - 1];
  return !prev || prev.month !== week.month;
}
