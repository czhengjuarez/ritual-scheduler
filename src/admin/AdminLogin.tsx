import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { buttonClass, cardClass, inputClass, labelClass, errorClass } from "@ops-forward/keel";
import { useAdminLogin } from "../hooks/useAdmin";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useAdminLogin();

  const submit = () => {
    setError(null);
    login.mutate(password, {
      onSuccess: (result) => {
        if ("error" in result) setError(result.error);
      },
      onError: () => setError("Something went wrong"),
    });
  };

  return (
    <div className={cardClass({ className: "max-w-sm mx-auto p-8" })}>
      <ShieldCheck size={20} strokeWidth={1.75} className="mb-3" style={{ color: "var(--of-fg-brand)" }} />
      <h1 className="text-xl font-semibold mb-1">Admin</h1>
      <p className="mb-6" style={{ color: "var(--of-fg-muted)" }}>
        Password-gated (PLAN.md §7) — approves what leaves a team's own workspace for the public gallery.
      </p>
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelClass()}>Password</label>
          <input
            type="password"
            className={inputClass({ className: "w-full" })}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
          {error && <p className={errorClass()}>{error}</p>}
        </div>
        <button className={buttonClass({ variant: "primary" })} onClick={submit} disabled={!password || login.isPending}>
          {login.isPending ? "Checking…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
