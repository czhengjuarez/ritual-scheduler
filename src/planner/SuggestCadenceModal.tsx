import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Repeat, CalendarRange, X, Pencil } from "lucide-react";
import { buttonClass, badgeClass, inputClass, labelClass, cardClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { useJobs } from "../hooks/useLibrary";
import { useSuggestCadence, useAcceptSuggestion, type SuggestCadenceResult } from "../hooks/useAi";
import { RitualPickerModal } from "./RitualPickerModal";
import { WEEKDAY_LABELS } from "../lib/calendar";
import type { CadenceDefinition } from "../../db/schema";
import type { RitualDto } from "../hooks/useLibrary";

type SwapTarget = { kind: "slot"; slotIndex: number; posIndex: number } | { kind: "standalone"; index: number };

function offsetLabel(dayOffset: number): string {
  const week = Math.floor(dayOffset / 7) + 1;
  const dayInWeek = (dayOffset % 7) + 1;
  return `Week ${week}, day ${dayInWeek}`;
}

/**
 * "Design my quarter" (PLAN.md §5.6 #2) — seeded from the same jobs/team
 * size/work mode already selected on the Cadences gallery (or CreatePlanForm),
 * so this isn't a second intake form, just a different button next to one
 * that already has these fields. Two steps: generate (an AI call that can
 * take up to a minute), then review a diff before accepting — nothing lands
 * in a real plan without that. Every item in the review is also swappable
 * (click it to reopen the ritual picker), not just removable — the AI only
 * proposes from existing library rituals, so if none of them fit, the escape
 * hatch is the same "leave unassigned" / "create a new ritual" the picker
 * already offers everywhere else, not just delete-and-live-without-it.
 */
export function SuggestCadenceModal({
  initialJobs,
  teamSize,
  workMode,
  horizonWeeks: initialHorizon,
  onClose,
  onDone,
}: {
  initialJobs: string[];
  teamSize?: string;
  workMode?: string;
  horizonWeeks?: number;
  onClose: () => void;
  /** Called (in addition to navigating to /plan) once the suggested plan is actually created — see CreatePlanForm's onDone for why this matters when we're already on /plan. */
  onDone?: (planId?: string) => void;
}) {
  const [horizonWeeks, setHorizonWeeks] = useState(initialHorizon ?? 12);
  const [currentLoad, setCurrentLoad] = useState("");
  const [result, setResult] = useState<SuggestCadenceResult | null>(null);
  const [definition, setDefinition] = useState<CadenceDefinition | null>(null);
  const [name, setName] = useState("AI-suggested plan");
  const [startDate, setStartDate] = useState("");
  const [swapTarget, setSwapTarget] = useState<SwapTarget | null>(null);
  const [extraTitles, setExtraTitles] = useState<Map<string, string>>(new Map());

  const { data: jobsData } = useJobs();
  const suggest = useSuggestCadence();
  const accept = useAcceptSuggestion();
  const navigate = useNavigate();

  const jobNames = (jobsData?.items ?? []).filter((j) => initialJobs.includes(j.slug)).map((j) => j.name);
  const titleBySlug = new Map([...(result?.candidates ?? []).map((c): [string, string] => [c.slug, c.title]), ...extraTitles]);
  const ritualLabel = (slug: string | null) => (slug ? (titleBySlug.get(slug) ?? slug) : "Unassigned");

  const applySwap = (ritual: RitualDto | null) => {
    if (!swapTarget) return;
    if (ritual) setExtraTitles((prev) => new Map(prev).set(ritual.slug, ritual.title));
    setDefinition((d) => {
      if (!d) return d;
      if (swapTarget.kind === "slot") {
        const slots = d.slots.map((slot, i) =>
          i !== swapTarget.slotIndex
            ? slot
            : { ...slot, rotation: slot.rotation.map((r, j) => (j !== swapTarget.posIndex ? r : { ...r, ritualSlug: ritual?.slug ?? null, label: null })) },
        );
        return { ...d, slots };
      }
      const standalone = d.standalone.map((s, i) => (i !== swapTarget.index ? s : { ...s, ritualSlug: ritual?.slug ?? null, titleOverride: null }));
      return { ...d, standalone };
    });
    setSwapTarget(null);
  };

  const generate = () => {
    const teamSizeNum = teamSize ? Number(teamSize) : undefined;
    suggest.mutate(
      {
        jobSlugs: initialJobs,
        teamSizeMin: teamSizeNum,
        teamSizeMax: teamSizeNum,
        workMode: workMode as "remote" | "hybrid" | "in-person" | undefined,
        currentLoad: currentLoad.trim() || undefined,
        horizonWeeks,
      },
      { onSuccess: (r) => { setResult(r); setDefinition(r.definition); } },
    );
  };

  const removeSlot = (i: number) => setDefinition((d) => d && { ...d, slots: d.slots.filter((_, j) => j !== i) });
  const removeStandalone = (i: number) => setDefinition((d) => d && { ...d, standalone: d.standalone.filter((_, j) => j !== i) });

  const submitAccept = () => {
    if (!result || !definition || !startDate) return;
    accept.mutate(
      { runId: result.runId, definition, startDate, durationWeeks: result.durationWeeks, name: name.trim() || undefined },
      { onSuccess: (r) => { onDone?.(r.item.id); navigate("/plan"); } },
    );
  };

  return (
    <Modal title="Design my quarter" onClose={onClose} wide>
      {!result ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm" style={{ background: "var(--of-bg-brand-tint)", borderColor: "color-mix(in srgb, var(--of-magenta-400) 30%, transparent)", color: "var(--of-fg-brand)" }}>
            <Sparkles size={16} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span>
              AI proposes a cadence built only from real rituals in the library, matched to your jobs. You'll review
              and can prune it before anything is created.
            </span>
          </div>

          <div>
            <label className={labelClass()}>Jobs</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {jobNames.length ? jobNames.map((n) => <span key={n} className={badgeClass({ variant: "default" })}>{n}</span>) : <span className="text-sm" style={{ color: "var(--of-fg-subtle)" }}>None selected — pick at least one job above first.</span>}
            </div>
          </div>

          <div>
            <label className={labelClass()}>Plan horizon (weeks)</label>
            <input type="number" min={1} max={52} className={inputClass({ className: "w-full" })} value={horizonWeeks} onChange={(e) => setHorizonWeeks(Number(e.target.value))} />
          </div>

          <div>
            <label className={labelClass()}>Current meeting load (optional)</label>
            <input
              className={inputClass({ className: "w-full" })}
              value={currentLoad}
              onChange={(e) => setCurrentLoad(e.target.value)}
              placeholder="e.g. already have a daily standup and monthly all-hands"
            />
          </div>

          {suggest.isError && <p style={{ color: "var(--of-fg-danger)" }}>{suggest.error instanceof Error ? suggest.error.message : "Something went wrong."}</p>}

          <button className={buttonClass({ variant: "primary" })} disabled={initialJobs.length === 0 || suggest.isPending} onClick={generate}>
            {suggest.isPending ? "Designing… this can take up to a minute" : "Generate cadence"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
            Remove anything you don't want, then pick a start date to create the plan.
          </p>

          {definition?.slots.map((slot, i) => (
            <div key={i} className={cardClass({ className: "p-3" })}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Repeat size={20} strokeWidth={1.75} className="!w-4 !h-4" />
                  {slot.name} — {WEEKDAY_LABELS[slot.byweekday]}s, {slot.freq}
                </div>
                <button onClick={() => removeSlot(i)} className={buttonClass({ variant: "ghost", size: "sm" })} style={{ padding: "0 4px" }} title="Remove this slot">
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                {slot.rotation.map((r, j) => (
                  <button
                    key={j}
                    className={badgeClass({ variant: "default" })}
                    style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                    title="Change what fills this position"
                    onClick={() => setSwapTarget({ kind: "slot", slotIndex: i, posIndex: j })}
                  >
                    {ritualLabel(r.ritualSlug)}
                    <Pencil size={16} strokeWidth={1.75} className="!w-3 !h-3" style={{ opacity: 0.6 }} />
                  </button>
                ))}
              </div>
            </div>
          ))}

          {definition && definition.standalone.length > 0 && (
            <div className={cardClass({ className: "p-3 flex flex-col gap-1.5" })}>
              <div className="flex items-center gap-2 text-sm font-medium mb-1">
                <CalendarRange size={20} strokeWidth={1.75} className="!w-4 !h-4" />
                Standalone rituals
              </div>
              {definition.standalone.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <button
                    className="text-left underline decoration-dotted"
                    title="Change what this is"
                    onClick={() => setSwapTarget({ kind: "standalone", index: i })}
                  >
                    {ritualLabel(s.ritualSlug)}
                  </button>
                  <span className="flex items-center gap-2" style={{ color: "var(--of-fg-subtle)" }}>
                    {offsetLabel(s.dayOffset)}
                    {s.spanWeeks ? ` (${s.spanWeeks}-week span)` : ""}
                    <button onClick={() => removeStandalone(i)} className={buttonClass({ variant: "ghost", size: "sm" })} style={{ padding: "0 4px" }} title="Remove">
                      <X size={16} strokeWidth={1.75} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {definition && definition.slots.length === 0 && definition.standalone.length === 0 && (
            <p style={{ color: "var(--of-fg-muted)" }}>Everything's been removed — nothing left to create.</p>
          )}

          <div className="border-t pt-4 flex flex-col gap-3" style={{ borderColor: "var(--of-border-line)" }}>
            <div>
              <label className={labelClass()}>Plan name</label>
              <input className={inputClass({ className: "w-full" })} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className={labelClass()}>Start date</label>
              <input type="date" className={inputClass({ className: "w-full" })} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            {accept.isError && <p style={{ color: "var(--of-fg-danger)" }}>{accept.error instanceof Error ? accept.error.message : "Something went wrong."}</p>}
            <button
              className={buttonClass({ variant: "primary" })}
              disabled={!startDate || accept.isPending || !definition || (definition.slots.length === 0 && definition.standalone.length === 0)}
              onClick={submitAccept}
            >
              {accept.isPending ? "Creating…" : "Create this plan"}
            </button>
          </div>
        </div>
      )}

      {swapTarget && <RitualPickerModal onSelect={applySwap} onClose={() => setSwapTarget(null)} />}
    </Modal>
  );
}
