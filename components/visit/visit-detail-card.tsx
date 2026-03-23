"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CalendarClock,
  Clock,
  UserRound,
  User,
  LogIn,
  LogOut,
  FileText,
} from "lucide-react";
import { useVisit } from "@/src/hooks/use-visit";
import { getShiftStatus, STATUS_COLORS } from "@/src/lib/visit-status";

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DetailRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | null;
}) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex flex-col">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-sm font-medium">{value ?? "—"}</span>
      </div>
    </div>
  );
}

export function VisitDetailCard({ visitId }: { visitId: number }) {
  const { data: visit, isLoading, error } = useVisit(visitId);

  if (isLoading) {
    return <Skeleton className="h-64 w-full" />;
  }

  if (error || !visit) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-destructive">
            Failed to load visit details. The visit may not exist.
          </p>
        </CardContent>
      </Card>
    );
  }

  const shiftStatus = getShiftStatus(visit);
  const statusColor =
    STATUS_COLORS[shiftStatus.variant] ?? STATUS_COLORS.on_hold;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Visit Details</CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={STATUS_COLORS[visit.status] ?? STATUS_COLORS.on_hold}>
              {visit.status}
            </Badge>
            <Badge className={statusColor}>{shiftStatus.label}</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <DetailRow
            icon={CalendarClock}
            label="Scheduled"
            value={formatDateTime(visit.start_at)}
          />
          <DetailRow
            icon={Clock}
            label="Duration"
            value={`${formatTime(visit.start_at)} – ${formatTime(visit.end_at)}`}
          />
          <DetailRow
            icon={UserRound}
            label="Client"
            value={visit.client_id ? `Client #${visit.client_id}` : null}
          />
          <DetailRow
            icon={User}
            label="Employee"
            value={
              visit.employee_id ? `Employee #${visit.employee_id}` : "Unassigned"
            }
          />
          <DetailRow
            icon={LogIn}
            label="Clock In"
            value={visit.clock_in ? formatDateTime(visit.clock_in) : null}
          />
          <DetailRow
            icon={LogOut}
            label="Clock Out"
            value={visit.clock_out ? formatDateTime(visit.clock_out) : null}
          />
        </div>

        {visit.service_instructions && (
          <div className="flex items-start gap-3 pt-2 border-t">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex flex-col">
              <span className="text-xs text-muted-foreground">
                Service Instructions
              </span>
              <span className="text-sm">{visit.service_instructions}</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
