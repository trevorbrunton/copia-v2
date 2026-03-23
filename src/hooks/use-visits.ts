"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { AlayaPaginatedResponse } from "@/src/lib/alayacare-client";

export interface Visit {
  id: number;
  external_id: string | null;
  client_id: number | null;
  employee_id: number | null;
  service_id: number | null;
  start_at: string;
  end_at: string;
  status: string;
  service_instructions: string | null;
  clock_in: string | null;
  clock_out: string | null;
  created_at: string;
  updated_at: string;
}

export interface VisitOffer {
  id: number;
  visit_id: number;
  employee_id: number;
  status: string;
  decline_reason: string | null;
  offered_at: string;
  responded_at: string | null;
}

export function useVisits(options?: {
  status?: string;
  startAt?: string;
  endAt?: string;
  clientId?: number;
  employeeId?: number;
}) {
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.startAt) params.set("start_at", options.startAt);
  if (options?.endAt) params.set("end_at", options.endAt);
  if (options?.clientId) params.set("client_id", String(options.clientId));
  if (options?.employeeId)
    params.set("employee_id", String(options.employeeId));
  const qs = params.toString();

  return useQuery<AlayaPaginatedResponse<Visit>>({
    queryKey: ["visits", options],
    queryFn: async () => {
      const res = await apiFetch(`/api/visits${qs ? `?${qs}` : ""}`);
      if (!res.ok) throw new Error("Failed to fetch visits");
      return res.json();
    },
  });
}

export function useVisitOffers(visitId: number | null) {
  return useQuery<AlayaPaginatedResponse<VisitOffer>>({
    queryKey: ["visit-offers", visitId],
    queryFn: async () => {
      const res = await apiFetch(`/api/visits/${visitId}/offers`);
      if (!res.ok) throw new Error("Failed to fetch visit offers");
      return res.json();
    },
    enabled: visitId !== null,
  });
}

export function useCreateVisit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      client_id: number;
      employee_id: number;
      start_at: string;
      end_at: string;
      service_id?: number;
      service_instructions?: string;
    }) => {
      const res = await apiFetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create visit");
      return res.json();
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["visits"] });
    },
  });
}

export function useCreateOffer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { visitId: number; employeeId: number }) => {
      const res = await apiFetch(`/api/visits/${data.visitId}/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: data.employeeId }),
      });
      if (!res.ok) throw new Error("Failed to create offer");
      return res.json();
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["visit-offers", variables.visitId],
      });
    },
  });
}
