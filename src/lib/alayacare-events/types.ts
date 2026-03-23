import { z } from "zod";

export const AlayaCareEventSchema = z.object({
  event_id: z.string().uuid(),
  event_type: z.enum([
    "visit.created",
    "visit.updated",
    "visit.vacated",
    "visit.cancelled",
    "employee.created",
    "employee.status_changed",
    "employee.unavailability.created",
    "client.created",
    "service.created",
  ]),
  timestamp: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  metadata: z.object({
    source: z.enum(["simulation", "lambda"]),
    trace_id: z.string().min(1),
    scenario: z.string().optional(),
  }),
});

export type AlayaCareEvent = z.infer<typeof AlayaCareEventSchema>;
