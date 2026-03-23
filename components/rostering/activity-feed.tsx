"use client";

import type { RosterTask } from "@/src/db/schema";
import { StatusBadge } from "./status-badge";

function formatTime(date: Date | string): string {
  return new Date(date).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

interface ActivityItem {
  taskId: string;
  visitId: number;
  status: string;
  updatedAt: Date | string;
}

export function ActivityFeed({ tasks }: { tasks: RosterTask[] }) {
  // Sort by most recently updated, take top 20
  const items: ActivityItem[] = tasks
    .map((t) => ({
      taskId: t.id,
      visitId: t.visitId,
      status: t.status,
      updatedAt: t.updatedAt,
    }))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 20);

  if (items.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        No recent activity
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.taskId}
          className="flex items-center justify-between py-1.5 border-b last:border-0"
        >
          <div className="flex items-center gap-2">
            <StatusBadge status={item.status} />
            <span className="text-sm text-muted-foreground">
              Visit #{item.visitId}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {formatTime(item.updatedAt)}
          </span>
        </div>
      ))}
    </div>
  );
}
