import { createSMSProvider } from "@/src/services/communication/sms-provider";
import { handleAppError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

/**
 * Inbound SMS webhook — receives responses from Twilio (or mock).
 * M2M endpoint — no user auth. At go-live, needs two-phase RLS treatment
 * (store in intermediate table, process during authenticated session).
 *
 * For P1.3 mock-first: use the simulation responder instead.
 * This route is a placeholder for the real Twilio webhook integration.
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const provider = createSMSProvider();
    const body = await req.text();
    const valid = await provider.verifyWebhook(body, req.headers);
    if (!valid) {
      return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
    }

    // TODO: P1.8 go-live — extract sender + body from Twilio format,
    // store in workflow_events or pending_sms_responses table,
    // then process via authenticated process-events endpoint.
    // NOTE: handleSMSResponse requires taskId — real webhook must resolve
    // taskId from phone number via a pending_contacts lookup table.
    logger.info({ traceId }, "SMS webhook received — placeholder for go-live");
    return Response.json({ status: "received" });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
