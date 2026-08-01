import { AlertTriangle, Info } from "lucide-react";
import { cardClass } from "@ops-forward/keel";
import { useWarnings } from "../hooks/usePlanner";

/** Rules-based spacing intelligence, not AI — cheap and instant (PLAN.md §5.1). */
export function WarningsPanel({ planId }: { planId: string }) {
  const { data } = useWarnings(planId);
  if (!data || data.items.length === 0) return null;

  return (
    <div className={cardClass({ className: "p-4 flex flex-col gap-2" })}>
      <h3 className="text-sm font-semibold">Scheduling notes</h3>
      {data.items.map((w, i) => (
        <div key={i} className="flex items-start gap-2 text-sm">
          {w.severity === "warning" ? (
            <AlertTriangle size={20} strokeWidth={1.75} className="!w-4 !h-4 shrink-0 mt-0.5" style={{ color: "var(--of-fg-warning)" }} />
          ) : (
            <Info size={20} strokeWidth={1.75} className="!w-4 !h-4 shrink-0 mt-0.5" style={{ color: "var(--of-fg-info)" }} />
          )}
          <span style={{ color: "var(--of-fg-muted)" }}>{w.message}</span>
        </div>
      ))}
    </div>
  );
}
