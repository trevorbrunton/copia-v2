"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CalendarClock,
  Users,
  UserRound,
  ArrowRight,
  AlertCircle,
  ListTodo,
  AlertTriangle,
  CheckCircle2,
  Timer,
  RotateCcw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useVisits } from "@/src/hooks/use-visits";
import { useEmployees } from "@/src/hooks/use-employees";
import { useAlayaClients } from "@/src/hooks/use-alaya-clients";
import { useRosterSummary } from "@/src/hooks/use-roster-tasks";
import { useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/src/lib/api-client";

function MetricCard({
  title,
  icon,
  value,
  href,
  linkText,
  isError,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  value: number | string | undefined;
  href: string;
  linkText: string;
  isError: boolean;
  className?: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {isError ? (
          <p className="text-sm text-destructive">Unable to load</p>
        ) : (
          <>
            <div className={`text-2xl font-bold ${className ?? ""}`}>
              {value ?? "—"}
            </div>
            <Link
              href={href}
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center mt-1"
            >
              {linkText}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ResetButton() {
  const [isResetting, setIsResetting] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const queryClient = useQueryClient();

  async function handleReset() {
    setIsResetting(true);
    setResult(null);
    try {
      const res = await apiFetch("/api/dev/reset", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setResult(`Error: ${body?.error?.message ?? res.statusText}`);
        return;
      }
      setResult("Reset complete");
      queryClient.invalidateQueries();
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setIsResetting(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" size="sm" disabled={isResetting}>
            <RotateCcw className="h-4 w-4 mr-2" />
            {isResetting ? "Resetting..." : "Reset App Data"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset rostering data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear all workflow events, roster tasks, audit logs, and
              daily metrics. Use this after reseeding the mock-alaya database.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleReset}>
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {result && (
        <span className={`text-sm ${result.startsWith("Error") ? "text-destructive" : "text-green-600"}`}>
          {result}
        </span>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { data: visitsData, isError: visitsError } = useVisits();
  const { data: vacantVisits, isError: vacantError } = useVisits({ status: "vacant" });
  const { data: employeesData, isError: employeesError } = useEmployees();
  const { data: clientsData, isError: clientsError } = useAlayaClients();
  const { data: rosterSummary } = useRosterSummary();

  const avgTimeToFill = rosterSummary?.avgTimeToFillMs
    ? `${Math.round(rosterSummary.avgTimeToFillMs / 60_000)}m`
    : undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            DappaAi — AlayaCare Integration PoC
          </p>
        </div>
        <ResetButton />
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Visits"
          icon={<CalendarClock className="h-4 w-4 text-muted-foreground" />}
          value={visitsData?.count}
          href="/visits"
          linkText="View all"
          isError={visitsError}
        />
        <MetricCard
          title="Unfilled Visits"
          icon={<AlertCircle className="h-4 w-4 text-orange-500" />}
          value={vacantVisits?.count}
          href="/visits?status=vacant"
          linkText="View unfilled"
          isError={vacantError}
          className="text-orange-500"
        />
        <MetricCard
          title="Employees"
          icon={<Users className="h-4 w-4 text-muted-foreground" />}
          value={employeesData?.count}
          href="/employees"
          linkText="View all"
          isError={employeesError}
        />
        <MetricCard
          title="Clients"
          icon={<UserRound className="h-4 w-4 text-muted-foreground" />}
          value={clientsData?.count}
          href="/clients"
          linkText="View all"
          isError={clientsError}
        />
      </div>

      {/* Rostering metrics */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Shift Filling</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Active Tasks"
            icon={<ListTodo className="h-4 w-4 text-blue-500" />}
            value={rosterSummary?.active}
            href="/roster"
            linkText="View roster"
            isError={false}
            className="text-blue-500"
          />
          <MetricCard
            title="Escalations"
            icon={<AlertTriangle className="h-4 w-4 text-red-500" />}
            value={rosterSummary?.escalated}
            href="/roster?status=escalated"
            linkText="View escalations"
            isError={false}
            className="text-red-500"
          />
          <MetricCard
            title="Filled Today"
            icon={<CheckCircle2 className="h-4 w-4 text-green-500" />}
            value={rosterSummary?.completedToday}
            href="/roster?status=completed"
            linkText="View completed"
            isError={false}
            className="text-green-500"
          />
          <MetricCard
            title="Avg Time to Fill"
            icon={<Timer className="h-4 w-4 text-muted-foreground" />}
            value={avgTimeToFill}
            href="/roster"
            linkText="View roster"
            isError={false}
          />
        </div>
      </div>
    </div>
  );
}
