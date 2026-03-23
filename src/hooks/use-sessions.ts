"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";

interface Device {
  id: string;
  userId: string;
  deviceFingerprint: string;
  deviceName: string | null;
  deviceType: string | null;
  os: string | null;
  browser: string | null;
  trusted: number;
  lastIp: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

interface Session {
  id: string;
  userId: string;
  deviceId: string | null;
  status: string;
  ipAddress: string | null;
  userAgent: string | null;
  startedAt: string;
  lastActiveAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedReason: string | null;
  createdAt: string;
  device: Device | null;
}

export function useSessions() {
  return useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: async () => {
      const res = await apiFetch("/api/user/sessions");
      if (!res.ok) throw new Error("Failed to fetch sessions");
      return res.json();
    },
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      const res = await apiFetch(`/api/user/sessions/${sessionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to revoke session");
    },
    onMutate: async (sessionId) => {
      await queryClient.cancelQueries({ queryKey: ["sessions"] });
      const previous = queryClient.getQueryData<Session[]>(["sessions"]);
      queryClient.setQueryData<Session[]>(["sessions"], (old) =>
        old?.filter((s) => s.id !== sessionId)
      );
      return { previous };
    },
    onError: (_err, _sessionId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["sessions"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

// Bulk revoke uses onSuccess (not optimistic) — predicting the remaining set is complex
export function useRevokeAllSessions() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (currentSessionId?: string) => {
      const res = await apiFetch("/api/user/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentSessionId }),
      });
      if (!res.ok) throw new Error("Failed to revoke sessions");
      return res.json() as Promise<{ revoked: number }>;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useDevices() {
  return useQuery<Device[]>({
    queryKey: ["devices"],
    queryFn: async () => {
      const res = await apiFetch("/api/user/devices");
      if (!res.ok) throw new Error("Failed to fetch devices");
      return res.json();
    },
  });
}

export function useRemoveDevice() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (deviceId: string) => {
      const res = await apiFetch(`/api/user/devices/${deviceId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove device");
    },
    onMutate: async (deviceId) => {
      await queryClient.cancelQueries({ queryKey: ["devices"] });
      const previous = queryClient.getQueryData<Device[]>(["devices"]);
      queryClient.setQueryData<Device[]>(["devices"], (old) =>
        old?.filter((d) => d.id !== deviceId)
      );
      return { previous };
    },
    onError: (_err, _deviceId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["devices"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["devices"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });
}

export function useLoginHistory(limit = 20, enabled = true) {
  return useQuery<Session[]>({
    queryKey: ["login-history", limit],
    queryFn: async () => {
      const res = await apiFetch(`/api/user/login-history?limit=${limit}`);
      if (!res.ok) throw new Error("Failed to fetch login history");
      return res.json();
    },
    enabled,
  });
}
