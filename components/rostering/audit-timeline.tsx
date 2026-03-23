"use client";

import type { RosterAuditLogEntry } from "@/src/db/schema";
import { Badge } from "@/components/ui/badge";

const ACTION_LABELS: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  task_created: { label: "Created", variant: "default" },
  detected_to_gathering: { label: "Gathering Data", variant: "secondary" },
  gathering_to_scoring: { label: "Scoring", variant: "secondary" },
  scoring_to_reasoning: { label: "Reasoning", variant: "secondary" },
  reasoning_to_contacting: { label: "Contacting", variant: "default" },
  reasoning_to_completed: { label: "Completed (Dry Run)", variant: "default" },
  contacting_to_cascading: { label: "Cascading", variant: "outline" },
  accepted_to_completed: { label: "Write-back Complete", variant: "default" },
  human_accept_recommendation: { label: "Human Accepted", variant: "default" },
  human_assign_manually: { label: "Manual Assignment", variant: "default" },
  human_take_over: { label: "Human Takeover", variant: "destructive" },
  human_cancel: { label: "Cancelled by Human", variant: "destructive" },
  human_defer: { label: "Deferred", variant: "outline" },
  visit_cancelled: { label: "Visit Cancelled", variant: "destructive" },
  visit_updated_rescore: { label: "Re-scored", variant: "secondary" },
  employee_terminated_cascade: { label: "Employee Left", variant: "destructive" },
  employee_unavailable_cascade: { label: "Employee Unavailable", variant: "outline" },
  auto_escalate: { label: "Auto-Escalated", variant: "destructive" },
};

function formatTimestamp(ts: string | Date): string {
  const d = new Date(ts);
  return d.toLocaleString("en-AU", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export function AuditTimeline({ entries }: { entries: RosterAuditLogEntry[] }) {
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No audit entries.</p>;
  }

  return (
    <div className="space-y-3">
      {entries.map((entry) => {
        const actionMeta = ACTION_LABELS[entry.action] ?? { label: entry.action, variant: "outline" as const };
        const details = entry.details as Record<string, unknown> | null;

        return (
          <div key={entry.id} className="flex gap-3 border-l-2 border-muted pl-4 py-1">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={actionMeta.variant}>{actionMeta.label}</Badge>
                <span className="text-xs text-muted-foreground">
                  by {entry.actor}
                </span>
                <span className="text-xs text-muted-foreground ml-auto">
                  {formatTimestamp(entry.timestamp)}
                </span>
              </div>
              {entry.reasoning && (
                <p className="text-sm text-muted-foreground mt-1">{entry.reasoning}</p>
              )}
              {details && Object.keys(details).length > 0 && (
                <details className="mt-1">
                  <summary className="text-xs text-muted-foreground cursor-pointer">Details</summary>
                  <pre className="text-xs mt-1 p-2 bg-muted rounded overflow-auto max-h-32">
                    {JSON.stringify(details, null, 2)}
                  </pre>
                </details>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
