import { logger } from "@/src/lib/logger";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";
import { handleVisitVacated } from "./handle-visit-vacated";

export async function handleVisitCreated(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { visit_id, employee_id, status } = event.payload;

  logger.info({ traceId, visitId: visit_id }, "New visit created");

  // P1.6.1: If visit is created without an employee (vacant), treat as vacated
  if (employee_id == null || status === "vacant") {
    logger.info({ traceId, visitId: visit_id }, "Visit created as vacant — triggering scoring");
    return handleVisitVacated(event, traceId);
  }

  return { visit_id, status: "logged" };
}
