import { useState } from "react";
import { Copy, Check, RefreshCw, CalendarPlus } from "lucide-react";
import { buttonClass, inputClass } from "@ops-forward/keel";
import { useRotateIcsToken } from "../hooks/usePlanner";
import type { PlanDto } from "../hooks/usePlanner";

/** The subscribe feed — PLAN.md §5.7: "cheapest possible integration and probably the most-used feature." */
export function SubscribePanel({ plan }: { plan: PlanDto }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const rotate = useRotateIcsToken(plan.id);

  if (!plan.icsToken) return null;
  const url = `${window.location.origin}/ics/${plan.icsToken}.ics`;

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative">
      <button className={buttonClass({ variant: "secondary", size: "sm" })} onClick={() => setOpen((v) => !v)}>
        <CalendarPlus size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Subscribe
      </button>
      {open && (
        <div
          className="absolute right-0 mt-2 w-96 z-40 rounded-lg p-4 shadow-lg flex flex-col gap-3"
          style={{ background: "var(--of-bg-elevated)", border: "1px solid var(--of-border-line)" }}
        >
          <div>
            <p className="text-sm font-medium mb-1">Subscribe in Google Calendar, Outlook, or Apple Calendar</p>
            <p className="text-xs" style={{ color: "var(--of-fg-muted)" }}>
              Anyone with this link can see the plan's schedule. Rotate it if it's ever shared somewhere it shouldn't be.
            </p>
          </div>
          <div className="flex gap-2">
            <input readOnly value={url} className={inputClass({ className: "flex-1 text-xs" })} onFocus={(e) => e.target.select()} />
            <button className={buttonClass({ variant: "secondary", size: "sm" })} onClick={copy}>
              {copied ? <Check size={20} strokeWidth={1.75} className="!w-4 !h-4" /> : <Copy size={20} strokeWidth={1.75} className="!w-4 !h-4" />}
            </button>
          </div>
          <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => rotate.mutate()} disabled={rotate.isPending}>
            <RefreshCw size={20} strokeWidth={1.75} className="!w-4 !h-4" /> {rotate.isPending ? "Rotating…" : "Rotate link"}
          </button>
        </div>
      )}
    </div>
  );
}
