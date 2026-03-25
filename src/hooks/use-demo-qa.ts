"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";

export interface QaPattern {
  id: string;
  responseId: string;
  pattern: string;
  isCanonical: number;
  createdAt: string;
}

export interface QaPair {
  id: string;
  category: string;
  label: string;
  answerText: string;
  audioUrl: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  patterns: QaPattern[];
}

export interface CreateQaPairInput {
  category: string;
  label: string;
  answerText: string;
  audioUrl?: string | null;
  sortOrder?: number;
  patterns: string[];
}

export interface UpdateQaPairInput {
  category?: string;
  label?: string;
  answerText?: string;
  audioUrl?: string | null;
  sortOrder?: number;
  patterns?: string[];
}

const QA_KEY = ["demo-qa"];

export function useDemoQa() {
  return useQuery<QaPair[]>({
    queryKey: QA_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/demo/qa");
      if (!res.ok) throw new Error("Failed to fetch QA pairs");
      return res.json();
    },
  });
}

export function useCreateQaPair() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateQaPairInput) => {
      const res = await apiFetch("/api/demo/qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message || "Failed to create QA pair");
      }
      return res.json() as Promise<QaPair>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QA_KEY });
    },
  });
}

export function useUpdateQaPair() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateQaPairInput }) => {
      const res = await apiFetch(`/api/demo/qa/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error?.message || "Failed to update QA pair");
      }
      return res.json() as Promise<QaPair>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QA_KEY });
    },
  });
}

export function useDeleteQaPair() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const res = await apiFetch(`/api/demo/qa/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete QA pair");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QA_KEY });
    },
  });
}
