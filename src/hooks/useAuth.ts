import { useMutation, useQueryClient } from "@tanstack/react-query";

async function postCredential(credential: string): Promise<void> {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ credential }),
  });
  if (!res.ok) throw new Error(`Sign-in failed: ${res.status}`);
}

/**
 * Every other query in the app (plans, slots, occurrences, warnings...) is
 * scoped by whatever team the session cookie currently points at, but none
 * of those query keys include a team id — sign-in (claims a team) and
 * sign-out (mints a brand new one) both swap out *which* team "the plan" or
 * "the library" means without changing any of those keys. Invalidating just
 * ["session"] leaves all of that cached under the old identity, so the UI
 * looks unchanged even though the cookie really did change. Invalidating
 * everything on either transition is the only way to guarantee nothing from
 * the old identity survives into the new one.
 */
function invalidateEverything(qc: ReturnType<typeof useQueryClient>) {
  return qc.invalidateQueries();
}

/** Hands the raw Google credential to the Worker, which verifies it and issues the session cookie — the browser never decides who the user is. */
export function useGoogleSignIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postCredential,
    onSuccess: () => invalidateEverything(qc),
  });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await fetch("/api/auth/session", { method: "DELETE", credentials: "include" });
    },
    onSuccess: () => invalidateEverything(qc),
  });
}
