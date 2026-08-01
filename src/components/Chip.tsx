import type { ReactNode } from "react";
import { cx } from "@ops-forward/keel";

/**
 * Keel has no chip primitive (see PLAN.md §3 — build on tokens, don't fork
 * Keel), so this is the one small custom component the job/load filters need.
 */
export function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "px-3 py-1.5 rounded-full text-sm font-medium border transition-colors",
      )}
      style={{
        borderColor: active ? "var(--of-border-brand)" : "var(--of-border-line)",
        background: active ? "var(--of-bg-brand-subtle)" : "transparent",
        color: active ? "var(--of-fg-brand)" : "var(--of-fg-muted)",
      }}
    >
      {children}
    </button>
  );
}
