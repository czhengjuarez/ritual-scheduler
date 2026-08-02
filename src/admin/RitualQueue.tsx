import { useState } from "react";
import { Check, X, Trash2 } from "lucide-react";
import { buttonClass, cardClass, badgeClass } from "@ops-forward/keel";
import { useAdminRituals, useRitualModeration } from "../hooks/useAdmin";

const STATUSES = ["pending", "published", "rejected"] as const;

/** The secondary queue (PLAN.md §5.5) — cadences are primary; this is for the rare ritual submitted on its own. */
export function RitualQueue() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const { data, isLoading } = useAdminRituals({ status });
  const { approve, reject, remove } = useRitualModeration();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        {STATUSES.map((s) => (
          <button key={s} className={buttonClass({ variant: status === s ? "primary" : "secondary", size: "sm" })} onClick={() => setStatus(s)}>
            {s}
          </button>
        ))}
      </div>

      {isLoading && <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>}
      {data && data.items.length === 0 && <p style={{ color: "var(--of-fg-muted)" }}>Nothing here.</p>}

      <div className="flex flex-col gap-3">
        {data?.items.map((ritual) => (
          <div key={ritual.id} className={cardClass({ className: "p-4 flex items-start justify-between gap-4" })}>
            <div>
              <h3 className="font-semibold mb-1">{ritual.title}</h3>
              {ritual.summary && (
                <p className="text-sm mb-2" style={{ color: "var(--of-fg-muted)" }}>
                  {ritual.summary}
                </p>
              )}
              <div className="flex gap-1.5 text-xs">
                <span className={badgeClass({ variant: "default" })}>{ritual.load}</span>
                <span className={badgeClass({ variant: "default" })}>{ritual.engagement}</span>
                {ritual.sourceName && <span className={badgeClass({ variant: ritual.sourceVerified ? "green" : "amber" })}>{ritual.sourceName}</span>}
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {status === "pending" && (
                <>
                  <button className={buttonClass({ variant: "primary", size: "sm" })} onClick={() => approve.mutate(ritual.id)}>
                    <Check size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Approve
                  </button>
                  <button className={buttonClass({ variant: "danger", size: "sm" })} onClick={() => reject.mutate(ritual.id)}>
                    <X size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Reject
                  </button>
                </>
              )}
              <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => remove.mutate(ritual.id)}>
                <Trash2 size={20} strokeWidth={1.75} className="!w-4 !h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
