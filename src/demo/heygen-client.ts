import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { HEYGEN_CONFIG } from "./config";
import { fetchExternal } from "./fetch-external";
import type { AvatarSession } from "./types";

const { baseUrl, quality } = HEYGEN_CONFIG;
const FETCH_TIMEOUT_MS = 20_000;

function requireHeyGenApiKey(): string {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) {
    throw new ExternalServiceError(
      "HEYGEN_API_KEY is not configured",
      "heygen"
    );
  }
  return apiKey;
}

/**
 * Create a new HeyGen streaming avatar session.
 * Returns session credentials needed to establish the WebRTC connection client-side.
 */
export async function createAvatarSession(
  avatarId: string
): Promise<AvatarSession> {
  const apiKey = requireHeyGenApiKey();

  const res = await fetchExternal(
    `${baseUrl}/streaming.new`,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ quality, avatar_id: avatarId }),
    },
    "heygen",
    FETCH_TIMEOUT_MS
  );

  const body = await res.json();
  const data = body.data;

  return {
    sessionId: data.session_id,
    accessToken: data.access_token,
    url: data.url,
  };
}

/**
 * Send text to a HeyGen streaming avatar session for the avatar to speak.
 */
export async function sendAvatarText(
  sessionId: string,
  text: string
): Promise<void> {
  const apiKey = requireHeyGenApiKey();

  await fetchExternal(
    `${baseUrl}/streaming.task`,
    {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session_id: sessionId,
        text,
        task_type: "talk",
      }),
    },
    "heygen",
    FETCH_TIMEOUT_MS
  );
}

/**
 * Close a HeyGen streaming avatar session. Best-effort — errors are logged but not thrown.
 */
export async function closeAvatarSession(sessionId: string): Promise<void> {
  const apiKey = process.env.HEYGEN_API_KEY;
  if (!apiKey) return;

  try {
    await fetchExternal(
      `${baseUrl}/streaming.stop`,
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ session_id: sessionId }),
      },
      "heygen",
      FETCH_TIMEOUT_MS
    );
  } catch (err) {
    logger.warn({ sessionId, err: String(err) }, "Failed to close HeyGen session");
  }
}
