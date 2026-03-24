import { askVoiceflow } from "@/src/demo/voiceflow-client";
import { handleAppError, ValidationError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

/**
 * POST /api/v1/demo/chat
 *
 * Sends a user question to the Voiceflow agent and returns the text response.
 * Intentionally unauthenticated — this powers the public investor demo page.
 *
 * Body: { message: string; sessionId: string }
 * Response: { reply: string }
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const body = await req.json();
    const message =
      typeof body.message === "string" ? body.message.trim() : "";
    const sessionId = body.sessionId;

    if (!message) {
      throw new ValidationError("message is required");
    }
    if (!sessionId || typeof sessionId !== "string") {
      throw new ValidationError("sessionId is required");
    }

    logger.info({ traceId, sessionId }, "demo:chat request");

    const reply = await askVoiceflow(message, sessionId);

    return Response.json({ reply });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
