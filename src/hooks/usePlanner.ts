import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { RitualDto } from "./useLibrary";

export interface PlanDto {
  id: string;
  teamId: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  status: "draft" | "active" | "archived";
  primaryJobId: number | null;
  createdAt: string;
}

export interface RotationItemDto {
  id: number;
  slotId: string;
  position: number;
  ritualId: number | null;
  label: string | null;
}

export interface SlotDto {
  id: string;
  planId: string;
  name: string;
  color: string | null;
  freq: "weekly" | "biweekly" | "monthly";
  byweekday: number;
  startTime: string | null;
  durationMin: number | null;
  cycleLength: number;
  anchorDate: string;
  activeFrom: string | null;
  activeTo: string | null;
  rotation: RotationItemDto[];
}

export interface OccurrenceDto {
  id: string;
  planId: string;
  slotId: string | null;
  ritualId: number | null;
  date: string;
  endDate: string | null;
  startTime: string | null;
  durationMin: number | null;
  titleOverride: string | null;
  status: "planned" | "confirmed" | "done" | "skipped" | "cancelled";
  facilitator: string | null;
  guestName: string | null;
  notes: string | null;
  origin: "rotation" | "manual" | "template" | "ai";
  editedAt: string | null;
  ritual: RitualDto | null;
}

export interface WarningDto {
  type: "min_gap" | "avoid_near" | "heavy_cluster" | "prep_lead";
  severity: "warning" | "info";
  message: string;
  occurrenceIds: string[];
}

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

export function usePlans() {
  return useQuery({ queryKey: ["plans"], queryFn: () => getJSON<{ items: PlanDto[] }>("/api/plans") });
}

export function useCreatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; startDate: string; endDate: string; timezone?: string }) =>
      sendJSON<{ item: PlanDto }>("/api/plans", "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["plans"] }),
  });
}

export function useSlots(planId: string | undefined) {
  return useQuery({
    queryKey: ["slots", planId],
    queryFn: () => getJSON<{ items: SlotDto[] }>(`/api/plans/${planId}/slots`),
    enabled: !!planId,
  });
}

export function useCreateSlot(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      name: string;
      anchorDate: string;
      freq: string;
      durationMin?: number;
      startTime?: string;
      rotation: { position: number; ritualId: number | null }[];
    }) => sendJSON<{ item: SlotDto }>(`/api/plans/${planId}/slots`, "POST", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["slots", planId] });
      qc.invalidateQueries({ queryKey: ["occurrences", planId] });
      qc.invalidateQueries({ queryKey: ["warnings", planId] });
    },
  });
}

export function useUpdateSlot(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ slotId, ...body }: { slotId: string; rotation?: { position: number; ritualId: number | null }[]; name?: string }) =>
      sendJSON<{ item: SlotDto }>(`/api/slots/${slotId}`, "PATCH", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["slots", planId] });
      qc.invalidateQueries({ queryKey: ["occurrences", planId] });
      qc.invalidateQueries({ queryKey: ["warnings", planId] });
    },
  });
}

export function useDeleteSlot(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (slotId: string) => sendJSON<{ success: true }>(`/api/slots/${slotId}`, "DELETE"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["slots", planId] });
      qc.invalidateQueries({ queryKey: ["occurrences", planId] });
      qc.invalidateQueries({ queryKey: ["warnings", planId] });
    },
  });
}

export function useOccurrences(planId: string | undefined, from: string, to: string) {
  return useQuery({
    queryKey: ["occurrences", planId, from, to],
    queryFn: () => getJSON<{ items: OccurrenceDto[] }>(`/api/plans/${planId}/occurrences?from=${from}&to=${to}`),
    enabled: !!planId,
  });
}

export function useCreateOccurrence(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ritualId?: number | null; date: string; endDate?: string; titleOverride?: string }) =>
      sendJSON<{ item: OccurrenceDto }>(`/api/plans/${planId}/occurrences`, "POST", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["occurrences", planId] });
      qc.invalidateQueries({ queryKey: ["warnings", planId] });
    },
  });
}

export function useUpdateOccurrence(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Partial<Pick<OccurrenceDto, "facilitator" | "guestName" | "notes" | "status" | "ritualId">>) =>
      sendJSON<{ item: OccurrenceDto }>(`/api/occurrences/${id}`, "PATCH", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["occurrences", planId] });
      qc.invalidateQueries({ queryKey: ["warnings", planId] });
    },
  });
}

export function useDeleteOccurrence(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJSON<{ success: true }>(`/api/occurrences/${id}`, "DELETE"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["occurrences", planId] });
      qc.invalidateQueries({ queryKey: ["warnings", planId] });
    },
  });
}

export function useAddReflection(planId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ occurrenceId, ...body }: { occurrenceId: string; rating?: number; whatWorked?: string; whatDidnt?: string }) =>
      sendJSON(`/api/occurrences/${occurrenceId}/reflection`, "POST", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["occurrences", planId] }),
  });
}

export function useWarnings(planId: string | undefined) {
  return useQuery({
    queryKey: ["warnings", planId],
    queryFn: () => getJSON<{ items: WarningDto[] }>(`/api/plans/${planId}/warnings`),
    enabled: !!planId,
  });
}
