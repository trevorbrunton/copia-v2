import { ExternalServiceError } from "@/src/server/errors";

/**
 * Fetch wrapper for external vendor APIs (Voiceflow, ElevenLabs, HeyGen).
 * Handles timeout and non-ok status consistently across all demo clients.
 */
export async function fetchExternal(
  url: string,
  init: RequestInit,
  service: string,
  timeoutMs: number
): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    throw new ExternalServiceError(
      `${service} API error: ${res.status} ${res.statusText}`,
      service
    );
  }

  return res;
}
