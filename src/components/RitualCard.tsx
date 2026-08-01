import { cardClass, badgeClass, type KeelBadgeVariant } from "@ops-forward/keel";
import { Clock, Repeat, CalendarRange } from "lucide-react";
import type { CategoryDto, RitualDto } from "../hooks/useLibrary";

const LOAD_VARIANT: Record<RitualDto["load"], KeelBadgeVariant> = {
  light: "green",
  medium: "amber",
  heavy: "red",
};

function engagementLabel(r: RitualDto): string {
  switch (r.engagement) {
    case "session":
      return "One-time session";
    case "series":
      return r.spanWeeks ? `${r.spanWeeks}-week series` : "Series";
    case "campaign":
      return r.spanWeeks ? `${r.spanWeeks}-week campaign` : "Campaign";
    case "recurring":
    default:
      return r.defaultCadence.charAt(0).toUpperCase() + r.defaultCadence.slice(1);
  }
}

export function RitualCard({ ritual, category }: { ritual: RitualDto; category?: CategoryDto }) {
  return (
    <div className={cardClass({ className: "p-4 flex flex-col gap-3 h-full" })}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold leading-snug">{ritual.title}</h3>
        <span className={badgeClass({ variant: LOAD_VARIANT[ritual.load] })}>{ritual.load}</span>
      </div>

      {ritual.summary && (
        <p className="text-sm flex-1" style={{ color: "var(--of-fg-muted)" }}>
          {ritual.summary}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: "var(--of-fg-subtle)" }}>
        {category && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: category.color ?? "var(--of-fg-subtle)" }} />
            {category.name}
          </span>
        )}
        <span className="flex items-center gap-1">
          {ritual.engagement === "recurring" ? <Repeat size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" /> : <CalendarRange size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" />}
          {engagementLabel(ritual)}
        </span>
        {ritual.durationMin && (
          <span className="flex items-center gap-1">
            <Clock size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" />
            {ritual.durationMin} min
          </span>
        )}
      </div>

      {ritual.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {ritual.tags.map((tag) => (
            <span key={tag} className={badgeClass({ variant: "default" })}>
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
