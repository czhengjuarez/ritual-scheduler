import { useState } from "react";
import { Search } from "lucide-react";
import { inputClass, badgeClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { useRituals } from "../hooks/useLibrary";
import type { RitualDto } from "../hooks/useLibrary";

/**
 * Click-to-assign in place of drag-and-drop for this first pass (PLAN.md §3
 * describes CycleBoard as drag-based; true drag interactions are deferred to
 * Phase 9 polish — this gets the same functional outcome without a DnD
 * dependency yet).
 */
export function RitualPickerModal({ onSelect, onClose }: { onSelect: (ritual: RitualDto | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const { data, isLoading } = useRituals({ q: q || undefined });

  return (
    <Modal title="Choose a ritual" onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search size={20} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--of-fg-subtle)" }} />
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search rituals…"
            className={inputClass({ className: "pl-10 w-full" })}
          />
        </div>

        <button
          onClick={() => onSelect(null)}
          className="text-left px-3 py-2 rounded-md text-sm border"
          style={{ borderColor: "var(--of-border-line)", color: "var(--of-fg-muted)" }}
        >
          Leave this position unassigned (theme only)
        </button>

        <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
          {isLoading && <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>}
          {data?.items.map((ritual) => (
            <button
              key={ritual.id}
              onClick={() => onSelect(ritual)}
              className="flex items-center justify-between gap-3 text-left px-3 py-2 rounded-md hover:opacity-80"
              style={{ background: "var(--of-bg-recessed)" }}
            >
              <div>
                <div className="font-medium text-sm">{ritual.title}</div>
                {ritual.summary && (
                  <div className="text-xs" style={{ color: "var(--of-fg-muted)" }}>
                    {ritual.summary}
                  </div>
                )}
              </div>
              <span className={badgeClass({ variant: ritual.load === "heavy" ? "red" : ritual.load === "light" ? "green" : "amber" })}>{ritual.load}</span>
            </button>
          ))}
          {data && data.items.length === 0 && <p style={{ color: "var(--of-fg-muted)" }}>No matches.</p>}
        </div>
      </div>
    </Modal>
  );
}
