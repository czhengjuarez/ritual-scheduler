import { cardClass } from "@ops-forward/keel";
import { CalendarDays } from "lucide-react";

export function PlanPage() {
  return (
    <div className={cardClass({ className: "max-w-2xl mx-auto p-8 text-center" })}>
      <CalendarDays size={20} strokeWidth={1.75} className="mx-auto mb-3" style={{ color: "var(--of-fg-brand)" }} />
      <h1 className="text-xl font-semibold mb-2">Your plan</h1>
      <p style={{ color: "var(--of-fg-muted)" }}>
        This is the home screen — your team's cadence, once it exists. The year, quarter,
        and month views land in Phase 2–3.
      </p>
    </div>
  );
}
