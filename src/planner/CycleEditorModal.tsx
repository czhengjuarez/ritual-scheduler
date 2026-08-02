import { useState } from "react";
import { Plus, Trash2, Repeat } from "lucide-react";
import { buttonClass, inputClass, labelClass, selectClass, cardClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { RitualComboInput } from "./RitualComboInput";
import { useCreateSlot, useUpdateSlot } from "../hooks/usePlanner";
import { CADENCE_PRESETS, CUSTOM_PRESET_KEY, matchPreset } from "../lib/cadence";
import type { RitualDto } from "../hooks/useLibrary";
import type { SlotDto } from "../hooks/usePlanner";

interface Position {
  ritualId: number | null;
  label: string | null; // freeform title when there's no ritualId
  title: string; // what the input displays, regardless of source
}

/**
 * Creates or edits a slot with N rotation positions. This is "the anchor use
 * case" from PLAN.md §1.3 made concrete: one weekly slot, N rituals rotating
 * through it — a single-position slot (cycleLength 1) is just the plain
 * recurring case, not a special mode.
 *
 * Each position is typed directly into a RitualComboInput — the library is
 * a suggestion dropdown underneath, not a gate. Picking a suggestion (or
 * using its "browse library" button) attaches a real ritualId; otherwise
 * whatever's typed schedules as a plain label, no library entry required.
 *
 * Passing `existingSlot` switches this from create to edit mode: fields
 * pre-fill from it and submit goes through `useUpdateSlot` instead of
 * `useCreateSlot`. Cadence is a preset (Weekly/Monthly × interval) rather
 * than a raw freq dropdown — quarterly/annual are just monthly presets, and
 * "Custom…" falls back to raw base-unit + interval inputs for anything else.
 */
export function CycleEditorModal({ planId, existingSlot, onClose }: { planId: string; existingSlot?: SlotDto; onClose: () => void }) {
  const isEditing = !!existingSlot;
  const [name, setName] = useState(existingSlot?.name ?? "");
  const [anchorDate, setAnchorDate] = useState(existingSlot?.anchorDate ?? "");
  const [durationMin, setDurationMin] = useState(existingSlot?.durationMin ?? 60);
  const [positions, setPositions] = useState<Position[]>(
    existingSlot?.rotation.length
      ? existingSlot.rotation.map((r) => ({ ritualId: r.ritualId, label: r.label, title: r.ritual?.title ?? r.label ?? "" }))
      : [{ ritualId: null, label: null, title: "" }],
  );

  const initialPreset = existingSlot ? matchPreset(existingSlot.freq, existingSlot.interval) : matchPreset("weekly", 1);
  const [presetKey, setPresetKey] = useState<string>(initialPreset?.key ?? CUSTOM_PRESET_KEY);
  const [customBase, setCustomBase] = useState<"weekly" | "monthly">(existingSlot?.freq === "monthly" ? "monthly" : "weekly");
  const [customInterval, setCustomInterval] = useState(existingSlot?.interval ?? 1);

  const createSlot = useCreateSlot(planId);
  const updateSlot = useUpdateSlot(planId);
  const pending = createSlot.isPending || updateSlot.isPending;

  const preset = CADENCE_PRESETS.find((p) => p.key === presetKey);
  const freq = preset?.freq ?? customBase;
  const interval = preset?.interval ?? Math.max(1, customInterval);

  const updatePosition = (index: number, title: string, ritual: RitualDto | null) => {
    setPositions((prev) =>
      prev.map((p, i) => (i === index ? { ritualId: ritual?.id ?? null, label: ritual ? null : title.trim() || null, title } : p)),
    );
  };

  const canSubmit = name.trim() && anchorDate && positions.length > 0;

  const submit = () => {
    if (!canSubmit) return;
    const payload = {
      name: name.trim(),
      anchorDate,
      freq,
      interval,
      durationMin,
      rotation: positions.map((p, i) => ({ position: i, ritualId: p.ritualId, label: p.label })),
    };
    if (existingSlot) {
      updateSlot.mutate({ slotId: existingSlot.id, ...payload }, { onSuccess: onClose });
    } else {
      createSlot.mutate(payload, { onSuccess: onClose });
    }
  };

  return (
    <Modal
        title={isEditing ? "Edit slot" : "Add a slot"}
        onClose={onClose}
        wide
        footer={
          <>
            <button className={buttonClass({ variant: "secondary" })} onClick={onClose}>
              Cancel
            </button>
            <button className={buttonClass({ variant: "primary" })} disabled={!canSubmit || pending} onClick={submit}>
              {pending ? "Saving…" : isEditing ? "Save changes" : "Create slot"}
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
              <select className={selectClass({ className: "w-full" })} value={presetKey} onChange={(e) => setPresetKey(e.target.value)}>
                {CADENCE_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
                <option value={CUSTOM_PRESET_KEY}>Custom…</option>
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

          {presetKey === CUSTOM_PRESET_KEY && (
            <div className="flex items-center gap-2">
              <span className="text-sm">Every</span>
              <input
                type="number"
                min={1}
                className={inputClass({ className: "w-20" })}
                value={customInterval}
                onChange={(e) => setCustomInterval(Math.max(1, Number(e.target.value)))}
              />
              <select className={selectClass()} value={customBase} onChange={(e) => setCustomBase(e.target.value as "weekly" | "monthly")}>
                <option value="weekly">week(s)</option>
                <option value="monthly">month(s)</option>
              </select>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className={labelClass()}>
                Rotation ({positions.length === 1 ? "single ritual, no rotation" : `cycles through ${positions.length} rituals`})
              </label>
              <button
                className={buttonClass({ variant: "ghost", size: "sm" })}
                onClick={() => setPositions((prev) => [...prev, { ritualId: null, label: null, title: "" }])}
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
                  <RitualComboInput title={pos.title} onChange={(title, ritual) => updatePosition(i, title, ritual)} placeholder="Type a ritual name, or pick from the library…" />
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
  );
}
