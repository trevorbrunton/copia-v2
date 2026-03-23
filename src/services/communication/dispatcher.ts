import type { SMSProvider, EmailProvider } from "./types";
import type { ContactAttempt, ContactChannel } from "@/src/services/rostering/types";
import type { RosterTask } from "@/src/db/schema";
import type { ScoredCandidate } from "@/src/services/scoring/types";
import { buildShiftOfferSMS } from "./templates";
import { logger } from "@/src/lib/logger";

export interface DispatchResult {
  attempt: ContactAttempt;
  messageId: string;
}

/**
 * Send a contact offer to a candidate and return the ContactAttempt record.
 */
export async function dispatchContact(
  task: RosterTask,
  candidate: ScoredCandidate,
  contactAddress: string,
  channel: ContactChannel,
  provider: SMSProvider | EmailProvider,
  expiryMinutes: number,
): Promise<DispatchResult> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + expiryMinutes * 60 * 1000);

  const body = buildShiftOfferSMS({
    name: candidate.employee_name,
    client: `Client #${task.clientId ?? "unknown"}`,
    date: task.detectedAt ? new Date(task.detectedAt).toLocaleDateString("en-AU") : "TBD",
    time: task.detectedAt ? new Date(task.detectedAt).toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }) : "TBD",
    expiryMinutes,
  });

  let messageId: string;
  if (channel === "sms") {
    const result = await (provider as SMSProvider).send(contactAddress, body);
    messageId = result.messageId;
  } else {
    const result = await (provider as EmailProvider).send({
      to: contactAddress,
      subject: "Shift Available",
      body,
    });
    messageId = result.messageId;
  }

  const attempt: ContactAttempt = {
    employee_id: candidate.employee_id,
    employee_name: candidate.employee_name,
    contact_address: contactAddress,
    rank: 0, // Set by caller based on position in contact list
    overall_score: candidate.overall,
    channel,
    sent_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    response: "pending",
    responded_at: null,
    decline_reason: null,
    selection_reason: candidate.warnings.length > 0
      ? `Selected despite warnings: ${candidate.warnings.join(", ")}`
      : "Top scored candidate",
  };

  logger.info(
    { taskId: task.id, employeeId: candidate.employee_id, channel, messageId },
    "Contact dispatched"
  );

  return { attempt, messageId };
}
