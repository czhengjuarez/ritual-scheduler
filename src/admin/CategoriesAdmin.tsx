import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { buttonClass, cardClass, inputClass } from "@ops-forward/keel";
import { useAdminCategories, useCategoryAdmin } from "../hooks/useAdmin";

/**
 * Delete needs no reparent step here: rituals.category_id is
 * ON DELETE SET NULL (db/schema.ts) — these categories are a flat list, not
 * a tree, so "no orphans" just means a deleted category's rituals fall back
 * to uncategorized, which the foreign key already guarantees.
 */
export function CategoriesAdmin() {
  const { data } = useAdminCategories();
  const { create, remove } = useCategoryAdmin();
  const [name, setName] = useState("");

  const submit = () => {
    if (!name.trim()) return;
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    create.mutate({ name: name.trim(), slug }, { onSuccess: () => setName("") });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <input className={inputClass({ className: "flex-1" })} placeholder="New category name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
        <button className={buttonClass({ variant: "primary" })} onClick={submit} disabled={!name.trim() || create.isPending}>
          <Plus size={20} strokeWidth={1.75} className="!w-4 !h-4" /> Add
        </button>
      </div>

      <div className="flex flex-col gap-2">
        {data?.items.map((cat) => (
          <div key={cat.id} className={cardClass({ className: "p-3 flex items-center justify-between" })}>
            <div className="flex items-center gap-2">
              <span className="inline-block w-3 h-3 rounded-full" style={{ background: cat.color ?? "var(--of-fg-subtle)" }} />
              <span className="font-medium">{cat.name}</span>
              <span className="text-xs" style={{ color: "var(--of-fg-subtle)" }}>
                {cat.slug}
              </span>
            </div>
            <button className={buttonClass({ variant: "ghost", size: "sm" })} onClick={() => remove.mutate(cat.id)}>
              <Trash2 size={20} strokeWidth={1.75} className="!w-4 !h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
