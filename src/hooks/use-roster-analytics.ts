"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { AnalyticsResult } from "@/src/server/queries/roster/get-analytics";

export function useRosterAnalytics(days: number = 30) {
  return useQuery<AnalyticsResult>({
    queryKey: ["roster-analytics", days],
    queryFn: async () => {
      const res = await apiFetch(`/api/roster/analytics?days=${days}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Failed to fetch analytics");
      }
      return res.json();
    },
  });
}
