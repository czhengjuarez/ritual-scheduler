import { useState } from "react";
import { Search, Plus, Sparkles } from "lucide-react";
import { inputClass, badgeClass, buttonClass, selectClass, labelClass, textareaClass } from "@ops-forward/keel";
import { Modal } from "../components/Modal";
import { useRituals, useCategories, useCreateRitual, useJobs } from "../hooks/useLibrary";
import { useAutofill } from "../hooks/useAi";
import { Chip } from "../components/Chip";
import type { RitualDto } from "../hooks/useLibrary";

/**
 * Click-to-assign in place of drag-and-drop for this first pass (PLAN.md §3
 * describes CycleBoard as drag-based; true drag interactions are deferred to
 * Phase 9 polish — this gets the same functional outcome without a DnD
 * dependency yet).
 *
 * Three ways out, all equally visible up front: pick something from the
 * library below, leave the position unassigned, or create a brand-new
 * ritual — the create path used to only appear once you'd typed a search
 * query with no exact match, which read as "you must pick from the library"
 * since the escape hatch was buried behind an unrelated action first.
 */
export function RitualPickerModal({ onSelect, onClose }: { onSelect: (ritual: RitualDto | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [load, setLoad] = useState<"light" | "medium" | "heavy">("medium");
  const [summary, setSummary] = useState("");
  const [notes, setNotes] = useState("");
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set());
  // Captured once at mount, not at submit — this is what the spam-timing
  // check on the server actually measures (PLAN.md §5.5).
  const [renderedAt] = useState(() => Date.now());

  const { data, isLoading } = useRituals({ q: q || undefined });
  const { data: categoriesData } = useCategories();
  const { data: jobsData } = useJobs();
  const createRitual = useCreateRitual();
  const autofill = useAutofill();

  const openCreate = () => {
    setTitle(q.trim());
    setShowCreate(true);
  };

  const runAutofill = () => {
    if (!notes.trim()) return;
    autofill.mutate(`${title.trim()}\n${notes.trim()}`, {
      onSuccess: ({ draft }) => {
        setSummary(draft.summary ?? "");
        if (draft.load) setLoad(draft.load);
        const cat = categoriesData?.items.find((c) => c.slug === draft.categorySlug);
        if (cat) setCategoryId(cat.id);
        setSelectedJobs(new Set(draft.jobSlugs));
      },
    });
  };

  const toggleJob = (slug: string) => {
    setSelectedJobs((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  };

  const submitNew = () => {
    if (!title.trim()) return;
    createRitual.mutate(
      { title: title.trim(), summary: summary.trim() || undefined, categoryId: categoryId || undefined, load, jobSlugs: [...selectedJobs], renderedAt },
      { onSuccess: (result) => "item" in result && onSelect(result.item) },
    );
  };

  return (
    <Modal title="Choose a ritual" onClose={onClose} wide>
      {!showCreate ? (
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search size={20} strokeWidth={1.75} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--of-fg-subtle)" }} />
            <input
              autoFocus
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search rituals…"
              className={inputClass({ className: "pl-10 w-full" })}
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => onSelect(null)}
              className="flex-1 text-left px-3 py-2 rounded-md text-sm border"
              style={{ borderColor: "var(--of-border-line)", color: "var(--of-fg-muted)" }}
            >
              Leave this position unassigned (theme only)
            </button>
            <button
              onClick={openCreate}
              className="flex items-center gap-2 text-sm px-3 py-2 rounded-md shrink-0"
              style={{ color: "var(--of-fg-brand)", background: "var(--of-bg-brand-subtle)" }}
            >
              <Plus size={20} strokeWidth={1.75} className="!w-4 !h-4" />
              Create a new ritual
            </button>
          </div>

          <div className="flex flex-col gap-1 max-h-96 overflow-y-auto">
            {isLoading && <p style={{ color: "var(--of-fg-muted)" }}>Loading…</p>}
            {data?.items.map((ritual) => (
              <button
                key={ritual.id}
                onClick={() => onSelect(ritual)}
                className="flex items-center justify-between gap-3 text-left px-3 py-2 rounded-md hover:opacity-80"
                style={{ background: "var(--of-bg-recessed)" }}
              >
                <div>
                  <div className="font-medium text-sm">{ritual.title}</div>
                  {ritual.summary && (
                    <div className="text-xs" style={{ color: "var(--of-fg-muted)" }}>
                      {ritual.summary}
                    </div>
                  )}
                </div>
                <span className={badgeClass({ variant: ritual.load === "heavy" ? "red" : ritual.load === "light" ? "green" : "amber" })}>{ritual.load}</span>
              </button>
            ))}
            {data && data.items.length === 0 && (
              <p style={{ color: "var(--of-fg-muted)" }}>No matches in your library — create a new one above.</p>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs" style={{ color: "var(--of-fg-muted)" }}>
            Lands in your team's library right away — no approval needed. Publishing it publicly is a separate,
            optional step from the Library page.
          </p>

          <div>
            <label className={labelClass()}>Title</label>
            <input
              autoFocus
              className={inputClass({ className: "w-full" })}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Friday Demo Day"
            />
          </div>

          <div>
            <label className={labelClass()}>Paste notes, a URL, or a description (optional)</label>
            <textarea
              className={textareaClass({ className: "w-full" })}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Paste anything about this ritual — AI drafts the fields below from it"
            />
            <button
              className={buttonClass({ variant: "secondary", size: "sm", className: "mt-1.5" })}
              onClick={runAutofill}
              disabled={!notes.trim() || autofill.isPending}
            >
              <Sparkles size={16} strokeWidth={1.75} style={{ color: "var(--of-fg-brand)" }} />
              {autofill.isPending ? "Drafting…" : "Autofill from this"}
            </button>
            {autofill.isError && <p className="text-xs mt-1" style={{ color: "var(--of-fg-danger)" }}>Couldn't draft from that — fill in the fields below instead.</p>}
          </div>

          <div>
            <label className={labelClass()}>Summary</label>
            <textarea className={textareaClass({ className: "w-full" })} rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass()}>Category</label>
              <select className={selectClass({ className: "w-full" })} value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">None</option>
                {categoriesData?.items.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass()}>Load</label>
              <select className={selectClass({ className: "w-full" })} value={load} onChange={(e) => setLoad(e.target.value as typeof load)}>
                <option value="light">Light</option>
                <option value="medium">Medium</option>
                <option value="heavy">Heavy</option>
              </select>
            </div>
          </div>

          <div>
            <label className={labelClass()}>Jobs this serves</label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {jobsData?.items.map((job) => (
                <Chip key={job.slug} active={selectedJobs.has(job.slug)} onClick={() => toggleJob(job.slug)}>
                  {job.name}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <button className={buttonClass({ variant: "secondary" })} onClick={() => setShowCreate(false)}>
              Back
            </button>
            <button className={buttonClass({ variant: "primary", className: "flex-1" })} onClick={submitNew} disabled={!title.trim() || createRitual.isPending}>
              {createRitual.isPending ? "Creating…" : "Create & use it"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
