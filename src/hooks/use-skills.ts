"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { AlayaPaginatedResponse } from "@/src/lib/alayacare-client";

export interface Skill {
  id: number;
  name: string;
  category_id: number | null;
  branch_id: number | null;
  created_at: string;
}

export function useSkills() {
  return useQuery<AlayaPaginatedResponse<Skill>>({
    queryKey: ["skills"],
    queryFn: async () => {
      const res = await apiFetch("/api/skills");
      if (!res.ok) throw new Error("Failed to fetch skills");
      return res.json();
    },
  });
}
