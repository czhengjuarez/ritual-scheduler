import { cardClass } from "@ops-forward/keel";
import { Sparkles } from "lucide-react";

export function CadencesPage() {
  return (
    <div className={cardClass({ className: "max-w-2xl mx-auto p-8 text-center" })}>
      <Sparkles size={20} strokeWidth={1.75} className="mx-auto mb-3" style={{ color: "var(--of-fg-brand)" }} />
      <h1 className="text-xl font-semibold mb-2">Cadence gallery</h1>
      <p style={{ color: "var(--of-fg-muted)" }}>
        Clone a whole cadence — a full plan another team built — onto your own start date.
        Ships in Phase 4.
      </p>
    </div>
  );
}
