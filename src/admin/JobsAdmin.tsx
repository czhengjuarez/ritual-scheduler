import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { buttonClass, cardClass, inputClass } from "@ops-forward/keel";
import { useAdminJobs, useJobAdmin } from "../hooks/useAdmin";

/** Delete cascades the tag, not the ritual/cadence it tagged — ritual_jobs and cadence_jobs are ON DELETE CASCADE (db/schema.ts). */
export function JobsAdmin() {
  const { data } = useAdminJobs();
  const { create, remove } = useJobAdmin();
  const [name, setName] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    create.mutate({ slug, name: name.trim() }, { onSuccess: () => setName("") });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input className={inputClass({ className: "flex-1" })} placeholder="New job name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button className={buttonClass({ variant: "primary" })} onClick={submit} disabled={!name.trim() || create.isPending}>
          <Plus size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Add
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {data?.items.map((job) => (
          <div key={job.id} className={cardClass({ className: "p-3 flex items-center justify-between" })}>
            <div>
              <span className="font-medium">{job.name}</span>
              <span className="text-xs ml-2" style={{ color: "var(--of-fg-subtle)" }}>
                {job.slug}
              </span>
            </div>
            <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => remove.mutate(job.id)}>
              <Trash2 size={20} strokeWidth={1.75} className="!w-4 !h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
