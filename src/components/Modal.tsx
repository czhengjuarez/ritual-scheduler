import { useEffect } from "react";
import { X } from "lucide-react";
import { buttonClass } from "@ops-forward/keel";

/** Lifted from design-resources' admin Modal (PLAN.md §3) and adapted for a variable width. */
export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}>
      <div
        className={`w-full ${wide ? "max-w-2xl" : "max-w-lg"} rounded-xl shadow-lg`}
        style={{ background: "var(--of-bg-elevated)", border: "1px solid var(--of-border-line)" }}
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "var(--of-border-line)" }}>
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className={buttonClass({ variant: "ghost", size: "sm" })} style={{ padding: "0 4px" }}>
            <X size={20} strokeWidth={1.75} className="!w-4 !h-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--of-border-line)" }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
