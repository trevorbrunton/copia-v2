"use client";

import { useMemo, useState } from "react";
import { useRosterTasks, useProcessEvents } from "@/src/hooks/use-roster-tasks";
import { TaskCard } from "@/components/rostering/task-card";
import { ActivityFeed } from "@/components/rostering/activity-feed";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RefreshCw, Play } from "lucide-react";

const STATUS_TABS = [
  { label: "All", value: undefined },
  { label: "Active", value: "contacting" },
  { label: "Cascading", value: "cascading" },
  { label: "Escalated", value: "escalated" },
  { label: "Completed", value: "completed" },
] as const;

export default function RosterPage() {
  const [activeTab, setActiveTab] = useState<string | undefined>(undefined);

  // Single fetch — filter client-side to avoid double API call
  const { data: allTasks, isLoading, refetch } = useRosterTasks();
  const processEvents = useProcessEvents();

  const filteredTasks = useMemo(() => {
    if (!allTasks) return undefined;
    if (!activeTab) return allTasks;
    return allTasks.filter((t) => t.status === activeTab);
  }, [allTasks, activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Roster Tasks</h1>
          <p className="text-muted-foreground mt-1">
            Active shift-filling tasks and cascade status
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={() => processEvents.mutate()}
            disabled={processEvents.isPending}
          >
            <Play className="h-4 w-4 mr-1" />
            Process Events
          </Button>
        </div>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-1 border-b">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            onClick={() => setActiveTab(tab.value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Task list */}
        <div className="lg:col-span-2 space-y-3">
          {isLoading && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              Loading tasks...
            </div>
          )}
          {!isLoading && (!filteredTasks || filteredTasks.length === 0) && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              No roster tasks found
            </div>
          )}
          {filteredTasks?.map((task) => (
            <TaskCard key={task.id} task={task} />
          ))}
        </div>

        {/* Activity feed sidebar */}
        <div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivityFeed tasks={allTasks ?? []} />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
