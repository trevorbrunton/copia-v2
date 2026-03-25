import { handleAppError } from "@/src/server/errors";
import { matchQuestion } from "@/src/demo/bedrock-matcher";
import { logger } from "@/src/lib/logger";

/**
 * POST /api/v1/demo/match
 *
 * Matches a user question to the best pre-produced demo response
 * using AWS Bedrock Haiku. Returns the matched category, answer text,
 * and media URLs for video/audio playback.
 *
 * Intentionally unauthenticated — this powers the public investor demo page.
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const body = await req.json();
    const text = body?.text;
    if (!text || typeof text !== "string") {
      return Response.json(
        { error: { code: "INVALID_INPUT", message: "text is required" } },
        { status: 400 },
      );
    }

    if (text.length > 1000) {
      return Response.json(
        { error: { code: "INVALID_INPUT", message: "text exceeds maximum length of 1000 characters" } },
        { status: 400 },
      );
    }

    logger.info({ traceId, textLength: text.length }, "demo:match request");

    const result = await matchQuestion(text);

    logger.info(
      { traceId, category: result.category },
      "demo:match response",
    );

    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
