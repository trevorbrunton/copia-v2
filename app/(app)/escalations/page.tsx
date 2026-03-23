"use client";

import { useEscalations, useHumanAction } from "@/src/hooks/use-escalations";
import { EscalationCard } from "@/components/rostering/escalation-card";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export default function EscalationsPage() {
  const { data: escalations, isLoading, error: fetchError, refetch } = useEscalations();
  const humanAction = useHumanAction();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Escalations</h1>
          <p className="text-muted-foreground mt-1">
            Shifts requiring human intervention — urgent first
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-1" />
          Refresh
        </Button>
      </div>

      {isLoading && (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Loading escalations...
        </div>
      )}

      {fetchError && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 p-4 text-sm text-red-800 dark:text-red-200">
          Failed to load escalations: {fetchError.message}
        </div>
      )}

      {humanAction.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950 dark:border-red-800 p-4 text-sm text-red-800 dark:text-red-200">
          Action failed: {humanAction.error.message}
        </div>
      )}

      {!isLoading && !fetchError && (!escalations || escalations.length === 0) && (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No escalated tasks — all shifts are being handled autonomously
        </div>
      )}

      <div className="space-y-4">
        {escalations?.map((task) => (
          <EscalationCard
            key={task.id}
            task={task}
            onAction={(action, extra) =>
              humanAction.mutate({ taskId: task.id, action, ...extra })
            }
            isActing={humanAction.isPending}
          />
        ))}
      </div>
    </div>
  );
}
