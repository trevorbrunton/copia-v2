/** Escape HTML special characters to prevent XSS in email templates. */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildShiftOfferSMS(params: {
  name: string;
  client: string;
  date: string;
  time: string;
  expiryMinutes: number;
}): string {
  return `Hi ${params.name}, shift available: ${params.client} on ${params.date} at ${params.time}. Reply YES to accept or NO to decline. Expires in ${params.expiryMinutes} min.`;
}

export function buildConfirmationSMS(params: {
  name: string;
  client: string;
  date: string;
  time: string;
}): string {
  return `Confirmed: ${params.name}, you're assigned to ${params.client} on ${params.date} at ${params.time}. Details in your AlayaCare app.`;
}

export function buildCancellationSMS(params: {
  name: string;
  reason: string;
}): string {
  return `Hi ${params.name}, the shift offer has been cancelled. Reason: ${params.reason}. No action needed.`;
}

// ─── Email Templates ────────────────────────────────────────

export function buildShiftOfferEmail(params: {
  employeeName: string;
  clientName: string;
  date: string;
  time: string;
  duration: string;
  requirements?: string;
}): { subject: string; html: string } {
  return {
    subject: `Shift Available: ${params.clientName} on ${params.date}`,
    html: `
      <h2>Shift Offer</h2>
      <p>Hi ${esc(params.employeeName)},</p>
      <p>A shift is available and you've been matched as a suitable caregiver:</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Client</td><td>${esc(params.clientName)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Date</td><td>${esc(params.date)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Time</td><td>${esc(params.time)}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Duration</td><td>${esc(params.duration)}</td></tr>
        ${params.requirements ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Requirements</td><td>${esc(params.requirements)}</td></tr>` : ""}
      </table>
      <p>Please respond to the SMS you received or contact your coordinator.</p>
    `.trim(),
  };
}

export function buildDailySummaryEmail(params: {
  date: string;
  totalTasks: number;
  filledAutonomously: number;
  escalated: number;
  avgTimeToFillMinutes: number | null;
  pendingCount: number;
}): { subject: string; html: string } {
  const fillRate = params.totalTasks > 0
    ? Math.round((params.filledAutonomously / params.totalTasks) * 100)
    : 0;
  const avgTime = params.avgTimeToFillMinutes != null
    ? `${Math.round(params.avgTimeToFillMinutes)} min`
    : "N/A";

  return {
    subject: `Rostering Daily Summary — ${params.date}`,
    html: `
      <h2>Daily Rostering Summary — ${esc(params.date)}</h2>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Total shifts processed</td><td>${params.totalTasks}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Filled autonomously</td><td>${params.filledAutonomously} (${fillRate}%)</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Escalated</td><td>${params.escalated}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Avg time to fill</td><td>${avgTime}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Pending</td><td>${params.pendingCount}</td></tr>
      </table>
    `.trim(),
  };
}

export function buildWeeklyReportEmail(params: {
  weekStart: string;
  weekEnd: string;
  totalTasks: number;
  autonomousFillRate: number;
  avgTimeToFillMinutes: number | null;
  escalationRate: number;
  topDeclineReasons: Array<{ reason: string; count: number }>;
}): { subject: string; html: string } {
  const avgTime = params.avgTimeToFillMinutes != null
    ? `${Math.round(params.avgTimeToFillMinutes)} min`
    : "N/A";

  const reasonRows = params.topDeclineReasons
    .map((r) => `<tr><td style="padding:2px 8px 2px 0">${esc(r.reason)}</td><td>${r.count}</td></tr>`)
    .join("");

  return {
    subject: `Rostering Weekly Report — ${params.weekStart} to ${params.weekEnd}`,
    html: `
      <h2>Weekly Rostering Report</h2>
      <p>${esc(params.weekStart)} — ${esc(params.weekEnd)}</p>
      <table style="border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Total shifts</td><td>${params.totalTasks}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Autonomous fill rate</td><td>${Math.round(params.autonomousFillRate * 100)}%</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Avg time to fill</td><td>${avgTime}</td></tr>
        <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Escalation rate</td><td>${Math.round(params.escalationRate * 100)}%</td></tr>
      </table>
      ${reasonRows ? `<h3>Top Decline Reasons</h3><table style="border-collapse:collapse">${reasonRows}</table>` : ""}
    `.trim(),
  };
}
