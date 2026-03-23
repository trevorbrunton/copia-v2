import type { Urgency, UrgencyConfig } from "./types";

export function classifyUrgency(visit: {
  start_at: string;
  service_instructions?: string;
}): Urgency {
  const hoursUntilShift =
    (new Date(visit.start_at).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntilShift < 4) return "urgent";
  if (visit.service_instructions?.includes("URGENT")) return "urgent";
  return "planned";
}

export function getUrgencyConfig(urgency: Urgency): UrgencyConfig {
  return urgency === "urgent"
    ? {
        weightPreset: "urgent",
        cascadeStrategy: "parallel",
        expiryMinutes: 20,
        escalationThreshold: { type: "time", minutes: 15 },
      }
    : {
        weightPreset: "planned",
        cascadeStrategy: "sequential",
        expiryMinutes: 120,
        escalationThreshold: { type: "contacts", count: 10 },
      };
}
