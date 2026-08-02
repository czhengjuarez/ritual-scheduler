import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { buttonClass, inputClass, labelClass, textareaClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { usePublishPlan } from "../hooks/useCadences";
import type { PublishPreview } from "../hooks/useCadences";

/**
 * Two steps, not one call: publishing publicly can strip private rituals
 * (PLAN.md §5.3 — "a review step showing exactly what gets stripped before
 * it leaves your team"). The first call is always a dry run; nothing is
 * written until the user has seen precisely what would leave the team and
 * confirms.
 */
export function PublishModal({ planId, planName, onClose }: { planId: string; planName: string; onClose: () => void }) {
  const [visibility, setVisibility] = useState<"team" | "public">("team");
  const [name, setName] = useState(planName);
  const [summary, setSummary] = useState("");
  const [preview, setPreview] = useState<PublishPreview | null>(null);
  const [done, setDone] = useState(false);
  const publish = usePublishPlan(planId);

  const runPreview = () => {
    publish.mutate(
      { visibility, name: name.trim(), summary: summary.trim(), dryRun: true },
      { onSuccess: (result) => "preview" in result && setPreview(result.preview) },
    );
  };

  const confirmPublish = () => {
    publish.mutate({ visibility, name: name.trim(), summary: summary.trim(), dryRun: false }, { onSuccess: () => setDone(true) });
  };

  if (done) {
    return (
      <Modal title="Published" onClose={onClose} footer={<button className={buttonClass({ variant: "primary" })} onClick={onClose}>Done</button>}>
        <p style={{ color: "var(--of-fg-muted)" }}>
          {visibility === "public"
            ? "Sent for review — it'll show up in the public gallery once an admin approves it."
            : "Your team can now clone this cadence from the gallery."}
        </p>
      </Modal>
    );
  }

  if (preview) {
    return (
      <Modal
        title="Review before publishing"
        onClose={onClose}
        footer={
          <>
            <button className={buttonClass({ variant: "secondary" })} onClick={() => setPreview(null)}>
              Back
            </button>
            <button className={buttonClass({ variant: "primary" })} onClick={confirmPublish} disabled={publish.isPending}>
              {publish.isPending ? "Publishing…" : `Publish ${visibility === "public" ? "publicly" : "to your team"}`}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p style={{ color: "var(--of-fg-muted)" }}>
            {preview.definition.slots.length} slot(s), {preview.definition.standalone.length} standalone ritual(s), {preview.durationWeeks}{" "}
            weeks. Dates, names, and people are always stripped — a template is a pattern, not your specific plan.
          </p>
          {preview.stripped.length > 0 && (
            <div className="flex flex-col gap-2 p-3 rounded-md" style={{ background: "var(--of-bg-warning-tint)" }}>
              <div className="flex items-center gap-2 text-sm font-medium" style={{ color: "var(--of-fg-warning)" }}>
                <AlertTriangle size={20} strokeWidth={1.75} className="!w-4 !h-4" />
                {preview.stripped.length} private ritual(s) will be removed
              </div>
              <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
                These aren't visible outside your team, so they're replaced with a plain label instead of leaving the
                public template broken:
              </p>
              <ul className="text-sm list-disc pl-5">
                {preview.stripped.map((s) => (
                  <li key={s.slug}>{s.title}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title="Publish this cadence"
      onClose={onClose}
      footer={
        <button className={buttonClass({ variant: "primary" })} onClick={runPreview} disabled={!name.trim() || publish.isPending}>
          {publish.isPending ? "Checking…" : "Review"}
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex gap-2">
          <button
            className={buttonClass({ variant: visibility === "team" ? "primary" : "secondary", size: "sm" })}
            onClick={() => setVisibility("team")}
          >
            Team only
          </button>
          <button
            className={buttonClass({ variant: visibility === "public" ? "primary" : "secondary", size: "sm" })}
            onClick={() => setVisibility("public")}
          >
            Public gallery
          </button>
        </div>
        <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
          {visibility === "team"
            ? "Instantly available to your team, never queued for approval."
            : "Reviewed by an admin before it appears in the public gallery."}
        </p>
        <div>
          <label className={labelClass()}>Cadence name</label>
          <input className={inputClass({ className: "w-full" })} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass()}>Summary</label>
          <textarea className={textareaClass({ className: "w-full" })} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What's this cadence for?" />
        </div>
      </div>
    </Modal>
  );
}
