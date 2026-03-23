"use client";

import { useParams } from "next/navigation";
import { useRosterTask } from "@/src/hooks/use-roster-tasks";
import { useBreadcrumbLabel } from "@/components/breadcrumb-context";
import { AuditTimeline } from "@/components/rostering/audit-timeline";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RosterAuditLogEntry } from "@/src/db/schema";

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  detected: "secondary",
  gathering: "secondary",
  scoring: "secondary",
  reasoning: "secondary",
  contacting: "default",
  cascading: "outline",
  accepted: "default",
  assigned: "default",
  escalated: "destructive",
  completed: "default",
  cancelled: "destructive",
};

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export default function TaskDetailPage() {
  const params = useParams<{ id: string }>();
  const { data: task, isLoading, error } = useRosterTask(params.id ?? null);

  useBreadcrumbLabel(task ? `Task ${task.visitId}` : "");

  if (isLoading) return <div className="p-6">Loading task...</div>;
  if (error) return <div className="p-6 text-red-600">Error: {error.message}</div>;
  if (!task) return <div className="p-6">Task not found.</div>;

  const recommendation = task.llmRecommendation as {
    primary?: { employee_name: string; employee_id: number; explanation: string; confidence: string };
    factors_considered?: string[];
    trade_offs?: string[];
  } | null;

  const contacts = (task.contacts ?? []) as Array<{
    employee_id: number;
    employee_name: string;
    response: string;
    contacted_at?: string;
    responded_at?: string;
    decline_reason?: string;
  }>;

  const auditTrail = ((task as unknown as Record<string, unknown>).auditTrail ?? []) as RosterAuditLogEntry[];

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Visit #{task.visitId}</h1>
        <Badge variant={STATUS_VARIANTS[task.status] ?? "outline"}>{task.status}</Badge>
        <Badge variant="outline">{task.urgency}</Badge>
      </div>

      {/* Task Summary */}
      <Card>
        <CardHeader>
          <CardTitle>Task Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <dt className="font-medium text-muted-foreground">Task ID</dt>
            <dd className="font-mono text-xs">{task.id}</dd>
            <dt className="font-medium text-muted-foreground">Client ID</dt>
            <dd>{task.clientId ?? "—"}</dd>
            <dt className="font-medium text-muted-foreground">Detected</dt>
            <dd>{task.detectedAt ? new Date(task.detectedAt).toLocaleString("en-AU") : "—"}</dd>
            <dt className="font-medium text-muted-foreground">Resolved</dt>
            <dd>{task.resolvedAt ? new Date(task.resolvedAt).toLocaleString("en-AU") : "—"}</dd>
            <dt className="font-medium text-muted-foreground">Time to Fill</dt>
            <dd>{formatMs(task.timeToFillMs)}</dd>
            {task.assignedEmployeeId && (
              <>
                <dt className="font-medium text-muted-foreground">Assigned Employee</dt>
                <dd>{task.assignedEmployeeId}</dd>
              </>
            )}
            {task.escalationReason && (
              <>
                <dt className="font-medium text-muted-foreground">Escalation Reason</dt>
                <dd className="text-destructive">{task.escalationReason}</dd>
              </>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* LLM Recommendation */}
      {recommendation?.primary && (
        <Card>
          <CardHeader>
            <CardTitle>AI Recommendation</CardTitle>
            <CardDescription>
              Confidence: {recommendation.primary.confidence}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <span className="font-medium">Recommended:</span>{" "}
              {recommendation.primary.employee_name} (ID: {recommendation.primary.employee_id})
            </div>
            <p className="text-sm text-muted-foreground">{recommendation.primary.explanation}</p>
            {recommendation.factors_considered && recommendation.factors_considered.length > 0 && (
              <div>
                <span className="text-sm font-medium">Factors:</span>
                <ul className="list-disc list-inside text-sm text-muted-foreground">
                  {recommendation.factors_considered.map((f, i) => <li key={i}>{f}</li>)}
                </ul>
              </div>
            )}
            {recommendation.trade_offs && recommendation.trade_offs.length > 0 && (
              <div>
                <span className="text-sm font-medium">Trade-offs:</span>
                <ul className="list-disc list-inside text-sm text-muted-foreground">
                  {recommendation.trade_offs.map((t, i) => <li key={i}>{t}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Contact History */}
      {contacts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Contact History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {contacts.map((c, i) => (
                <div key={i} className="flex items-center gap-3 text-sm border-b last:border-0 pb-2">
                  <span className="font-medium">{c.employee_name}</span>
                  <Badge variant={c.response === "accepted" ? "default" : c.response === "pending" ? "secondary" : "outline"}>
                    {c.response}
                  </Badge>
                  {c.decline_reason && (
                    <span className="text-muted-foreground text-xs">({c.decline_reason})</span>
                  )}
                  {c.contacted_at && (
                    <span className="text-muted-foreground text-xs ml-auto">
                      {new Date(c.contacted_at).toLocaleString("en-AU")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Audit Trail */}
      <Card>
        <CardHeader>
          <CardTitle>Audit Trail</CardTitle>
          <CardDescription>{auditTrail.length} entries</CardDescription>
        </CardHeader>
        <CardContent>
          <AuditTimeline entries={auditTrail} />
        </CardContent>
      </Card>
    </div>
  );
}
