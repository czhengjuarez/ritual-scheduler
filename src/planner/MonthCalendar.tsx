import { getMonthGrid, monthLabel, WEEKDAY_LABELS } from "../lib/calendar";
import type { CategoryDto } from "../hooks/useLibrary";
import type { OccurrenceDto } from "../hooks/usePlanner";

/**
 * Point-in-time occurrences only — campaigns/series with a real span render
 * as a separate banner list (see PlanPage), not as bars inside day cells.
 * True inline span bars are the year grid's job in Phase 3 (PLAN.md §5.1);
 * solving that overlay inside a month/quarter day-cell grid isn't worth it
 * for a first pass when every span already reads fine as a banner.
 */
export function MonthCalendar({
  year,
  month,
  occurrencesByDate,
  categoryById,
  onSelect,
}: {
  year: number;
  month: number;
  occurrencesByDate: Map<string, OccurrenceDto[]>;
  categoryById: Map<number, CategoryDto>;
  onSelect: (occurrence: OccurrenceDto) => void;
}) {
  const weeks = getMonthGrid(year, month);

  return (
    <div>
      <h3 className="text-sm font-semibold mb-2">{monthLabel(year, month)}</h3>
      <div className="grid grid-cols-7 text-xs font-medium mb-1" style={{ color: "var(--of-fg-subtle)" }}>
        {WEEKDAY_LABELS.map((w) => (
          <div key={w} className="text-center py-1">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {weeks.flatMap((week) =>
          week.map((cell) => {
            const dayOccurrences = occurrencesByDate.get(cell.date) ?? [];
            const dayNumber = Number(cell.date.slice(-2));
            return (
              <div
                key={cell.date}
                className="min-h-[76px] rounded-md p-1 flex flex-col gap-0.5"
                style={{
                  background: cell.inMonth ? "var(--of-bg-recessed)" : "transparent",
                  opacity: cell.inMonth ? 1 : 0.4,
                  outline: cell.isToday ? "2px solid var(--of-border-brand)" : undefined,
                }}
              >
                <span className="text-xs" style={{ color: "var(--of-fg-subtle)" }}>
                  {dayNumber}
                </span>
                {dayOccurrences.slice(0, 3).map((occ) => {
                  const category = occ.ritual?.categoryId ? categoryById.get(occ.ritual.categoryId) : undefined;
                  return (
                    <button
                      key={occ.id}
                      onClick={() => onSelect(occ)}
                      className="text-left text-[11px] leading-tight rounded px-1 py-0.5 truncate"
                      style={{ background: category?.color ? `${category.color}22` : "var(--of-bg-sunken)", color: "var(--of-fg-default)" }}
                      title={occ.titleOverride || occ.ritual?.title}
                    >
                      {occ.titleOverride || occ.ritual?.title || "Untitled"}
                    </button>
                  );
                })}
                {dayOccurrences.length > 3 && (
                  <span className="text-[11px]" style={{ color: "var(--of-fg-subtle)" }}>
                    +{dayOccurrences.length - 3} more
                  </span>
                )}
              </div>
            );
          }),
        )}
      </div>
    </div>
  );
}
