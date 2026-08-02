import { useState } from "react";
import { Search, Plus } from "lucide-react";
import { inputClass, badgeClass, buttonClass, selectClass, labelClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { useRituals, useCategories, useCreateRitual } from "../hooks/useLibrary";
import type { RitualDto } from "../hooks/useLibrary";

/**
 * Click-to-assign in place of drag-and-drop for this first pass (PLAN.md §3
 * describes CycleBoard as drag-based; true drag interactions are deferred to
 * Phase 9 polish — this gets the same functional outcome without a DnD
 * dependency yet).
 */
export function RitualPickerModal({ onSelect, onClose }: { onSelect: (ritual: RitualDto | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [load, setLoad] = useState<"light" | "medium" | "heavy">("medium");
  // Captured once at mount, not at submit — this is what the spam-timing
  // check on the server actually measures (PLAN.md §5.5).
  const [renderedAt] = useState(() => Date.now());

  const { data, isLoading } = useRituals({ q: q || undefined });
  const { data: categoriesData } = useCategories();
  const createRitual = useCreateRitual();

  const exactMatch = data?.items.some((r) => r.title.toLowerCase() === q.trim().toLowerCase());

  const submitNew = () => {
    if (!q.trim()) return;
    createRitual.mutate(
      { title: q.trim(), categoryId: categoryId || undefined, load, renderedAt },
      { onSuccess: (result) => "item" in result && onSelect(result.item) },
    );
  };

  return (
    <Modal title="Choose a ritual" onClose={onClose} wide>
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search size={20} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--of-fg-subtle)" }} />
          <input
            autoFocus
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setShowCreate(false);
            }}
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

        {q.trim() && !exactMatch && (
          <div className="border-t pt-3" style={{ borderColor: "var(--of-border-line)" }}>
            {!showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 text-sm px-3 py-2 rounded-md w-full"
                style={{ color: "var(--of-fg-brand)", background: "var(--of-bg-brand-subtle)" }}
              >
                <Plus size={20} strokeWidth={1.75} className="!w-4 !h-4" />
                Add "{q.trim()}" as a new ritual
              </button>
            ) : (
              <div className="flex flex-col gap-2 p-3 rounded-md" style={{ background: "var(--of-bg-recessed)" }}>
                <p className="text-sm font-medium">New ritual: {q.trim()}</p>
                <p className="text-xs" style={{ color: "var(--of-fg-muted)" }}>
                  Lands in your team's library right away — no approval needed. Publishing it publicly is a separate,
                  optional step from the Library page.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={labelClass()}>Category</label>
                    <select className={selectClass({ className: "w-full" })} value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
                      <option value="">None</option>
                      {categoriesData?.items.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelClass()}>Load</label>
                    <select className={selectClass({ className: "w-full" })} value={load} onChange={(e) => setLoad(e.target.value as typeof load)}>
                      <option value="light">Light</option>
                      <option value="medium">Medium</option>
                      <option value="heavy">Heavy</option>
                    </select>
                  </div>
                </div>
                <button className={buttonClass({ variant: "primary", size: "sm" })} onClick={submitNew} disabled={createRitual.isPending}>
                  {createRitual.isPending ? "Creating…" : "Create & use it"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
