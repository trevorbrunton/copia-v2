"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { RosterTask } from "@/src/db/schema";

interface RosterTaskWithAudit extends RosterTask {
  auditTrail?: Array<{
    id: string;
    action: string;
    actor: string;
    details: Record<string, unknown>;
    reasoning: string | null;
    timestamp: string;
  }>;
}

export function useRosterTasks(filter?: { status?: string }) {
  const params = new URLSearchParams();
  if (filter?.status) params.set("status", filter.status);
  const qs = params.toString();

  return useQuery<RosterTask[]>({
    queryKey: ["roster-tasks", filter?.status ?? "all"],
    queryFn: async () => {
      const res = await apiFetch(`/api/roster/tasks${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch roster tasks");
      return res.json();
    },
  });
}

export function useRosterTask(taskId: string | null) {
  return useQuery<RosterTaskWithAudit>({
    queryKey: ["roster-task", taskId],
    queryFn: async () => {
      if (!taskId) throw new Error("taskId is required");
      const res = await apiFetch(`/api/roster/tasks/${taskId}`);
      if (!res.ok) throw new Error("Failed to fetch roster task");
      return res.json();
    },
    enabled: taskId !== null,
  });
}

export function useCreateRosterTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      visit_id: number;
      client_id?: number;
      urgency?: "planned" | "urgent";
    }) => {
      const res = await apiFetch("/api/roster/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create roster task");
      return res.json() as Promise<RosterTask>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster-tasks"] });
    },
  });
}

export interface RosterSummary {
  active: number;
  escalated: number;
  completedToday: number;
  avgTimeToFillMs: number | null;
}

export function useRosterSummary() {
  return useQuery<RosterSummary>({
    queryKey: ["roster-summary"],
    queryFn: async () => {
      const res = await apiFetch("/api/roster/summary");
      if (!res.ok) throw new Error("Failed to fetch roster summary");
      return res.json();
    },
  });
}

export function useProcessEvents() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/roster/process-events", {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to process events");
      return res.json() as Promise<{ processed: number; tasks: string[] }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["roster-tasks"] });
    },
  });
}
