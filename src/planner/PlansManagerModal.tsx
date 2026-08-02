import { useState } from "react";
import { ArchiveRestore, Eye, Pencil, Trash2 } from "lucide-react";
import { buttonClass, badgeClass, inputClass, type KeelBadgeVariant } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { usePlans, useDeletePlan, useUpdatePlan } from "../hooks/usePlanner";
import type { PlanDto } from "../hooks/usePlanner";

const STATUS_VARIANT: Record<PlanDto["status"], KeelBadgeVariant> = {
  active: "green",
  draft: "default",
  archived: "default",
};

/**
 * Plans coexist now (PlanPage.tsx no longer auto-archives on create), so
 * this doubles as the switcher for jumping the calendar to any of them —
 * not just the delete/rename hub. Editing name/dates goes through the same
 * `PATCH /api/plans/:id` the switcher's "View" doesn't touch at all.
 */
export function PlansManagerModal({
  onClose,
  currentPlanId,
  onSelectPlan,
}: {
  onClose: () => void;
  currentPlanId?: string | null;
  onSelectPlan?: (id: string) => void;
}) {
  const { data, isLoading } = usePlans();
  const del = useDeletePlan();
  const update = useUpdatePlan();
  const items = [...(data?.items ?? [])].reverse();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const startEdit = (plan: PlanDto) => {
    setEditingId(plan.id);
    setName(plan.name);
    setStartDate(plan.startDate);
    setEndDate(plan.endDate);
  };

  const saveEdit = () => {
    if (!editingId || !name.trim() || startDate > endDate) return;
    update.mutate({ id: editingId, name: name.trim(), startDate, endDate }, { onSuccess: () => setEditingId(null) });
  };

  return (
    <Modal title="Manage plans" onClose={onClose} wide>
      {isLoading ? (
        <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>
      ) : items.length === 0 ? (
        <p style={{ color: "var(--of-fg-muted)" }}>No plans yet.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((plan) => {
            const isCurrent = plan.id === currentPlanId;
            const isEditing = editingId === plan.id;
            return (
              <div
                key={plan.id}
                className="flex items-center justify-between gap-3 p-3 rounded-md flex-wrap"
                style={{ background: "var(--of-bg-recessed)", outline: isCurrent ? "2px solid var(--of-border-brand)" : undefined }}
              >
                {isEditing ? (
                  <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                    <input className={inputClass({ className: "flex-1 min-w-[10rem]" })} value={name} onChange={(e) => setName(e.target.value)} />
                    <input type="date" className={inputClass()} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                    <input type="date" className={inputClass()} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                    {startDate > endDate && <span className="text-sm" style={{ color: "var(--of-fg-danger)" }}>Start must be before end</span>}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={badgeClass({ variant: STATUS_VARIANT[plan.status] })}>{plan.status}</span>
                    <div className="min-w-0">
                      <p className="font-medium truncate">{plan.name}</p>
                      <p className="text-sm truncate" style={{ color: "var(--of-fg-muted)" }}>
                        {plan.startDate} → {plan.endDate}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-2 shrink-0">
                  {isEditing ? (
                    <>
                      <button className={buttonClass({ variant: "primary", size: "sm" })} disabled={update.isPending || !name.trim() || startDate > endDate} onClick={saveEdit}>
                        {update.isPending ? "Saving…" : "Save"}
                      </button>
                      <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      {onSelectPlan && (
                        <button className={buttonClass({ variant: "secondary", size: "sm" })} disabled={isCurrent} onClick={() => onSelectPlan(plan.id)}>
                          <Eye size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" /> {isCurrent ? "Viewing" : "View"}
                        </button>
                      )}
                      {plan.status === "archived" && (
                        <button
                          className={buttonClass({ variant: "secondary", size: "sm" })}
                          disabled={update.isPending}
                          onClick={() => update.mutate({ id: plan.id, status: "active" })}
                        >
                          <ArchiveRestore size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" /> Restore
                        </button>
                      )}
                      <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => startEdit(plan)}>
                        <Pencil size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" /> Edit
                      </button>
                      <button
                        className={buttonClass({ variant: "danger", size: "sm" })}
                        disabled={del.isPending}
                        onClick={() => {
                          if (window.confirm(`Delete "${plan.name}"? This removes all its slots and calendar occurrences too — it can't be undone.`)) {
                            del.mutate(plan.id);
                          }
                        }}
                      >
                        <Trash2 size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" /> Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
