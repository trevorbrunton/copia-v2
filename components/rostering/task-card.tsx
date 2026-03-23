"use client";

import type { RosterTask } from "@/src/db/schema";
import type { ContactAttempt } from "@/src/services/rostering/types";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { StatusBadge, UrgencyBadge } from "./status-badge";
import { Clock, User, Phone } from "lucide-react";

function formatElapsed(detectedAt: Date | string): string {
  const ms = Date.now() - new Date(detectedAt).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m`;
  return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
}

export function TaskCard({ task }: { task: RosterTask }) {
  const contacts = (task.contacts ?? []) as ContactAttempt[];
  const currentContact = contacts[task.currentContactIndex ?? 0];

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusBadge status={task.status} />
            <UrgencyBadge urgency={task.urgency} />
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {task.detectedAt ? formatElapsed(task.detectedAt) : "—"}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="text-sm">
          <span className="text-muted-foreground">Visit</span>{" "}
          <span className="font-medium">#{task.visitId}</span>
          {task.clientId && (
            <>
              {" — "}
              <span className="text-muted-foreground">Client</span>{" "}
              <span className="font-medium">#{task.clientId}</span>
            </>
          )}
        </div>

        {currentContact && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <User className="h-3 w-3" />
            <span>{currentContact.employee_name}</span>
            <Phone className="h-3 w-3 ml-1" />
            <span>{currentContact.response}</span>
          </div>
        )}

        {contacts.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {contacts.filter((c) => c.response === "declined" || c.response === "expired").length} of{" "}
            {contacts.length} contacts attempted
          </div>
        )}

        {task.escalationReason && (
          <div className="text-xs text-red-600 dark:text-red-400">
            {task.escalationReason}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
