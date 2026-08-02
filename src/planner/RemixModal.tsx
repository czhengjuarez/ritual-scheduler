import { useState } from "react";
import { Sparkles } from "lucide-react";
import { buttonClass, inputClass, labelClass, textareaClass, selectClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { useRemixRitual, useSaveRemix, type RemixDraft } from "../hooks/useAi";
import type { RitualDto } from "../hooks/useLibrary";

/**
 * "Adapt a ritual to context... saved as a team-visibility ritual derived
 * from the original" (PLAN.md §5.6 #4). Lands as a team ritual immediately
 * on save, same as any other team-authored ritual (PLAN.md §5.4) — no
 * separate approval step, since it's never public until someone explicitly
 * requests that (the existing "Publish publicly" path on RitualCard).
 */
export function RemixModal({ ritual, onClose }: { ritual: RitualDto; onClose: () => void }) {
  const [context, setContext] = useState("");
  const [draft, setDraft] = useState<RemixDraft | null>(null);
  const [runId, setRunId] = useState<number | null>(null);

  const remix = useRemixRitual();
  const save = useSaveRemix();

  const generate = () => {
    if (!context.trim()) return;
    remix.mutate(
      { ritualId: ritual.id, context: context.trim() },
      { onSuccess: (r) => { setDraft(r.draft); setRunId(r.runId); } },
    );
  };

  const submitSave = () => {
    if (!runId || !draft) return;
    save.mutate({ runId, ...draft }, { onSuccess: onClose });
  };

  return (
    <Modal title={`Remix "${ritual.title}"`} onClose={onClose} wide>
      {!draft ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
            Describe the context you need this for — team size, work mode, time budget, anything that's different
            from the original. AI adapts the ritual; you review before it's saved.
          </p>
          <div>
            <label className={labelClass()}>New context</label>
            <input
              className={inputClass({ className: "w-full" })}
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. 6 people, remote, 30 minutes"
              autoFocus
            />
          </div>
          {remix.isError && <p style={{ color: "var(--of-fg-danger)" }}>{remix.error instanceof Error ? remix.error.message : "Something went wrong."}</p>}
          <button className={buttonClass({ variant: "primary" })} disabled={!context.trim() || remix.isPending} onClick={generate}>
            <Sparkles size={16} strokeWidth={1.75} /> {remix.isPending ? "Adapting…" : "Adapt this ritual"}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass()}>Title</label>
            <input className={inputClass({ className: "w-full" })} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div>
            <label className={labelClass()}>Summary</label>
            <textarea className={textareaClass({ className: "w-full" })} rows={2} value={draft.summary ?? ""} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} />
          </div>
          <div>
            <label className={labelClass()}>Purpose</label>
            <textarea className={textareaClass({ className: "w-full" })} rows={2} value={draft.purpose ?? ""} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass()}>Duration (min)</label>
              <input type="number" className={inputClass({ className: "w-full" })} value={draft.durationMin ?? ""} onChange={(e) => setDraft({ ...draft, durationMin: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <label className={labelClass()}>Min size</label>
              <input type="number" className={inputClass({ className: "w-full" })} value={draft.sizeMin ?? ""} onChange={(e) => setDraft({ ...draft, sizeMin: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div>
              <label className={labelClass()}>Max size</label>
              <input type="number" className={inputClass({ className: "w-full" })} value={draft.sizeMax ?? ""} onChange={(e) => setDraft({ ...draft, sizeMax: e.target.value ? Number(e.target.value) : null })} />
            </div>
          </div>
          <div>
            <label className={labelClass()}>Format</label>
            <select className={selectClass({ className: "w-full" })} value={draft.format ?? ""} onChange={(e) => setDraft({ ...draft, format: (e.target.value || null) as RemixDraft["format"] })}>
              <option value="">Unspecified</option>
              <option value="sync">Sync</option>
              <option value="async">Async</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className={labelClass()}>Prep notes</label>
            <textarea className={textareaClass({ className: "w-full" })} rows={3} value={draft.prepNotes ?? ""} onChange={(e) => setDraft({ ...draft, prepNotes: e.target.value })} />
          </div>

          {save.isError && <p style={{ color: "var(--of-fg-danger)" }}>{save.error instanceof Error ? save.error.message : "Something went wrong."}</p>}
          <button className={buttonClass({ variant: "primary" })} disabled={!draft.title.trim() || save.isPending} onClick={submitSave}>
            {save.isPending ? "Saving…" : "Save as a new team ritual"}
          </button>
        </div>
      )}
    </Modal>
  );
}
