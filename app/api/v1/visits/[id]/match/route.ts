import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleAppError, ValidationError } from "@/src/server/errors";
import { computeMatch, type MatchConfig } from "@/src/services/scoring";

/**
 * Match scoring endpoint for a visit.
 * Calls computeMatch directly (no UoW/makeDeps) because scoring is pure
 * computation over AlayaCare data — no DB writes needed. This matches
 * the existing AlayaCare passthrough pattern in visits/route.ts.
 */

const WeightsSchema = z.object({
  skills: z.number().min(0).max(1),
  relationship: z.number().min(0).max(1),
  proximity: z.number().min(0).max(1),
  workload: z.number().min(0).max(1),
  acceptance: z.number().min(0).max(1),
}).refine(
  (w) => Math.abs(w.skills + w.relationship + w.proximity + w.workload + w.acceptance - 1.0) < 0.001,
  { message: "Weights must sum to 1.0" }
);

const MatchRequestSchema = z.object({
  weights: WeightsSchema.optional(),
  preset: z.enum(["planned", "urgent", "high_value_client", "new_client", "efficiency"]).optional(),
  limit: z.number().int().min(1).max(50).optional(),
}).refine(
  (d) => !(d.weights && d.preset),
  { message: "Provide either weights or preset, not both" }
);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    await requireAuthContext(request, traceId);

    const { id } = await params;
    const visitId = Number(id);
    if (!Number.isInteger(visitId) || visitId <= 0) {
      return handleAppError(
        { issues: [{ message: "Visit ID must be a positive integer", path: ["id"] }] },
        traceId
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError("Invalid JSON body");
    }
    const parsed = MatchRequestSchema.parse(body);

    const config: MatchConfig = {};
    if (parsed.weights) config.weights = parsed.weights;
    if (parsed.preset) config.preset = parsed.preset;
    if (parsed.limit) config.limit = parsed.limit;

    const result = await computeMatch(visitId, config);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
