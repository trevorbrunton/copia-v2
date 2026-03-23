"use client";

import { useState } from "react";
import type { RosterTask } from "@/src/db/schema";
import type { MatchResult } from "@/src/services/scoring/types";
import type { LLMRecommendation } from "@/src/services/reasoning/types";
import type { ContactAttempt } from "@/src/services/rostering/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge, UrgencyBadge } from "./status-badge";
import { CandidateList } from "./candidate-list";
import { Clock, CheckCircle, XCircle, Pause, UserCheck } from "lucide-react";

function formatElapsed(detectedAt: Date | string): string {
  const ms = Date.now() - new Date(detectedAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m ago`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h ago`;
}

export function EscalationCard({
  task,
  onAction,
  isActing,
}: {
  task: RosterTask;
  onAction: (action: string, extra?: { employee_id?: number; reason?: string }) => void;
  isActing: boolean;
}) {
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const matchResult = task.matchResult as MatchResult | null;
  const recommendation = task.llmRecommendation as LLMRecommendation | null;
  const contacts = (task.contacts ?? []) as ContactAttempt[];
  const candidates = matchResult?.candidates ?? [];

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <StatusBadge status={task.status} />
              <UrgencyBadge urgency={task.urgency} />
              <span className="text-sm text-muted-foreground">
                Visit #{task.visitId}
                {task.clientId ? ` — Client #${task.clientId}` : ""}
              </span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {task.detectedAt ? formatElapsed(task.detectedAt) : "—"}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Escalation reason */}
          {task.escalationReason && (
            <div className="text-sm bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded p-3">
              <span className="font-medium">Reason:</span> {task.escalationReason}
            </div>
          )}

          {/* LLM Recommendation */}
          {recommendation && !("_tag" in recommendation) && (
            <div className="text-sm bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded p-3">
              <span className="font-medium">AI Recommendation:</span>{" "}
              {recommendation.primary.employee_name} (ID: {recommendation.primary.employee_id})
              {recommendation.primary.explanation && (
                <p className="mt-1 text-muted-foreground">{recommendation.primary.explanation}</p>
              )}
            </div>
          )}

          {/* Contact history */}
          {contacts.length > 0 && (
            <div className="text-sm">
              <span className="font-medium">Contact history:</span>{" "}
              {contacts.filter((c) => c.response === "declined").length} declined,{" "}
              {contacts.filter((c) => c.response === "expired").length} expired,{" "}
              {contacts.filter((c) => c.response === "pending").length} pending
            </div>
          )}

          {/* Candidate list */}
          {candidates.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Scored Candidates</h4>
              <CandidateList
                candidates={candidates}
                onAssign={(id) => onAction("assign_manually", { employee_id: id })}
                isAssigning={isActing}
              />
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2 border-t">
            <Button
              size="sm"
              onClick={() => onAction("accept_recommendation")}
              disabled={isActing || !recommendation}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Accept AI Pick
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("defer")}
              disabled={isActing}
            >
              <Pause className="h-4 w-4 mr-1" />
              Defer
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onAction("take_over")}
              disabled={isActing}
            >
              <UserCheck className="h-4 w-4 mr-1" />
              Take Over
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => setCancelOpen(true)}
              disabled={isActing}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Cancel
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Task</DialogTitle>
            <DialogDescription>
              Provide a reason for cancelling this escalation (Visit #{task.visitId}).
            </DialogDescription>
          </DialogHeader>
          <Input
            placeholder="Cancellation reason"
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            autoFocus
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelOpen(false)}>
              Back
            </Button>
            <Button
              variant="destructive"
              disabled={!cancelReason.trim()}
              onClick={() => {
                onAction("cancel", { reason: cancelReason.trim() });
                setCancelOpen(false);
                setCancelReason("");
              }}
            >
              Confirm Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
