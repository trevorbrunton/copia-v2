"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { MatchResult, WeightConfig, PresetName } from "@/src/services/scoring";

export interface UseMatchOptions {
  preset?: PresetName;
  weights?: WeightConfig;
  limit?: number;
  enabled?: boolean;
}

/** Build the fetch options for the match endpoint. Exported for testing. */
export function buildMatchFetchOptions(options: Omit<UseMatchOptions, "enabled">) {
  const body: Record<string, unknown> = {};
  if (options.preset !== undefined) body.preset = options.preset;
  if (options.weights !== undefined) body.weights = options.weights;
  if (options.limit !== undefined) body.limit = options.limit;

  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export function useMatch(visitId: number | null, options: UseMatchOptions = {}) {
  const { enabled = true, ...matchOptions } = options;

  return useQuery<MatchResult>({
    queryKey: ["match", visitId, matchOptions],
    queryFn: async () => {
      const fetchOptions = buildMatchFetchOptions(matchOptions);
      const res = await apiFetch(`/api/visits/${visitId}/match`, fetchOptions);
      if (!res.ok) throw new Error("Failed to fetch match results");
      return res.json();
    },
    enabled: enabled && visitId !== null,
  });
}
