import { useState } from "react";
import { Sparkles } from "lucide-react";
import { buttonClass, cardClass, badgeClass } from "@ops-forward/keel";
import { useBalanceAnalysis } from "../hooks/useAi";

/**
 * On-demand, not automatic (PLAN.md §5.6 #3) — the arithmetic (category mix,
 * hours/week, gaps) is cheap and could run on every load, but the AI
 * narrative on top of it is a rate-limited generation call, so this stays
 * behind a click like cadence suggestion does.
 */
export function BalancePanel({ planId }: { planId: string }) {
  const [requested, setRequested] = useState(false);
  const { data, isLoading, isError, refetch, isFetching } = useBalanceAnalysis(planId, requested);

  if (!requested) {
    return (
      <button className={buttonClass({ variant: "secondary", size: "sm" })} onClick={() => setRequested(true)}>
        <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--of-fg-brand)" }} /> Check balance
      </button>
    );
  }

  return (
    <div className={cardClass({ className: "p-4 flex flex-col gap-3" })}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--of-fg-brand)" }} /> Balance check
        </h3>
        <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => refetch()} disabled={isLoading || isFetching}>
          {isFetching ? "Checking…" : "Refresh"}
        </button>
      </div>

      {isLoading ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Analyzing…</p>
      ) : isError ? (
        <p style={{ color: "var(--of-fg-danger)" }}>Couldn't run the balance check — try again.</p>
      ) : data ? (
        <>
          <p className="text-sm" style={{ color: "var(--of-fg-default)" }}>{data.narrative}</p>
          <div className="flex flex-wrap gap-1.5 text-xs">
            <span className={badgeClass({ variant: "default" })}>{data.stats.totalOccurrences} occurrences / {data.stats.weeksInPlan} wk</span>
            <span className={badgeClass({ variant: "default" })}>~{data.stats.avgHoursPerWeek} hrs/week</span>
            <span className={badgeClass({ variant: "default" })}>busiest week: {data.stats.busiestWeekCount}</span>
            {data.stats.gapWeeks > 0 && <span className={badgeClass({ variant: "default" })}>{data.stats.gapWeeks} empty week(s)</span>}
            {data.stats.categoryMix.map((m) => (
              <span key={m.name} className={badgeClass({ variant: "default" })}>{m.name} {m.pct}%</span>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
