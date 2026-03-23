"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { RosterTask } from "@/src/db/schema";

export function useEscalations() {
  return useQuery<RosterTask[]>({
    queryKey: ["escalations"],
    queryFn: async () => {
      const res = await apiFetch("/api/roster/escalations");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Failed to fetch escalations");
      }
      return res.json();
    },
    refetchInterval: 30_000,
  });
}

export function useHumanAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      taskId: string;
      action: string;
      employee_id?: number;
      reason?: string;
    }) => {
      const { taskId, ...body } = input;
      const res = await apiFetch(`/api/roster/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const message = body?.error?.message ?? "Failed to apply action";
        throw new Error(message);
      }
      return res.json() as Promise<RosterTask>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["escalations"] });
      queryClient.invalidateQueries({ queryKey: ["roster-tasks"] });
      queryClient.invalidateQueries({ queryKey: ["roster-summary"] });
    },
  });
}
