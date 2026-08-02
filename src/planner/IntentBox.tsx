import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { buttonClass, cardClass, inputClass, labelClass } from "@ops-forward/keel";
import { useConverseIntent, useAcceptSuggestion, type ConverseMessage, type SuggestCadenceResult } from "../hooks/useAi";
import { TEAM_RITUAL_AUDIT_URL } from "../config/suite";

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The AI-native front door (PLAN.md §5.2, revised 2026-08-02) — a real
 * conversational builder, not a one-shot classifier that links off to a
 * gallery. It asks for whatever's still missing (a job, a team size) one
 * question at a time, then proposes a cadence and builds it straight onto
 * the calendar on confirmation — the same generate → review → accept
 * pipeline as "Design my quarter" (SuggestCadenceModal), just reached by
 * talking instead of filling in a form. Genuinely unrelated asks (go to an
 * existing calendar, browse the ritual library, open the audit, start
 * completely blank) still route immediately instead of being dragged into
 * a conversation they don't need.
 */
export function IntentBox({
  onDone,
  onWantsPlan,
  calendarFallbackNote = "You don't have a plan yet — start one below.",
}: {
  onDone?: () => void;
  onWantsPlan: () => void;
  /** Shown for a "calendar" route when there's nothing to hand off to (no onDone) — differs depending on whether that's because there's no plan yet, or because the calendar is already what's on screen. */
  calendarFallbackNote?: string;
}) {
  const [messages, setMessages] = useState<ConverseMessage[]>([]);
  const [input, setInput] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const converse = useConverseIntent();
  const accept = useAcceptSuggestion();
  const navigate = useNavigate();

  // Persisted across turns — not derived from converse.data, which only
  // reflects the *last* call's result. This is the actual structure sent
  // back as `currentProposal` on every subsequent turn, so a plain
  // "remove X"/"confirm" reply can be applied as a patch to the real prior
  // proposal server-side instead of the model reconstructing it from the
  // chat transcript (see worker/ai.ts's currentProposal branch).
  const [proposal, setProposal] = useState<SuggestCadenceResult | undefined>(undefined);
  const suggestion = proposal;
  const [startDate, setStartDate] = useState(todayISO);
  const [planName, setPlanName] = useState("AI-suggested plan");

  const send = () => {
    const content = input.trim();
    if (!content || converse.isPending) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setNote(null);
    converse.mutate(
      { messages: next, currentProposal: proposal },
      {
        onSuccess: (result) => {
          setMessages((m) => [...m, { role: "assistant", content: result.message }]);
          if (result.suggestion) setProposal(result.suggestion);
          if (result.action !== "route") return;
          switch (result.destination) {
            case "plan":
              onWantsPlan();
              break;
            case "ritual":
              navigate("/library");
              break;
            case "calendar":
              if (onDone) onDone();
              else setNote(calendarFallbackNote);
              break;
            case "audit":
              window.open(TEAM_RITUAL_AUDIT_URL, "_blank", "noopener,noreferrer");
              break;
          }
        },
      },
    );
  };

  const buildIt = () => {
    if (!suggestion || !startDate) return;
    accept.mutate(
      { runId: suggestion.runId, definition: suggestion.definition, startDate, durationWeeks: suggestion.durationWeeks, name: planName.trim() || undefined },
      { onSuccess: () => navigate("/plan") },
    );
  };

  const titleBySlug = new Map((suggestion?.candidates ?? []).map((c) => [c.slug, c.title]));
  const ritualLabel = (slug: string | null) => (slug ? (titleBySlug.get(slug) ?? slug) : "Unassigned");

  return (
    <div className="flex flex-col gap-3">
      {messages.length > 0 && (
        <div className="flex flex-col gap-2 max-h-72 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <div
              key={i}
              className="text-sm px-3 py-2 rounded-lg max-w-[85%]"
              style={
                m.role === "user"
                  ? { alignSelf: "flex-end", background: "var(--of-bg-brand-tint)", color: "var(--of-fg-brand)" }
                  : { alignSelf: "flex-start", background: "var(--of-bg-recessed)", color: "var(--of-fg-default)" }
              }
            >
              {m.content}
            </div>
          ))}
          {converse.isPending && (
            <div className="text-sm px-3 py-2 rounded-lg" style={{ alignSelf: "flex-start", background: "var(--of-bg-recessed)", color: "var(--of-fg-muted)" }}>
              Thinking…
            </div>
          )}
        </div>
      )}

      {suggestion && (
        <div className={cardClass({ className: "p-4 flex flex-col gap-3" })}>
          <div className="flex flex-col gap-1.5 text-sm">
            {suggestion.definition.slots.map((slot, i) => (
              <div key={i}>
                <span className="font-medium">{slot.name}</span> — {slot.freq}: {slot.rotation.map((r) => ritualLabel(r.ritualSlug)).join(" → ")}
              </div>
            ))}
            {suggestion.definition.standalone.map((s, i) => (
              <div key={i}>{ritualLabel(s.ritualSlug)} (one-off)</div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass()}>Plan name</label>
              <input className={inputClass({ className: "w-full" })} value={planName} onChange={(e) => setPlanName(e.target.value)} />
            </div>
            <div>
              <label className={labelClass()}>Start date</label>
              <input type="date" className={inputClass({ className: "w-full" })} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
          </div>
          {accept.isError && (
            <p className="text-sm" style={{ color: "var(--of-fg-danger)" }}>
              {accept.error instanceof Error ? accept.error.message : "Something went wrong."}
            </p>
          )}
          <button className={buttonClass({ variant: "primary" })} disabled={!startDate || accept.isPending} onClick={buildIt}>
            {accept.isPending ? "Building…" : "Build it on my calendar"}
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          className={inputClass({ className: "w-full" })}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder={messages.length === 0 ? 'e.g. "design a cadence for a remote design team of 8"' : "Reply…"}
          disabled={converse.isPending}
        />
        <button className={buttonClass({ variant: "primary" })} onClick={send} disabled={!input.trim() || converse.isPending}>
          {converse.isPending ? (
            "Thinking…"
          ) : (
            <>
              Send <ArrowRight size={20} strokeWidth={1.75} className="!w-4 !h-4" />
            </>
          )}
        </button>
      </div>
      {converse.isError && (
        <p className="text-sm" style={{ color: "var(--of-fg-danger)" }}>
          Something went wrong — try again.
        </p>
      )}
      {note && (
        <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
          {note}
        </p>
      )}
    </div>
  );
}
