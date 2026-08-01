import { useQuery } from "@tanstack/react-query";

interface SessionResponse {
  userId: string;
  team: { id: string; name: string; slug: string; timezone: string } | null;
}

async function fetchSession(): Promise<SessionResponse> {
  const res = await fetch("/api/session", { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);
  return res.json();
}

/**
 * Proves the anonymous session -> D1 round trip end to end: the Worker
 * creates a personal-workspace team on first visit (see worker/index.ts),
 * and this is what renders its name in the header.
 */
export function useSession() {
  return useQuery({ queryKey: ["session"], queryFn: fetchSession, staleTime: Infinity });
}
