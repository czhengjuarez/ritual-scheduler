import { useState } from "react";
import { Plus, Trash2, Repeat } from "lucide-react";
import { buttonClass, inputClass, labelClass, selectClass, cardClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { RitualPickerModal } from "./RitualPickerModal";
import { useCreateSlot } from "../hooks/usePlanner";
import type { RitualDto } from "../hooks/useLibrary";

interface Position {
  ritualId: number | null;
  title: string; // display only
}

/**
 * Creates a slot with N rotation positions. This is "the anchor use case"
 * from PLAN.md §1.3 made concrete: one weekly slot, N rituals rotating
 * through it — a single-position slot (cycleLength 1) is just the plain
 * recurring case, not a special mode.
 */
export function CycleEditorModal({ planId, onClose }: { planId: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [anchorDate, setAnchorDate] = useState("");
  const [freq, setFreq] = useState<"weekly" | "biweekly" | "monthly">("weekly");
  const [durationMin, setDurationMin] = useState(60);
  const [positions, setPositions] = useState<Position[]>([{ ritualId: null, title: "" }]);
  const [pickerIndex, setPickerIndex] = useState<number | null>(null);

  const createSlot = useCreateSlot(planId);

  const setPositionRitual = (index: number, ritual: RitualDto | null) => {
    setPositions((prev) => prev.map((p, i) => (i === index ? { ritualId: ritual?.id ?? null, title: ritual?.title ?? "" } : p)));
    setPickerIndex(null);
  };

  const canSubmit = name.trim() && anchorDate && positions.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    createSlot.mutate(
      {
        name: name.trim(),
        anchorDate,
        freq,
        durationMin,
        rotation: positions.map((p, i) => ({ position: i, ritualId: p.ritualId })),
      },
      { onSuccess: onClose },
    );
  };

  return (
    <>
      <Modal
        title="Add a slot"
        onClose={onClose}
        wide
        footer={
          <>
            <button className={buttonClass({ variant: "secondary" })} onClick={onClose}>
              Cancel
            </button>
            <button className={buttonClass({ variant: "primary" })} disabled={!canSubmit || createSlot.isPending} onClick={submit}>
              {createSlot.isPending ? "Creating…" : "Create slot"}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass()}>Slot name</label>
            <input className={inputClass({ className: "w-full" })} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Weekly Design Meeting" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass()}>First occurrence</label>
              <input type="date" className={inputClass({ className: "w-full" })} value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
            </div>
            <div>
              <label className={labelClass()}>Repeats</label>
              <select className={selectClass({ className: "w-full" })} value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)}>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className={labelClass()}>Duration (min)</label>
              <input
                type="number"
                min={0}
                className={inputClass({ className: "w-full" })}
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass()}>
                Rotation ({positions.length === 1 ? "single ritual, no rotation" : `cycles through ${positions.length} rituals`})
              </label>
              <button
                className={buttonClass({ variant: "ghost", size: "sm" })}
                onClick={() => setPositions((prev) => [...prev, { ritualId: null, title: "" }])}
              >
                <Plus size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Add position
              </button>
            </div>

            <div className="flex flex-col gap-2">
              {positions.map((pos, i) => (
                <div key={i} className={cardClass({ className: "flex items-center gap-3 p-3" })}>
                  <span
                    className="flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold shrink-0"
                    style={{ background: "var(--of-bg-brand-subtle)", color: "var(--of-fg-brand)" }}
                  >
                    {i + 1}
                  </span>
                  <button className="flex-1 text-left text-sm" onClick={() => setPickerIndex(i)} style={{ color: pos.title ? "var(--of-fg-default)" : "var(--of-fg-subtle)" }}>
                    {pos.title || "Choose a ritual…"}
                  </button>
                  {positions.length > 1 && (
                    <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setPositions((prev) => prev.filter((_, idx) => idx !== i))}>
                      <Trash2 size={20} strokeWidth={1.75} className="!w-4 !h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {positions.length > 1 && (
              <p className="mt-2 text-xs flex items-center gap-1.5" style={{ color: "var(--of-fg-subtle)" }}>
                <Repeat size={20} strokeWidth={1.75} className="!w-3.5 !h-3.5" />
                Week 1 is position 1, week 2 is position 2, and so on — repeating from position 1 again after {positions.length}.
              </p>
            )}
          </div>
        </div>
      </Modal>

      {pickerIndex !== null && <RitualPickerModal onSelect={(r) => setPositionRitual(pickerIndex, r)} onClose={() => setPickerIndex(null)} />}
    </>
  );
}
