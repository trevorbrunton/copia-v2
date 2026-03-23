"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";

interface User {
  id: string;
  email: string;
  name: string | null;
  status: string;
  avatarUrl: string | null;
  timezone: string;
  locale: string;
  lastLoginAt: string | null;
  loginCount: number;
  createdAt: string;
}

export function useUser() {
  return useQuery<User>({
    queryKey: ["user"],
    queryFn: async () => {
      const res = await apiFetch("/api/user");
      if (!res.ok) throw new Error("Failed to fetch user");
      return res.json();
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      name?: string;
      avatarUrl?: string;
      timezone?: string;
      locale?: string;
    }) => {
      const res = await apiFetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update user");
      return res.json();
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(["user"], updatedUser);
    },
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/user/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) throw new Error("Failed to delete account");
      return res.json() as Promise<{ ok: boolean; purgeAfter: string }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}
