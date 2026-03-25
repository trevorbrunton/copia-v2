import { handleAppError } from "@/src/server/errors";
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

const AVATAR_ID = process.env.NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID ?? "";

/**
 * POST /api/v1/demo/avatar
 *
 * Creates a LiveAvatar LITE session and returns the session token.
 * The API key is kept server-side; only the session token is exposed to the client.
 * Intentionally unauthenticated — this powers the public investor demo page.
 */
export async function POST() {
  const traceId = crypto.randomUUID();
  try {
    const apiKey = process.env.LIVEAVATAR_API_KEY;
    if (!apiKey) {
      throw new ExternalServiceError(
        "LIVEAVATAR_API_KEY is not configured",
        "liveavatar"
      );
    }

    if (!AVATAR_ID) {
      throw new ExternalServiceError(
        "NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID is not configured",
        "liveavatar"
      );
    }

    logger.info({ traceId, avatarId: AVATAR_ID }, "demo:avatar session request");

    const res = await fetch("https://api.liveavatar.com/v1/sessions/token", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mode: "LITE",
        avatar_id: AVATAR_ID,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      logger.error({ traceId, status: res.status, body }, "demo:avatar API error");
      throw new ExternalServiceError(
        `LiveAvatar API error: ${res.status} ${body?.message ?? res.statusText}`,
        "liveavatar"
      );
    }

    const body = await res.json();
    logger.info({ traceId, hasData: !!body.data, hasToken: !!body.data?.session_token }, "demo:avatar API response");
    const sessionToken = body.data?.session_token;

    if (!sessionToken) {
      throw new ExternalServiceError(
        "LiveAvatar returned no session token",
        "liveavatar"
      );
    }

    return Response.json({ sessionToken });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
