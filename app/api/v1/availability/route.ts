import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthContext } from "@/src/server/require-auth-context";
import {
  handleAppError,
  ValidationError,
  NotFoundError,
} from "@/src/server/errors";
import { alayaFetch, type AlayaPaginatedResponse } from "@/src/lib/alayacare-client";
import { computeMatch, type MatchConfig } from "@/src/services/scoring";

/**
 * Combined availability query endpoint.
 * Accepts client_id + date (+ optional skills/preset) and returns
 * scored caregiver rankings for the first matching visit.
 *
 * Fulfills R3.1: "Find all available caregivers for [client] on [date/time]
 * with [qualifications]"
 */

const AvailabilityRequestSchema = z.object({
  client_id: z.number().int().positive(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format"),
  preset: z
    .enum(["planned", "urgent", "high_value_client", "new_client", "efficiency"])
    .optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

interface VisitSummary {
  id: number;
  client_id: number;
  start_at: string;
  end_at: string;
}

export async function POST(request: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    await requireAuthContext(request, traceId);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Invalid JSON body");
    }

    const parsed = AvailabilityRequestSchema.parse(body);

    // Find visits for this client on the given date
    const visits = await alayaFetch<AlayaPaginatedResponse<VisitSummary>>(
      "/scheduler/visits",
      {
        searchParams: {
          client_id: String(parsed.client_id),
          date: parsed.date,
        },
      }
    );

    if (visits.items.length === 0) {
      throw new NotFoundError("No matching visits found for the given criteria");
    }

    // Score against the first visit found
    const targetVisit = visits.items[0];
    const config: MatchConfig = {};
    if (parsed.preset) config.preset = parsed.preset;
    if (parsed.limit) config.limit = parsed.limit;

    const result = await computeMatch(targetVisit.id, config);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
