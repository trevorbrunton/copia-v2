"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { Visit } from "@/src/hooks/use-visits";

export function buildVisitQueryKey(visitId: number | null) {
  return ["visit", visitId];
}

export function useVisit(visitId: number | null) {
  return useQuery<Visit>({
    queryKey: buildVisitQueryKey(visitId),
    queryFn: async () => {
      const res = await apiFetch(`/api/visits/${visitId}`);
      if (!res.ok) throw new Error("Failed to fetch visit");
      return res.json();
    },
    enabled: visitId !== null,
  });
}
