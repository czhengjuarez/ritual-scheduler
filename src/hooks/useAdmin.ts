import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CadenceTemplateDto } from "./useCadences";
import type { RitualDto, CategoryDto, JobDto } from "./useLibrary";

async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`${url} failed: ${res.status}`);
  return res.json();
}

async function sendJSON<T>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "include",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${url} failed: ${res.status}`);
  return res.json();
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export function useAdminSession() {
  return useQuery({ queryKey: ["admin-session"], queryFn: () => getJSON<{ authenticated: boolean }>("/api/admin-auth/session") });
}

export function useAdminLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (password: string) => sendJSON<{ ok: true } | { error: string }>("/api/admin-auth/login", "POST", { password }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-session"] }),
  });
}

export function useAdminLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendJSON("/api/admin-auth/logout", "POST"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-session"] }),
  });
}

// ─── Cadence queue ──────────────────────────────────────────────────────────

export function useAdminCadences(status: string) {
  return useQuery({ queryKey: ["admin-cadences", status], queryFn: () => getJSON<{ items: CadenceTemplateDto[] }>(`/api/admin/cadences?status=${status}`) });
}

export function useCadenceModeration() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-cadences"] });
  return {
    approve: useMutation({ mutationFn: (id: number) => sendJSON(`/api/admin/cadences/${id}/approve`, "POST"), onSuccess: invalidate }),
    reject: useMutation({ mutationFn: (id: number) => sendJSON(`/api/admin/cadences/${id}/reject`, "POST"), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number; featured?: boolean; name?: string; summary?: string }) => sendJSON(`/api/admin/cadences/${id}`, "PATCH", body),
      onSuccess: invalidate,
    }),
  };
}

// ─── Ritual queue + source verification ────────────────────────────────────

export function useAdminRituals(params: { status?: string; sourceVerified?: boolean }) {
  const qs = new URLSearchParams();
  if (params.status) qs.set("status", params.status);
  if (params.sourceVerified === false) qs.set("sourceVerified", "false");
  return useQuery({ queryKey: ["admin-rituals", params], queryFn: () => getJSON<{ items: RitualDto[] }>(`/api/admin/rituals?${qs}`) });
}

export function useRitualModeration() {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-rituals"] });
  return {
    approve: useMutation({ mutationFn: (id: number) => sendJSON(`/api/admin/rituals/${id}/approve`, "POST"), onSuccess: invalidate }),
    reject: useMutation({ mutationFn: (id: number) => sendJSON(`/api/admin/rituals/${id}/reject`, "POST"), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: number) => sendJSON(`/api/admin/rituals/${id}`, "DELETE"), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number; sourceVerified?: boolean; sourceUrl?: string; title?: string; summary?: string; categoryId?: number | null }) =>
        sendJSON(`/api/admin/rituals/${id}`, "PATCH", body),
      onSuccess: invalidate,
    }),
    create: useMutation({
      mutationFn: (body: { title: string; summary?: string; categoryId?: number; engagement?: string; durationMin?: number; load?: string }) =>
        sendJSON("/api/admin/rituals", "POST", body),
      onSuccess: invalidate,
    }),
  };
}

// ─── Categories CRUD ────────────────────────────────────────────────────────

export function useAdminCategories() {
  return useQuery({ queryKey: ["admin-categories"], queryFn: () => getJSON<{ items: CategoryDto[] }>("/api/admin/categories") });
}

export function useCategoryAdmin() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-categories"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
  };
  return {
    create: useMutation({ mutationFn: (body: { name: string; slug: string; color?: string; icon?: string }) => sendJSON("/api/admin/categories", "POST", body), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number; name?: string; slug?: string; color?: string | null; icon?: string | null; description?: string | null }) =>
        sendJSON(`/api/admin/categories/${id}`, "PATCH", body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: number) => sendJSON(`/api/admin/categories/${id}`, "DELETE"), onSuccess: invalidate }),
  };
}

// ─── Jobs CRUD ──────────────────────────────────────────────────────────────

export function useAdminJobs() {
  return useQuery({ queryKey: ["admin-jobs"], queryFn: () => getJSON<{ items: JobDto[] }>("/api/admin/jobs") });
}

export function useJobAdmin() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin-jobs"] });
    qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  return {
    create: useMutation({ mutationFn: (body: { slug: string; name: string; description?: string }) => sendJSON("/api/admin/jobs", "POST", body), onSuccess: invalidate }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: number; slug?: string; name?: string; description?: string | null }) => sendJSON(`/api/admin/jobs/${id}`, "PATCH", body),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: number) => sendJSON(`/api/admin/jobs/${id}`, "DELETE"), onSuccess: invalidate }),
  };
}
