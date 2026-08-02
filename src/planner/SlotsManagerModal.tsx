import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { buttonClass, badgeClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { useSlots, useDeleteSlot } from "../hooks/usePlanner";
import { describeCadence } from "../lib/cadence";
import { CycleEditorModal } from "./CycleEditorModal";
import type { SlotDto } from "../hooks/usePlanner";

/**
 * There's no other way to edit or delete an existing recurring slot —
 * "Add slot" only ever created new ones. Delete mirrors what
 * `DELETE /slots/:slotId` actually does (worker/planner.ts): future planned,
 * unedited occurrences go with it; anything already touched or in the past
 * survives, orphaned from the slot.
 */
export function SlotsManagerModal({ planId, onClose }: { planId: string; onClose: () => void }) {
  const { data, isLoading } = useSlots(planId);
  const del = useDeleteSlot(planId);
  const items = data?.items ?? [];
  const [editing, setEditing] = useState<SlotDto | null>(null);

  return (
    <Modal title="Manage slots" onClose={onClose} wide>
      {isLoading ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--of-fg-muted)" }}>No slots yet — use "Add slot" to create a recurring rotation.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((slot) => (
            <div key={slot.id} className="flex items-center justify-between gap-3 p-3 rounded-md flex-wrap" style={{ background: "var(--of-bg-recessed)" }}>
              <div className="min-w-0">
                <p className="font-medium truncate">{slot.name}</p>
                <p className="text-sm truncate" style={{ color: "var(--of-fg-muted)" }}>
                  {describeCadence(slot)}
                </p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {slot.rotation.map((r) => (
                    <span key={r.id} className={badgeClass({ variant: "default" })}>
                      {r.ritual?.title ?? r.label ?? "Untitled"}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setEditing(slot)}>
                  <Pencil size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" /> Edit
                </button>
                <button
                  className={buttonClass({ variant: "danger", size: "sm" })}
                  disabled={del.isPending}
                  onClick={() => {
                    if (window.confirm(`Delete "${slot.name}"? This removes its future planned occurrences too — past and edited ones stay.`)) {
                      del.mutate(slot.id);
                    }
                  }}
                >
                  <Trash2 size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && <CycleEditorModal planId={planId} existingSlot={editing} onClose={() => setEditing(null)} />}
    </Modal>
  );
}
