"use client";

import { useState } from "react";
import { useRosterAnalytics } from "@/src/hooks/use-roster-analytics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error } = useRosterAnalytics(days);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Shift-filling metrics, trends, and performance insights.
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 14, 30, 60].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1 text-sm rounded-md border ${days === d ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {isLoading && <p>Loading analytics...</p>}
      {error && <p className="text-red-600">Error: {error.message}</p>}

      {data && (
        <>
          {/* Key Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Autonomous Fill Rate</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatRate(data.rates.autonomous_fill_rate)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Avg Time to Fill</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatMs(data.timing.avg_time_to_fill_ms)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Escalation Rate</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{formatRate(data.rates.escalation_rate)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>1st Contact Accept</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">
                  {data.rates.first_contact_acceptance_rate != null
                    ? formatRate(data.rates.first_contact_acceptance_rate)
                    : "—"}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Totals */}
          <Card>
            <CardHeader>
              <CardTitle>Period Summary</CardTitle>
              <CardDescription>{data.period.from} to {data.period.to}</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Total Tasks</dt>
                  <dd className="text-2xl font-semibold">{data.totals.tasks_created}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Filled Autonomously</dt>
                  <dd className="text-2xl font-semibold">{data.totals.tasks_filled_autonomous}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Escalated</dt>
                  <dd className="text-2xl font-semibold">{data.totals.tasks_escalated}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Completed</dt>
                  <dd className="text-2xl font-semibold">{data.totals.tasks_completed}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* Daily Breakdown */}
          {data.daily.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Daily Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-2 pr-4">Date</th>
                        <th className="py-2 pr-4">Created</th>
                        <th className="py-2 pr-4">Filled</th>
                        <th className="py-2 pr-4">Escalated</th>
                        <th className="py-2">Avg Fill Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.daily.map((d) => (
                        <tr key={d.date} className="border-b last:border-0">
                          <td className="py-2 pr-4">{d.date}</td>
                          <td className="py-2 pr-4">{d.tasks_created}</td>
                          <td className="py-2 pr-4">
                            <Badge variant="default">{d.tasks_filled_autonomous}</Badge>
                          </td>
                          <td className="py-2 pr-4">
                            {d.tasks_escalated > 0 ? (
                              <Badge variant="destructive">{d.tasks_escalated}</Badge>
                            ) : (
                              "0"
                            )}
                          </td>
                          <td className="py-2">{formatMs(d.avg_time_to_fill_ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                Daily breakdown requires materialised metrics. Run the daily aggregation job to populate.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
