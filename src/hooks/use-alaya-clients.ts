"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { AlayaPaginatedResponse } from "@/src/lib/alayacare-client";

export interface AlayaClient {
  id: number;
  external_id: string | null;
  first_name: string;
  last_name: string;
  gender: string | null;
  email: string | null;
  phone_main: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  status: string;
  care_needs: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export function useAlayaClients(search?: string, status?: string) {
  const params = new URLSearchParams();
  if (search) params.set("filter", search);
  if (status) params.set("status", status);
  const qs = params.toString();

  return useQuery<AlayaPaginatedResponse<AlayaClient>>({
    queryKey: ["alaya-clients", search, status],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/alaya-clients${qs ? `?${qs}` : ""}`
      );
      if (!res.ok) throw new Error("Failed to fetch clients");
      return res.json();
    },
  });
}
