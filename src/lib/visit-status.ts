/**
 * Derives the real-time shift status from visit data.
 * Used by the visit detail UI to show monitoring status.
 */

export interface ShiftStatusInput {
  status: string;
  clock_in: string | null;
  clock_out: string | null;
  start_at: string;
  end_at: string;
}

export interface ShiftStatus {
  label: string;
  variant: string;
}

export const STATUS_COLORS: Record<string, string> = {
  scheduled: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  vacant: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  completed: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  cancelled: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  clocked: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  offered: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  late: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  missed: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
  approved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  on_hold: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-300",
};

export function getShiftStatus(
  visit: ShiftStatusInput,
  now: Date = new Date()
): ShiftStatus {
  if (visit.clock_in && visit.clock_out) {
    return { label: "Shift Completed", variant: "completed" };
  }
  if (visit.clock_in && !visit.clock_out) {
    return { label: "In Progress", variant: "clocked" };
  }
  const start = new Date(visit.start_at);
  const end = new Date(visit.end_at);
  if (now > end && !visit.clock_in) {
    return { label: "Missed", variant: "missed" };
  }
  if (now > start && !visit.clock_in) {
    return { label: "Late", variant: "late" };
  }
  return { label: "Scheduled", variant: "scheduled" };
}
