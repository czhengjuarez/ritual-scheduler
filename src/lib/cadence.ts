/**
 * Cadence is expressed as `{freq: "weekly"|"monthly", interval}` — quarterly
 * and annual are just monthly with interval 3 or 12, not separate freq
 * values (worker/schedule.ts steps by `interval` weeks/months). This maps
 * that pair to/from a friendly preset list for the slot editor, and to a
 * human-readable summary for the slots list — kept out of worker/schedule.ts
 * since that module is server-only generation math, not display formatting.
 */

export interface CadencePreset {
  key: string;
  label: string;
  freq: "weekly" | "monthly";
  interval: number;
}

export const CADENCE_PRESETS: CadencePreset[] = [
  { key: "weekly", label: "Weekly", freq: "weekly", interval: 1 },
  { key: "every-2-weeks", label: "Every 2 weeks", freq: "weekly", interval: 2 },
  { key: "every-3-weeks", label: "Every 3 weeks", freq: "weekly", interval: 3 },
  { key: "every-4-weeks", label: "Every 4 weeks", freq: "weekly", interval: 4 },
  { key: "monthly", label: "Monthly", freq: "monthly", interval: 1 },
  { key: "quarterly", label: "Quarterly", freq: "monthly", interval: 3 },
  { key: "annual", label: "Annual", freq: "monthly", interval: 12 },
];

export const CUSTOM_PRESET_KEY = "custom";

/** Legacy `freq: "biweekly"` rows (predating the interval column) are treated as weekly+2 for matching. */
export function matchPreset(freq: string, interval: number): CadencePreset | null {
  const normFreq = freq === "biweekly" ? "weekly" : freq;
  const normInterval = freq === "biweekly" ? 2 : interval;
  return CADENCE_PRESETS.find((p) => p.freq === normFreq && p.interval === normInterval) ?? null;
}

const WEEKDAY_NAMES = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];

export function describeCadence(slot: { freq: string; interval: number; byweekday: number; cycleLength: number }): string {
  const preset = matchPreset(slot.freq, slot.interval);
  const base = slot.freq === "biweekly" || slot.freq === "monthly" ? "months" : "weeks";
  const cadencePart = preset ? preset.label : `Every ${slot.freq === "biweekly" ? 2 : slot.interval} ${base}`;
  const rotationPart = slot.cycleLength > 1 ? ` · ${slot.cycleLength}-part rotation` : "";
  return `${cadencePart} · ${WEEKDAY_NAMES[slot.byweekday]}${rotationPart}`;
}
