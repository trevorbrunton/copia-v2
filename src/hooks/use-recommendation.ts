"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";
import type { MatchResult, WeightConfig, PresetName } from "@/src/services/scoring";
import type { LLMRecommendation } from "@/src/services/reasoning";

export interface RecommendationResponse {
  match_result: MatchResult;
  recommendation: LLMRecommendation;
}

export interface UseRecommendationOptions {
  preset?: PresetName;
  weights?: WeightConfig;
  limit?: number;
  enabled?: boolean;
}

/** Build the fetch options for the recommend endpoint. Exported for testing. */
export function buildRecommendFetchOptions(options: Omit<UseRecommendationOptions, "enabled">) {
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

export function useRecommendation(visitId: number | null, options: UseRecommendationOptions = {}) {
  const { enabled = true, ...requestOptions } = options;

  return useQuery<RecommendationResponse>({
    queryKey: ["recommendation", visitId, requestOptions],
    queryFn: async () => {
      const fetchOptions = buildRecommendFetchOptions(requestOptions);
      const res = await apiFetch(`/api/visits/${visitId}/recommend`, fetchOptions);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? "Failed to get recommendation");
      }
      return res.json();
    },
    enabled: enabled && visitId !== null,
  });
}
