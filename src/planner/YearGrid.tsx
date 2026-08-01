import { getMonthSpans, getYearWeeks, isQuarterStart, daysBetweenISO } from "../lib/calendar";
import type { CategoryDto } from "../hooks/useLibrary";
import type { OccurrenceDto, SlotDto } from "../hooks/usePlanner";

const LABEL_COL = "160px";

/**
 * The signature view (PLAN.md §5.1): one column per week for the whole plan,
 * one lane per slot, so an empty stretch of cells reads at a glance as "no
 * learning this quarter" — a signal month/quarter view can't give because
 * they only show one month at a time.
 *
 * Unlike the month/quarter calendar, campaigns and series render as real
 * bars spanning their weeks here, not a separate banner list — this is the
 * view PLAN.md §5.1 specifically calls out for span bars.
 */
export function YearGrid({
  startDate,
  endDate,
  slots,
  pointOccurrences,
  campaigns,
  categoryById,
  onSelect,
}: {
  startDate: string;
  endDate: string;
  slots: SlotDto[];
  pointOccurrences: OccurrenceDto[];
  campaigns: OccurrenceDto[];
  categoryById: Map<number, CategoryDto>;
  onSelect: (occurrence: OccurrenceDto) => void;
}) {
  const weeks = getYearWeeks(startDate, endDate);
  const monthSpans = getMonthSpans(weeks);
  const columnTemplate = `${LABEL_COL} repeat(${weeks.length}, minmax(16px, 1fr))`;

  const weekIndexOf = (date: string) => Math.floor(daysBetweenISO(startDate, date) / 7);

  const bySlotAndWeek = new Map<string, OccurrenceDto>();
  const standaloneByWeek = new Map<number, OccurrenceDto[]>();
  for (const occ of pointOccurrences) {
    const wk = weekIndexOf(occ.date);
    if (wk < 0 || wk >= weeks.length) continue;
    if (occ.slotId) bySlotAndWeek.set(`${occ.slotId}:${wk}`, occ);
    else standaloneByWeek.set(wk, [...(standaloneByWeek.get(wk) ?? []), occ]);
  }

  function borderFor(weekIndex: number) {
    return isQuarterStart(weeks, weekIndex) ? "2px solid var(--of-border-strong)" : "1px solid var(--of-border-line)";
  }

  function Cell({ occurrence, weekIndex }: { occurrence?: OccurrenceDto; weekIndex: number }) {
    const category = occurrence?.ritual?.categoryId ? categoryById.get(occurrence.ritual.categoryId) : undefined;
    return (
      <button
        onClick={() => occurrence && onSelect(occurrence)}
        disabled={!occurrence}
        title={occurrence ? occurrence.titleOverride || occurrence.ritual?.title : undefined}
        className="h-6 rounded-sm"
        style={{
          borderLeft: borderFor(weekIndex),
          background: occurrence ? (category?.color ?? "var(--of-fg-subtle)") : "transparent",
          cursor: occurrence ? "pointer" : "default",
        }}
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth: `calc(${LABEL_COL} + ${weeks.length} * 16px)` }}>
        {/* Month header */}
        <div className="grid mb-1" style={{ gridTemplateColumns: columnTemplate }}>
          <div />
          {monthSpans.map((m, i) => (
            <div
              key={i}
              className="text-xs font-medium pb-1 truncate"
              style={{ gridColumn: `span ${m.span}`, color: "var(--of-fg-subtle)" }}
            >
              {m.label}
            </div>
          ))}
        </div>

        {/* Slot lanes */}
        {slots.map((slot) => (
          <div key={slot.id} className="grid items-center" style={{ gridTemplateColumns: columnTemplate }}>
            <div className="text-sm font-medium pr-2 truncate" title={slot.name}>
              {slot.name}
            </div>
            {weeks.map((week) => (
              <Cell key={week.index} occurrence={bySlotAndWeek.get(`${slot.id}:${week.index}`)} weekIndex={week.index} />
            ))}
          </div>
        ))}

        {/* Standalone (non-slot, non-span) occurrences */}
        <div className="grid items-center" style={{ gridTemplateColumns: columnTemplate }}>
          <div className="text-sm font-medium pr-2 truncate" style={{ color: "var(--of-fg-muted)" }}>
            Other
          </div>
          {weeks.map((week) => (
            <Cell key={week.index} occurrence={standaloneByWeek.get(week.index)?.[0]} weekIndex={week.index} />
          ))}
        </div>

        {/* Campaigns & series — real span bars, per PLAN.md §5.1 */}
        {campaigns.length > 0 && (
          <div className="mt-3 pt-2 flex flex-col gap-1.5" style={{ borderTop: "1px solid var(--of-border-line)" }}>
            {campaigns.map((occ) => {
              const startWk = Math.max(0, weekIndexOf(occ.date));
              const endWk = Math.min(weeks.length - 1, weekIndexOf(occ.endDate!));
              const category = occ.ritual?.categoryId ? categoryById.get(occ.ritual.categoryId) : undefined;
              return (
                <div key={occ.id} className="grid items-center" style={{ gridTemplateColumns: columnTemplate }}>
                  <div className="text-sm font-medium pr-2 truncate" title={occ.ritual?.title}>
                    {occ.titleOverride || occ.ritual?.title}
                  </div>
                  <button
                    onClick={() => onSelect(occ)}
                    className="h-6 rounded-full px-2 text-left text-[11px] leading-6 text-white truncate"
                    style={{ gridColumn: `${startWk + 2} / ${endWk + 3}`, background: category?.color ?? "var(--of-fg-brand)" }}
                  >
                    {occ.titleOverride || occ.ritual?.title}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
