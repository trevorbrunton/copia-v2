import { ExternalServiceError } from "@/src/server/errors";
import { VOICEFLOW_CONFIG } from "./config";
import { fetchExternal } from "./fetch-external";
import type { VoiceflowMessage } from "./types";

const { baseUrl, versionAlias } = VOICEFLOW_CONFIG;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Send a user message to the Voiceflow agent and return the assistant's text response.
 */
export async function askVoiceflow(
  userMessage: string,
  userId: string
): Promise<string> {
  const apiKey = process.env.VOICEFLOW_API_KEY;
  if (!apiKey) {
    throw new ExternalServiceError(
      "VOICEFLOW_API_KEY is not configured",
      "voiceflow"
    );
  }

  const res = await fetchExternal(
    `${baseUrl}/state/user/${encodeURIComponent(userId)}/interact`,
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        versionID: versionAlias,
      },
      body: JSON.stringify({
        action: { type: "text", payload: userMessage },
      }),
    },
    "voiceflow",
    FETCH_TIMEOUT_MS
  );

  const messages: VoiceflowMessage[] = await res.json();

  const textParts = messages
    .filter(
      (m): m is Extract<VoiceflowMessage, { type: "text" }> =>
        m.type === "text"
    )
    .map((m) => m.payload.message);

  return textParts.join("\n\n");
}
