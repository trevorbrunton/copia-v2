import { z } from "zod";
import type { AuthContext } from "@/src/server/auth-context";
import type { UnitOfWork } from "@/src/server/uow/types";
import { getRosterTask, updateRosterTask } from "@/src/services/rostering/roster-task-service";
import { appendAudit } from "@/src/services/rostering/audit-service";
import { parseResponse } from "@/src/services/communication/response-handler";
import type { ContactAttempt } from "@/src/services/rostering/types";
import { isContactExpired } from "@/src/services/rostering/cascade-engine";
import { ConflictError, NotFoundError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

export const SMSResponseInput = z.object({
  taskId: z.string().uuid(),
  phoneNumber: z.string().min(1),
  message: z.string().min(1),
});

/**
 * Handle an inbound SMS response (from real webhook or simulation endpoint).
 * Parses the message, updates the ContactAttempt, and advances the task.
 *
 * AUTH NOTE: Requires AuthContext (user-scoped UoW). Works for the dev simulation
 * endpoint (/api/v1/dev/simulate-response). Real Twilio webhooks are M2M (no user
 * session) — at go-live, the webhook route must store inbound messages in a
 * pending table and process them via an authenticated batch endpoint.
 */
export async function handleSMSResponse(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext
) {
  const input = SMSResponseInput.parse(rawInput);
  const parsed = await parseResponse(input.message);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    const task = await getRosterTask(tx, ctx.principalId, input.taskId);

    if (task.status !== "contacting" && task.status !== "cascading") {
      throw new NotFoundError("Task is not in a contactable state");
    }

    const contacts = (task.contacts ?? []) as ContactAttempt[];
    const contactIndex = contacts.findIndex(
      (c) => c.contact_address === input.phoneNumber && c.response === "pending"
    );

    if (contactIndex === -1) {
      throw new NotFoundError("No pending contact found for this phone number");
    }

    // Reject responses to expired contact attempts
    if (isContactExpired(contacts[contactIndex])) {
      throw new ConflictError("Contact attempt has expired");
    }

    // Update the contact attempt — only finalize if accept/decline, not question
    const updatedContacts = [...contacts];
    if (parsed.intent === "accept" || parsed.intent === "decline") {
      updatedContacts[contactIndex] = {
        ...contacts[contactIndex],
        response: parsed.intent === "accept" ? "accepted" : "declined",
        responded_at: new Date().toISOString(),
        decline_reason: parsed.decline_reason ?? null,
      };
    }
    // "question" intent → contact stays pending, no state change

    // Determine next status based on response
    let nextStatus = task.status;
    if (parsed.intent === "accept") {
      nextStatus = "accepted";
    } else if (parsed.intent === "decline") {
      nextStatus = "cascading"; // Move to next candidate
    }
    // "question" → stay in current state

    // Only update task if contact or status actually changed
    const updated = parsed.intent === "question"
      ? task
      : await updateRosterTask(
          tx,
          ctx.principalId,
          task.id,
          {
            contacts: updatedContacts,
            status: nextStatus,
          },
          task.version
        );

    await appendAudit(tx, ctx.principalId, task.id, {
      action: `response_${parsed.intent}`,
      actor: "caregiver",
      details: {
        phoneNumber: input.phoneNumber,
        message: input.message,
        intent: parsed.intent,
        confidence: parsed.confidence,
        contactIndex,
      },
    });

    logger.info(
      { taskId: task.id, intent: parsed.intent, confidence: parsed.confidence },
      "SMS response processed"
    );

    return updated;
  });
}
