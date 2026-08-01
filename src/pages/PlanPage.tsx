import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { buttonClass, cx } from "@ops-forward/keel";
import { usePlans, useOccurrences } from "../hooks/usePlanner";
import { useCategories } from "../hooks/useLibrary";
import { CreatePlanForm } from "../planner/CreatePlanForm";
import { CycleEditorModal } from "../planner/CycleEditorModal";
import { OccurrenceDrawer } from "../planner/OccurrenceDrawer";
import { WarningsPanel } from "../planner/WarningsPanel";
import { MonthCalendar } from "../planner/MonthCalendar";
import { CampaignBanner } from "../planner/CampaignBanner";
import { addMonths, isoDate } from "../lib/calendar";
import type { OccurrenceDto } from "../hooks/usePlanner";

type View = "month" | "quarter";

export function PlanPage() {
  const { data: plansData, isLoading: plansLoading } = usePlans();
  const plan = plansData?.items[0];

  const now = new Date();
  const [ref, setRef] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [view, setView] = useState<View>("month");
  const [showCycleEditor, setShowCycleEditor] = useState(false);
  const [selected, setSelected] = useState<OccurrenceDto | null>(null);

  const monthsShown = view === "month" ? 1 : 3;
  const rangeStart = isoDate(ref.year, ref.month, 1);
  const lastMonth = addMonths(ref.year, ref.month, monthsShown - 1);
  const rangeEnd = isoDate(lastMonth.year, lastMonth.month, new Date(lastMonth.year, lastMonth.month, 0).getDate());

  const { data: occurrencesData } = useOccurrences(plan?.id, rangeStart, rangeEnd);
  const { data: categoriesData } = useCategories();
  const categoryById = useMemo(() => new Map((categoriesData?.items ?? []).map((c) => [c.id, c])), [categoriesData]);

  const { pointOccurrencesByDate, campaigns } = useMemo(() => {
    const byDate = new Map<string, OccurrenceDto[]>();
    const spans: OccurrenceDto[] = [];
    for (const occ of occurrencesData?.items ?? []) {
      if (occ.endDate && occ.endDate !== occ.date) {
        spans.push(occ);
      } else {
        byDate.set(occ.date, [...(byDate.get(occ.date) ?? []), occ]);
      }
    }
    spans.sort((a, b) => a.date.localeCompare(b.date));
    return { pointOccurrencesByDate: byDate, campaigns: spans };
  }, [occurrencesData]);

  if (plansLoading) return null;
  if (!plan) return <CreatePlanForm />;

  const monthsToRender = Array.from({ length: monthsShown }, (_, i) => addMonths(ref.year, ref.month, i));

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold">{plan.name}</h1>
          <p className="text-sm" style={{ color: "var(--of-fg-muted)" }}>
            {plan.startDate} → {plan.endDate}
          </p>
        </div>
        <button className={buttonClass({ variant: "primary" })} onClick={() => setShowCycleEditor(true)}>
          <Plus size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Add slot
        </button>
      </div>

      <WarningsPanel planId={plan.id} />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setRef((r) => addMonths(r.year, r.month, -monthsShown))}>
            <ChevronLeft size={20} strokeWidth={1.75} />
          </button>
          <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => setRef((r) => addMonths(r.year, r.month, monthsShown))}>
            <ChevronRight size={20} strokeWidth={1.75} />
          </button>
        </div>
        <div className="flex gap-1 rounded-md p-0.5" style={{ background: "var(--of-bg-recessed)" }}>
          {(["month", "quarter"] as View[]).map((v) => (
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

      <CampaignBanner occurrences={campaigns} onSelect={setSelected} />

      <div className={view === "quarter" ? "grid grid-cols-1 lg:grid-cols-3 gap-6" : ""}>
        {monthsToRender.map(({ year, month }) => (
          <MonthCalendar
            key={`${year}-${month}`}
            year={year}
            month={month}
            occurrencesByDate={pointOccurrencesByDate}
            categoryById={categoryById}
            onSelect={setSelected}
          />
        ))}
      </div>

      {showCycleEditor && <CycleEditorModal planId={plan.id} onClose={() => setShowCycleEditor(false)} />}
      {selected && <OccurrenceDrawer planId={plan.id} occurrence={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
