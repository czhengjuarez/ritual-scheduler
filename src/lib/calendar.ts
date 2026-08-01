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
