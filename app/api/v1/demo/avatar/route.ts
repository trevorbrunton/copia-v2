import {
  closeAvatarSession,
  createAvatarSession,
  sendAvatarText,
} from "@/src/demo/heygen-client";
import { handleAppError, ValidationError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

const MAX_TEXT_LENGTH = 5000;

/**
 * POST /api/v1/demo/avatar
 *
 * Manages HeyGen streaming avatar sessions.
 * Intentionally unauthenticated — this powers the public investor demo page.
 *
 * Body: { action: "create" | "speak" | "close"; avatarId?: string; sessionId?: string; text?: string }
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const body = await req.json();
    const { action } = body;

    if (!action || typeof action !== "string") {
      throw new ValidationError("action is required");
    }

    switch (action) {
      case "create": {
        if (!body.avatarId || typeof body.avatarId !== "string") {
          throw new ValidationError("avatarId is required for create");
        }
        logger.info({ traceId }, "demo:avatar create");
        const session = await createAvatarSession(body.avatarId);
        return Response.json(session);
      }

      case "speak": {
        if (!body.sessionId || typeof body.sessionId !== "string") {
          throw new ValidationError("sessionId is required for speak");
        }
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) {
          throw new ValidationError("text is required for speak");
        }
        if (text.length > MAX_TEXT_LENGTH) {
          throw new ValidationError(
            `text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`
          );
        }
        logger.info({ traceId, sessionId: body.sessionId }, "demo:avatar speak");
        await sendAvatarText(body.sessionId, text);
        return Response.json({ ok: true });
      }

      case "close": {
        if (!body.sessionId || typeof body.sessionId !== "string") {
          throw new ValidationError("sessionId is required for close");
        }
        logger.info({ traceId, sessionId: body.sessionId }, "demo:avatar close");
        await closeAvatarSession(body.sessionId);
        return Response.json({ ok: true });
      }

      default:
        throw new ValidationError(
          `Unknown action: ${action}. Expected create, speak, or close.`
        );
    }
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
