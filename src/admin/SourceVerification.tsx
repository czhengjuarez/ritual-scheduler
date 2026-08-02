import { ExternalLink, Check } from "lucide-react";
import { buttonClass, cardClass } from "@ops-forward/keel";
import { useAdminRituals, useRitualModeration } from "../hooks/useAdmin";

/**
 * A worklist, not a gate (PLAN.md §6c): unverified attributed rituals still
 * publish — they're marked, not blocked. This view just makes the batch of
 * "check this citation when you get a chance" visible.
 */
export function SourceVerification() {
  const { data, isLoading } = useAdminRituals({ sourceVerified: false });
  const { update } = useRitualModeration();

  return (
    <div className="flex flex-col gap-4">
      <p style={{ color: "var(--of-fg-muted)" }}>
        Attributed to a named source but not yet double-checked. These are already public — verifying just confirms
        the citation is accurate.
      </p>

      {isLoading && <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>}
      {data && data.items.length === 0 && <p style={{ color: "var(--of-fg-muted)" }}>Everything's verified.</p>}

      <div className="flex flex-col gap-3">
        {data?.items.map((ritual) => (
          <div key={ritual.id} className={cardClass({ className: "p-4 flex items-center justify-between gap-4" })}>
            <div>
              <h3 className="font-semibold">{ritual.title}</h3>
              <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
                {ritual.sourceName}
                {ritual.sourceUrl && (
                  <a href={ritual.sourceUrl} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1" style={{ color: "var(--of-fg-brand)" }}>
                    <ExternalLink size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" /> check source
                  </a>
                )}
              </p>
            </div>
            <button className={buttonClass({ variant: "primary", size: "sm" })} onClick={() => update.mutate({ id: ritual.id, sourceVerified: true })}>
              <Check size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Mark verified
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
