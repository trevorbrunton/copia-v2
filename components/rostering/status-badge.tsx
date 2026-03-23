"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/src/lib/utils";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  detected: { label: "Detected", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  gathering: { label: "Gathering", className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  scoring: { label: "Scoring", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  reasoning: { label: "Reasoning", className: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200" },
  contacting: { label: "Contacting", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  cascading: { label: "Cascading", className: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200" },
  accepted: { label: "Accepted", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  assigned: { label: "Assigned", className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  escalated: { label: "Escalated", className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
  completed: { label: "Completed", className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
  cancelled: { label: "Cancelled", className: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200" },
};

export function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, className: "" };
  return (
    <Badge variant="outline" className={cn("border-0", config.className)}>
      {config.label}
    </Badge>
  );
}

const URGENCY_CONFIG: Record<string, { label: string; className: string }> = {
  planned: { label: "Planned", className: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300" },
  urgent: { label: "Urgent", className: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" },
};

export function UrgencyBadge({ urgency }: { urgency: string }) {
  const config = URGENCY_CONFIG[urgency] ?? { label: urgency, className: "" };
  return (
    <Badge variant="outline" className={cn("border-0", config.className)}>
      {config.label}
    </Badge>
  );
}
