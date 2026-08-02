import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CalendarClock, ChevronLeft, ChevronRight, ListTree, Plus, Share2, Sparkles } from "lucide-react";
import { buttonClass, selectClass, cx } from "@ops-forward/keel";
import { usePlans, useOccurrences, useSlots } from "../hooks/usePlanner";
import { useCategories } from "../hooks/useLibrary";
import { CreatePlanForm } from "../planner/CreatePlanForm";
import { CycleEditorModal } from "../planner/CycleEditorModal";
import { OccurrenceDrawer } from "../planner/OccurrenceDrawer";
import { WarningsPanel } from "../planner/WarningsPanel";
import { BalancePanel } from "../planner/BalancePanel";
import { MonthCalendar } from "../planner/MonthCalendar";
import { CampaignBanner } from "../planner/CampaignBanner";
import { YearGrid } from "../planner/YearGrid";
import { SubscribePanel } from "../planner/SubscribePanel";
import { PublishModal } from "../planner/PublishModal";
import { PlansManagerModal } from "../planner/PlansManagerModal";
import { SlotsManagerModal } from "../planner/SlotsManagerModal";
import { addMonths, isoDate } from "../lib/calendar";
import type { OccurrenceDto } from "../hooks/usePlanner";

type View = "month" | "quarter" | "year";

