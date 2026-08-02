import { useState } from "react";
import { Check, X, Sparkles } from "lucide-react";
import { buttonClass, cardClass, badgeClass } from "@ops-forward/keel";
import { useAdminCadences, useCadenceModeration } from "../hooks/useAdmin";

const STATUSES = ["pending", "published", "rejected"] as const;

export function CadenceQueue() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("pending");
  const { data, isLoading } = useAdminCadences(status);
  const { approve, reject, update } = useCadenceModeration();

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
        {data?.items.map((cadence) => (
          <div key={cadence.id} className={cardClass({ className: "p-4 flex items-start justify-between gap-4" })}>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold">{cadence.name}</h3>
                {cadence.featured && <Sparkles size={20} strokeWidth={1.75} className="!w-4 !h-4" style={{ color: "var(--of-fg-brand)" }} />}
              </div>
              {cadence.summary && (
                <p className="text-sm mb-2" style={{ color: "var(--of-fg-muted)" }}>
                  {cadence.summary}
                </p>
              )}
              <div className="flex gap-1.5 text-xs">
                <span className={badgeClass({ variant: "default" })}>{cadence.durationWeeks} wk</span>
                {cadence.discipline && <span className={badgeClass({ variant: "default" })}>{cadence.discipline}</span>}
                <span className={badgeClass({ variant: "default" })}>{cadence.visibility}</span>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              {status === "pending" && (
                <>
                  <button className={buttonClass({ variant: "primary", size: "sm" })} onClick={() => approve.mutate(cadence.id)}>
                    <Check size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Approve
                  </button>
                  <button className={buttonClass({ variant: "danger", size: "sm" })} onClick={() => reject.mutate(cadence.id)}>
                    <X size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Reject
                  </button>
                </>
              )}
              {status === "published" && (
                <button className={buttonClass({ variant: "secondary", size: "sm" })} onClick={() => update.mutate({ id: cadence.id, featured: !cadence.featured })}>
                  {cadence.featured ? "Unfeature" : "Feature"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
