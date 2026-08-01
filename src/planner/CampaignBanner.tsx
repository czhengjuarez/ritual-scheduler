import { CalendarRange } from "lucide-react";
import { cardClass, badgeClass } from "@ops-forward/keel";
import type { OccurrenceDto } from "../hooks/usePlanner";

/**
 * Campaigns and series render as a banner list rather than inline bars in
 * the month/quarter grid — see MonthCalendar's comment for why that's the
 * right scope for this phase.
 */
export function CampaignBanner({ occurrences, onSelect }: { occurrences: OccurrenceDto[]; onSelect: (o: OccurrenceDto) => void }) {
  if (occurrences.length === 0) return null;

  return (
    <div className={cardClass({ className: "p-3 flex flex-col gap-2" })}>
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <CalendarRange size={20} strokeWidth={1.75} className="!w-4 !h-4" />
        Campaigns & multi-week rituals
      </h3>
      {occurrences.map((occ) => (
        <button
          key={occ.id}
          onClick={() => onSelect(occ)}
          className="flex items-center justify-between gap-3 text-left text-sm px-2 py-1.5 rounded-md"
          style={{ background: "var(--of-bg-recessed)" }}
        >
          <span>{occ.titleOverride || occ.ritual?.title}</span>
          <span className="flex items-center gap-2 shrink-0">
            <span style={{ color: "var(--of-fg-subtle)" }}>
              {occ.date} → {occ.endDate}
            </span>
            <span className={badgeClass({ variant: "default" })}>{occ.status}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