export function PlanPage() {
  const { data: plansData, isLoading: plansLoading } = usePlans();
  const plans = plansData?.items ?? [];
  // Plans coexist now — several can be worth keeping around at once (e.g.
  // one per team you manage), so there's no single "the active plan" to
  // default to. Whatever was last explicitly picked (via the switcher or
  // Manage plans) wins; otherwise fall back to the most recently created
  // one, so the calendar is never empty when there's anything to show.
  const [viewPlanId, setViewPlanId] = useState<string | null>(null);
  const plan = (viewPlanId ? plans.find((p) => p.id === viewPlanId) : undefined) ?? plans[plans.length - 1];

  const now = new Date();
  const [ref, setRef] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [view, setView] = useState<View>("month");
  const [showCycleEditor, setShowCycleEditor] = useState(false);
  const [showPublish, setShowPublish] = useState(false);
  const [showManagePlans, setShowManagePlans] = useState(false);
  const [showManageSlots, setShowManageSlots] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [startingNew, setStartingNew] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [pendingFocusPlan, setPendingFocusPlan] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const monthsShown = view === "quarter" ? 3 : 1;
  const rangeStart = view === "year" ? plan?.startDate ?? isoDate(ref.year, ref.month, 1) : isoDate(ref.year, ref.month, 1);
  const lastMonth = addMonths(ref.year, ref.month, monthsShown - 1);
  const rangeEnd =
    view === "year" ? plan?.endDate ?? rangeStart : isoDate(lastMonth.year, lastMonth.month, new Date(lastMonth.year, lastMonth.month, 0).getDate());

  const { data: occurrencesData } = useOccurrences(plan?.id, rangeStart, rangeEnd);
  const { data: slotsData } = useSlots(plan?.id);
  const { data: categoriesData } = useCategories();
  const categoryById = useMemo(() => new Map((categoriesData?.items ?? []).map((c) => [c.id, c])), [categoriesData]);

  const { pointOccurrencesByDate, pointOccurrences, campaigns } = useMemo(() => {
    const byDate = new Map<string, OccurrenceDto[]>();
    const points: OccurrenceDto[] = [];
    const spans: OccurrenceDto[] = [];
    for (const occ of occurrencesData?.items ?? []) {
      if (occ.endDate && occ.endDate !== occ.date) {
        spans.push(occ);
      } else {
        points.push(occ);
        byDate.set(occ.date, [...(byDate.get(occ.date) ?? []), occ]);
      }
    }
    spans.sort((a, b) => a.date.localeCompare(b.date));
    return { pointOccurrencesByDate: byDate, pointOccurrences: points, campaigns: spans };
  }, [occurrencesData]);

  // Looked up fresh from occurrencesData every render (not the object captured
  // at selection time) so the drawer reflects a status change immediately —
  // useUpdateOccurrence invalidates this query, but a frozen occurrence object
  // in state wouldn't pick that up, making the status pills look unresponsive.
  const selected = selectedId ? (occurrencesData?.items.find((o) => o.id === selectedId) ?? null) : null;

  const showCreateFlow = !plan || startingNew;

  // Arriving from the Home page's intent box with ?new=1 (PLAN.md §5.2) means
  // "start a plan" even if one already exists — same as clicking "Start
  // something new" below, just reachable from the front door instead.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setStartingNew(true);
      setPendingFocusPlan(true);
      const next = new URLSearchParams(searchParams);
      next.delete("new");
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The create-flow body needs to be on screen before there's an input to
  // focus — if it isn't showing yet, the effect above reveals it first and
  // this re-runs once that render happens, instead of trying to focus a ref
  // that doesn't exist yet in the same tick.
  useEffect(() => {
    if (pendingFocusPlan && showCreateFlow) {
      nameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      nameInputRef.current?.focus();
      setPendingFocusPlan(false);
    }
  }, [pendingFocusPlan, showCreateFlow]);

  if (plansLoading) return null;

  const handlePlanCreated = (newPlanId?: string) => {
    if (newPlanId) setViewPlanId(newPlanId);
    setStartingNew(false);
  };

  const monthsToRender = Array.from({ length: monthsShown }, (_, i) => addMonths(ref.year, ref.month, i));

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      {showCreateFlow ? (
        <>
          <div className="flex justify-end">
            <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setShowManagePlans(true)}>
              <ListTree size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Manage plans
            </button>
          </div>
          <CreatePlanForm onDone={plan ? handlePlanCreated : undefined} nameInputRef={nameInputRef} />
        </>
      ) : (
        <>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              {plans.length > 1 ? (
                <select
                  className={selectClass({ className: "text-xl font-semibold !border-0 !bg-transparent !p-0" })}
                  value={plan.id}
                  onChange={(e) => setViewPlanId(e.target.value)}
                >
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              ) : (
                <h1 className="text-xl font-semibold">{plan.name}</h1>
              )}
              <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
                {plan.startDate} → {plan.endDate}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button className={buttonClass({ variant: "ghost" })} onClick={() => setShowManagePlans(true)}>
                <ListTree size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Manage plans
              </button>
              <button className={buttonClass({ variant: "ghost" })} onClick={() => setShowManageSlots(true)}>
                <CalendarClock size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Manage slots
              </button>
              <button className={buttonClass({ variant: "ghost" })} onClick={() => setStartingNew(true)} title="Adds another plan you can switch between — your existing ones stay put">
                <Sparkles size={20} strokeWidth={1.75} className="!w-4 !h-4" style={{ color: "var(--of-fg-brand)" }} /> New plan
              </button>
              <button className={buttonClass({ variant: "secondary" })} onClick={() => setShowPublish(true)}>
                <Share2 size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Publish
              </button>
              <SubscribePanel plan={plan} />
              <button className={buttonClass({ variant: "primary" })} onClick={() => setShowCycleEditor(true)}>
                <Plus size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Add slot
              </button>
            </div>
          </div>

          <WarningsPanel planId={plan.id} />
          <BalancePanel planId={plan.id} />

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1" style={{ visibility: view === "year" ? "hidden" : "visible" }}>
              <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setRef((r) => addMonths(r.year, r.month, -monthsShown))}>
                <ChevronLeft size={20} strokeWidth={1.75} />
              </button>
              <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setRef((r) => addMonths(r.year, r.month, monthsShown))}>
                <ChevronRight size={20} strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex gap-1 rounded-md p-0.5" style={{ background: "var(--of-bg-recessed)" }}>
              {(["month", "quarter", "year"] as View[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={cx("px-3 py-1 rounded text-sm font-medium capitalize")}
                  style={{ background: view === v ? "var(--of-bg-elevated)" : "transparent" }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {view === "year" ? (
            <YearGrid
              startDate={plan.startDate}
              endDate={plan.endDate}
              slots={slotsData?.items ?? []}
              pointOccurrences={pointOccurrences}
              campaigns={campaigns}
              categoryById={categoryById}
              onSelect={(occ) => setSelectedId(occ.id)}
            />
          ) : (
            <>
              <CampaignBanner occurrences={campaigns} onSelect={(occ) => setSelectedId(occ.id)} />
              <div className={view === "quarter" ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : ""}>
                {monthsToRender.map(({ year, month }) => (
                  <MonthCalendar
                    key={`${year}-${month}`}
                    year={year}
                    month={month}
                    occurrencesByDate={pointOccurrencesByDate}
                    categoryById={categoryById}
                    onSelect={(occ) => setSelectedId(occ.id)}
                  />
                ))}
              </div>
            </>
          )}

          {showCycleEditor && <CycleEditorModal planId={plan.id} onClose={() => setShowCycleEditor(false)} />}
          {showPublish && <PublishModal planId={plan.id} planName={plan.name} onClose={() => setShowPublish(false)} />}
          {selected && <OccurrenceDrawer planId={plan.id} occurrence={selected} timezone={plan.timezone} onClose={() => setSelectedId(null)} />}
        </>
      )}

      {showManagePlans && (
        <PlansManagerModal
          currentPlanId={plan?.id ?? null}
          onSelectPlan={(id) => {
            setViewPlanId(id);
            setStartingNew(false);
            setShowManagePlans(false);
          }}
          onClose={() => setShowManagePlans(false)}
        />
      )}
      {showManageSlots && plan && <SlotsManagerModal planId={plan.id} onClose={() => setShowManageSlots(false)} />}
    </div>
  );
}
