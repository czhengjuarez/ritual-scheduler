import { useNavigate } from "react-router-dom";
import { usePlans } from "../hooks/usePlanner";
import { IntentBox } from "../planner/IntentBox";

/**
 * The front door (PLAN.md §5.2), on its own — reached by clicking "Ritual
 * Builder" in the header. Just the one-sentence description and the
 * freeform intent box: no JTBD chips here, since typing what you're trying
 * to do already does what picking chips used to (decided 2026-08-02, after
 * the chips read as repeating the same question the box already asks).
 */
export function HomePage() {
  const { data: plansData } = usePlans();
  const hasPlan = plansData?.items.some((p) => p.status !== "archived") ?? false;
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-4 mt-16">
      <div className="flex flex-col gap-1 text-center">
        <h1 className="text-xl font-semibold">Ritual Builder</h1>
        <p style={{ color: "var(--of-fg-muted)" }}>Ritual Builder helps you design and run your team's rituals — from a single session to a whole year's cadence.</p>
      </div>
      <IntentBox
        // ?new=1 tells PlanPage to show "Start a plan" even if one already
        // exists — same as the old "Start something new" button, just
        // reachable from this page instead of only from the calendar's own header.
        onWantsPlan={() => navigate("/plan?new=1")}
        onDone={hasPlan ? () => navigate("/plan") : undefined}
        calendarFallbackNote="You don't have a plan yet — start one to see your calendar."
      />
    </div>
  );
}
