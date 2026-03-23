"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { RosterAuditLogEntry } from "@/src/db/schema";

interface AuditSearchResult {
  items: RosterAuditLogEntry[];
  total: number;
  limit: number;
  offset: number;
}

export function useRosterAudit(params: {
  task_id?: string;
  action?: string;
  actor?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  offset?: number;
  enabled?: boolean;
}) {
  const qs = new URLSearchParams();
  if (params.task_id) qs.set("task_id", params.task_id);
  if (params.action) qs.set("action", params.action);
  if (params.actor) qs.set("actor", params.actor);
  if (params.from_date) qs.set("from_date", params.from_date);
  if (params.to_date) qs.set("to_date", params.to_date);
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.offset) qs.set("offset", String(params.offset));

  const queryString = qs.toString();

  return useQuery<AuditSearchResult>({
    queryKey: ["roster-audit", queryString],
    queryFn: async () => {
      const res = await apiFetch(`/api/roster/audit${queryString ? `?${queryString}` : ""}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? "Failed to fetch audit log");
      }
      return res.json();
    },
    enabled: params.enabled !== false,
  });
}
