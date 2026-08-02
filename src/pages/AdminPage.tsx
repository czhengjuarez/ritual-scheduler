import { useState } from "react";
import { LogOut } from "lucide-react";
import { buttonClass, cx } from "@ops-forward/keel";
import { useAdminSession, useAdminLogout } from "../hooks/useAdmin";
import { AdminLogin } from "../admin/AdminLogin";
import { CadenceQueue } from "../admin/CadenceQueue";
import { RitualQueue } from "../admin/RitualQueue";
import { SourceVerification } from "../admin/SourceVerification";
import { CategoriesAdmin } from "../admin/CategoriesAdmin";
import { JobsAdmin } from "../admin/JobsAdmin";

const TABS = [
  { id: "cadences", label: "Cadence Queue", render: () => <CadenceQueue /> },
  { id: "rituals", label: "Ritual Queue", render: () => <RitualQueue /> },
  { id: "sources", label: "Source Verification", render: () => <SourceVerification /> },
  { id: "categories", label: "Categories", render: () => <CategoriesAdmin /> },
  { id: "jobs", label: "Jobs", render: () => <JobsAdmin /> },
] as const;

export function AdminPage() {
  const { data, isLoading } = useAdminSession();
  const logout = useAdminLogout();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("cadences");

  if (isLoading) return null;
  if (!data?.authenticated) return <AdminLogin />;

  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Admin</h1>
        <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => logout.mutate()}>
          <LogOut size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Sign out
        </button>
      </div>

      <div className="flex gap-1 rounded-md p-0.5 w-fit" style={{ background: "var(--of-bg-recessed)" }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx("px-3 py-1.5 rounded text-sm font-medium")}
            style={{ background: tab === t.id ? "var(--of-bg-elevated)" : "transparent" }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active.render()}
    </div>
  );
}
