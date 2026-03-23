/**
 * Shared helper for building recommendation context from AlayaCare API data.
 * Used by both the recommend endpoint and the visit.vacated webhook handler.
 */
import type { VisitContext, ClientContext, ReasoningContext } from "@/src/services/reasoning";
import type { MatchResult, FetchedVisitDetail, FetchedClientDetail } from "@/src/services/scoring";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { ExternalServiceError } from "@/src/server/errors";

interface VisitDetail {
  id: number;
  client_id: number | null;
  start_at: string;
  end_at: string;
  status: string;
  service_instructions?: string | null;
}

interface ClientDetail {
  id: number;
  first_name: string;
  last_name: string;
  city?: string | null;
  state?: string | null;
}

export interface TaskHistory {
  previousAttempts: number;
  previousDeclineReasons: string[];
}

export interface EnrichedReasoningContext extends ReasoningContext {
  dataWarnings?: string[];
  taskHistory?: TaskHistory;
}

export interface RecommendationContextResult {
  visit: VisitContext;
  client: ClientContext | null;
  context: EnrichedReasoningContext;
}

/**
 * Fetch visit + client details from AlayaCare and build the context
 * needed by getRecommendation().
 *
 * P1.2.3: Enriched with data warnings from match result and optional task history.
 */
export async function buildRecommendationContext(
  visitId: number,
  matchResult: MatchResult,
  urgency: "planned" | "urgent",
  taskHistory?: TaskHistory,
): Promise<RecommendationContextResult> {
  if (!Number.isInteger(visitId) || visitId <= 0) {
    throw new ExternalServiceError(`Invalid visitId: ${visitId}`);
  }

  // Use pre-fetched data from matchResult when available (avoids redundant API calls)
  const prefetchedVisit: FetchedVisitDetail | undefined = matchResult.fetchedVisit;
  const prefetchedClient: FetchedClientDetail | undefined = matchResult.fetchedClient;

  let visitDetail: VisitDetail;
  if (prefetchedVisit) {
    visitDetail = {
      ...prefetchedVisit,
      status: prefetchedVisit.status ?? "unknown",
    };
  } else {
    try {
      visitDetail = await alayaFetch<VisitDetail>(`/scheduler/visits/${visitId}`);
    } catch (err) {
      throw new ExternalServiceError(
        err instanceof Error ? err.message : "Failed to fetch visit detail"
      );
    }
  }

  const visit: VisitContext = {
    id: visitId,
    start_at: visitDetail.start_at,
    end_at: visitDetail.end_at,
    status: visitDetail.status,
    service_instructions: visitDetail.service_instructions,
  };

  let client: ClientContext | null = null;
  if (matchResult.client_id != null) {
    if (prefetchedClient) {
      client = {
        first_name: prefetchedClient.first_name ?? "",
        last_name: prefetchedClient.last_name ?? "",
        city: prefetchedClient.city,
        state: prefetchedClient.state,
      };
    } else {
      try {
        const clientDetail = await alayaFetch<ClientDetail>(
          `/patients/clients/${matchResult.client_id}`
        );
        client = {
          first_name: clientDetail.first_name,
          last_name: clientDetail.last_name,
          city: clientDetail.city,
          state: clientDetail.state,
        };
      } catch (err) {
        throw new ExternalServiceError(
          err instanceof Error ? err.message : "Failed to fetch client detail"
        );
      }
    }
  }

  const context: EnrichedReasoningContext = {
    urgency,
    dataWarnings: matchResult.data_warnings?.length > 0 ? matchResult.data_warnings : undefined,
    taskHistory: taskHistory ?? undefined,
  };

  return { visit, client, context };
}
