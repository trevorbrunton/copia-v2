"use client";

import { useState } from "react";
import Link from "next/link";
import { useDebouncedValue } from "@/src/hooks/use-debounce";
import { CalendarClock, Clock, User, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useVisits, type Visit } from "@/src/hooks/use-visits";
import { STATUS_COLORS } from "@/src/lib/visit-status";

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
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

function VisitCard({ visit }: { visit: Visit }) {
  const statusColor = STATUS_COLORS[visit.status] ?? STATUS_COLORS.on_hold;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Badge className={statusColor}>{visit.status}</Badge>
          <span className="text-xs text-muted-foreground">#{visit.id}</span>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>{formatDateTime(visit.start_at)}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              {formatTime(visit.start_at)} &ndash; {formatTime(visit.end_at)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
            <span>Client #{visit.client_id ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <User className="h-3.5 w-3.5 text-muted-foreground" />
            <span>
              {visit.employee_id
                ? `Employee #${visit.employee_id}`
                : "Unassigned"}
            </span>
          </div>
        </div>

        {visit.service_instructions && (
          <p className="text-xs text-muted-foreground line-clamp-2">
            {visit.service_instructions}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function VisitsPage() {
  const [statusFilter, setStatusFilter] = useState<string>("");
  const debouncedStatus = useDebouncedValue(statusFilter, 300);

  const { data, isLoading, error } = useVisits(
    debouncedStatus ? { status: debouncedStatus } : undefined
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Visits</h1>
        <p className="text-muted-foreground mt-1">
          Browse and manage scheduled visits from AlayaCare.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter by status (e.g. scheduled, vacant)..."
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="max-w-sm"
        />
        {data && (
          <span className="text-sm text-muted-foreground">
            {data.count} visit{data.count !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {isLoading && (
        <p className="text-muted-foreground">Loading visits...</p>
      )}
      {error && (
        <p className="text-destructive">
          Failed to load visits. Please try again later.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {data?.items.map((visit) => (
          <Link key={visit.id} href={`/visits/${visit.id}`}>
            <VisitCard visit={visit} />
          </Link>
        ))}
      </div>

      {data && data.items.length === 0 && (
        <p className="text-muted-foreground text-center py-8">
          No visits found.
        </p>
      )}
    </div>
  );
}
