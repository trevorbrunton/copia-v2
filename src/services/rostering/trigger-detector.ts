import { alayaFetch } from "@/src/lib/alayacare-client";
import type { AlayaPaginatedResponse } from "@/src/lib/alayacare-client";
import { rosterTasks } from "@/src/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import type { TransactionClient } from "@/src/lib/tenant";
import { logger } from "@/src/lib/logger";

interface AlayaVisit {
  id: number;
  status: string;
  employee_id: number | null;
  start_at: string;
  end_at: string;
}

export interface DetectionResult {
  newVisits: number[];
  alreadyTracked: number[];
}

/**
 * Polling fallback — checks AlayaCare for vacant visits not yet tracked.
 *
 * Used when webhooks are unavailable or as a safety net.
 * Designed to be called by Vercel Cron or pg_cron.
 */
export async function detectNewTriggers(
  tx: TransactionClient,
  userId: string,
): Promise<DetectionResult> {
  // Fetch recent vacant visits from AlayaCare
  const response = await alayaFetch<AlayaPaginatedResponse<AlayaVisit>>(
    "/scheduler/visits",
    { searchParams: { status: "vacant", per_page: "50" } },
  );

  const vacantVisitIds = response.items.map((v) => v.id);

  if (vacantVisitIds.length === 0) {
    return { newVisits: [], alreadyTracked: [] };
  }

  // Find which visits already have active roster tasks
  const existingTasks = await tx
    .select({ visitId: rosterTasks.visitId })
    .from(rosterTasks)
    .where(and(
      eq(rosterTasks.userId, userId),
      inArray(rosterTasks.visitId, vacantVisitIds),
      inArray(rosterTasks.status, [
        "detected", "gathering", "scoring", "reasoning",
        "contacting", "cascading", "accepted",
      ]),
    ));

  const trackedVisitIds = new Set(existingTasks.map((t) => t.visitId));
  const newVisits = vacantVisitIds.filter((id) => !trackedVisitIds.has(id));
  const alreadyTracked = vacantVisitIds.filter((id) => trackedVisitIds.has(id));

  logger.info(
    { newCount: newVisits.length, trackedCount: alreadyTracked.length },
    "Trigger detection complete"
  );

  return { newVisits, alreadyTracked };
}
