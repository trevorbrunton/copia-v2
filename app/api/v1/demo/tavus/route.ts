import { handleAppError } from "@/src/server/errors";
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

/**
 * POST /api/v1/demo/tavus
 *
 * Creates a Tavus CVI conversation and returns the conversation_url.
 * The API key is kept server-side; only the Daily.co room URL is exposed to the client.
 * Intentionally unauthenticated — this powers the public investor demo page.
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const apiKey = process.env.TAVUS_API_KEY;
    if (!apiKey) {
      throw new ExternalServiceError(
        "TAVUS_API_KEY is not configured",
        "tavus"
      );
    }

    const replicaId = process.env.TAVUS_REPLICA_ID ?? "";
    const defaultPersonaId = process.env.TAVUS_PERSONA_ID ?? "";

    // Parse optional overrides from request body
    let requestPersonaId: string | undefined;
    let customGreeting: string | undefined;
    try {
      const body = await req.json();
      requestPersonaId = body.persona_id;
      customGreeting = body.custom_greeting;
    } catch {
      // No body or invalid JSON — use defaults
    }

    const personaId = requestPersonaId || defaultPersonaId;

    if (!personaId) {
      throw new ExternalServiceError(
        "TAVUS_PERSONA_ID is not configured",
        "tavus"
      );
    }

    logger.info({ traceId, personaId }, "demo:tavus conversation request");

    const conversationBody: Record<string, unknown> = {
      persona_id: personaId,
    };

    if (replicaId) {
      conversationBody.replica_id = replicaId;
    }

    if (customGreeting) {
      conversationBody.custom_greeting = customGreeting;
    }

    const res = await fetch("https://tavusapi.com/v2/conversations", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(conversationBody),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ExternalServiceError(
        `Tavus API error: ${res.status} ${body?.message ?? res.statusText}`,
        "tavus"
      );
    }

    const data = await res.json();

    if (!data.conversation_url) {
      throw new ExternalServiceError(
        "Tavus returned no conversation_url",
        "tavus"
      );
    }

    logger.info(
      { traceId, conversationId: data.conversation_id },
      "demo:tavus conversation created"
    );

    return Response.json({
      conversationId: data.conversation_id,
      conversationUrl: data.conversation_url,
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
