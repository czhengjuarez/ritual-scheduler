import { cardClass } from "@ops-forward/keel";
import { ShieldCheck } from "lucide-react";

export function AdminPage() {
  return (
    <div className={cardClass({ className: "max-w-2xl mx-auto p-8 text-center" })}>
      <ShieldCheck size={20} strokeWidth={1.75} className="mx-auto mb-3" style={{ color: "var(--of-fg-brand)" }} />
      <h1 className="text-xl font-semibold mb-2">Admin</h1>
      <p style={{ color: "var(--of-fg-muted)" }}>
        Approval queue for public cadences and rituals. Password-gated in Phase 5.
      </p>
    </div>
  );
}
