import { useState } from "react";
import { Library } from "lucide-react";
import { inputClass } from "@ops-forward/keel";
import { useRituals } from "../hooks/useLibrary";
import { RitualPickerModal } from "./RitualPickerModal";
import type { RitualDto } from "../hooks/useLibrary";

/**
 * Typing is the primary path — whatever's in the box is what schedules,
 * library or not. The dropdown underneath is just a shortcut for reusing
 * something that already exists; it's never a gate you have to go through
 * first (that was the old RitualPickerModal-only flow this replaces at the
 * slot-authoring call site). The library-icon button still opens the full
 * picker for people who want to search/filter or build out a reusable
 * ritual with category/load/jobs — an escape hatch, not the default.
 */
export function RitualComboInput({
  title,
  onChange,
  placeholder,
}: {
  title: string;
  onChange: (title: string, ritual: RitualDto | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showBrowse, setShowBrowse] = useState(false);
  const { data } = useRituals({ q: title || undefined });
  const suggestions = title.trim() ? (data?.items ?? []).slice(0, 6) : [];

  return (
    <div className="relative flex-1">
      <input
        className={inputClass({ className: "w-full pr-8" })}
        value={title}
        onChange={(e) => {
          onChange(e.target.value, null);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder ?? "Type a ritual name…"}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2"
        style={{ color: "var(--of-fg-subtle)" }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setShowBrowse(true)}
        title="Browse the library"
      >
        <Library size={20} strokeWidth={1.75} className="!w-4 !h-4" />
      </button>

      {open && suggestions.length > 0 && (
        <div
          className="absolute z-10 top-full left-0 right-0 mt-1 rounded-md shadow-lg max-h-56 overflow-y-auto"
          style={{ background: "var(--of-bg-elevated)", border: "1px solid var(--of-border-line)" }}
        >
          {suggestions.map((r) => (
            <button
              key={r.id}
              type="button"
              className="block w-full text-left px-3 py-2 text-sm hover:opacity-80"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(r.title, r);
                setOpen(false);
              }}
            >
              <span className="font-medium">{r.title}</span>
              {r.summary && (
                <span className="block text-xs" style={{ color: "var(--of-fg-muted)" }}>
                  {r.summary}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {showBrowse && (
        <RitualPickerModal
          onSelect={(r) => {
            onChange(r?.title ?? "", r);
            setShowBrowse(false);
          }}
          onClose={() => setShowBrowse(false)}
        />
      )}
    </div>
  );
}
