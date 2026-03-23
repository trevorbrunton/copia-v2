import { NextRequest } from "next/server";
import { parseHandoverEmail } from "@/src/services/communication/email-parser";
import { validateWebhookSecret } from "@/src/lib/alayacare-events/validate-webhook";
import { handleAppError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

/**
 * POST /api/v1/webhooks/email
 *
 * Receives inbound emails (from SES/SendGrid webhook).
 * Parses shift details → returns parsed result.
 *
 * In production: on high-confidence parse, creates RosterTask automatically.
 * On low confidence, sends confirmation email to user before creating task.
 *
 * Auth: M2M via shared webhook secret (same as AlayaCare webhooks).
 */
export async function POST(req: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    validateWebhookSecret(req);

    const body = await req.json();
    const emailBody = typeof body.body === "string" ? body.body : typeof body.text === "string" ? body.text : "";

    if (!emailBody) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: "Email body is required", traceId } },
        { status: 400 }
      );
    }

    logger.info({ traceId, from: body.from, subject: body.subject }, "Inbound email received");

    const parsed = await parseHandoverEmail(emailBody);

    logger.info(
      { traceId, confidence: parsed.confidence, hasClient: !!parsed.shift_details.client_name },
      "Email parsed"
    );

    return Response.json({
      traceId,
      parsed,
      action: parsed.confidence >= 0.7 ? "auto_create_task" : "requires_confirmation",
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
