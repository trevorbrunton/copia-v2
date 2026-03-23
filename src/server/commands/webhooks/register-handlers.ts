/**
 * Register all webhook event handlers with the dispatcher.
 * Import this file in the webhook route to ensure handlers are registered.
 */
import { registerHandler } from "@/src/lib/alayacare-events/dispatcher";
import { handleVisitVacated } from "./handle-visit-vacated";
import { handleVisitCreated } from "./handle-visit-created";
import { handleVisitCancelled } from "./handle-visit-cancelled";
import { handleVisitUpdated } from "./handle-visit-updated";
import { handleEmployeeStatusChanged } from "./handle-employee-status-changed";
import { handleEmployeeUnavailability } from "./handle-employee-unavailability";
import { handleClientCreated } from "./handle-client-created";

registerHandler("visit.vacated", handleVisitVacated);
registerHandler("visit.created", handleVisitCreated);
registerHandler("visit.cancelled", handleVisitCancelled);
registerHandler("visit.updated", handleVisitUpdated);
registerHandler("employee.status_changed", handleEmployeeStatusChanged);
registerHandler("employee.unavailability.created", handleEmployeeUnavailability);
registerHandler("client.created", handleClientCreated);
