/**
 * Speech-to-text via ElevenLabs `scribe_v1`.
 *
 * Lifted from v1's `app/api/v1/demo/process/route.ts` STT helper so
 * the v2 process route can transcribe in the same step as intent
 * classification.
 */
import { ExternalServiceError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";

/**
 * Wrap raw PCM samples in a minimal WAV header so the STT service
 * identifies the format correctly.
 *
 * **Input contract:** `pcm` must be **16-bit signed little-endian
 * mono** (matches what `useVoiceListener` emits today). The header is
 * hard-coded for that format. If the listener ever switches to a
 * different bit depth or channel count, this helper needs updating.
 */
function pcmToWav(pcm: ArrayBuffer, sampleRate: number): ArrayBuffer {
  const pcmBytes = new Uint8Array(pcm);
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBytes.length;
  const headerSize = 44;

  const wav = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(wav);
  const bytes = new Uint8Array(wav);

  bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
  view.setUint32(4, 36 + dataSize, true);
  bytes.set([0x57, 0x41, 0x56, 0x45], 8); // "WAVE"
  bytes.set([0x66, 0x6d, 0x74, 0x20], 12); // "fmt "
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  bytes.set([0x64, 0x61, 0x74, 0x61], 36); // "data"
  view.setUint32(40, dataSize, true);
  bytes.set(pcmBytes, headerSize);

  return wav;
}

/**
 * Backoff schedule for retryable STT failures (ElevenLabs 429 /
 * "system_busy", or network blips). Three attempts total: the first
 * call, then two retries at 400ms and 1000ms. Total worst-case wall
 * time ≈ 14.4s (12s timeout + 1.4s backoffs) — still fits inside
 * the route's overall 5/min rate limit comfortably.
 */
const RETRY_DELAYS_MS = [400, 1000] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * ElevenLabs response body shape for rate-limit errors. Both `code`
 * and `status` are checked downstream because observed payloads carry
 * one or the other (sometimes both) depending on the failure mode —
 * this is not a documented contract from ElevenLabs, just a defensive
 * read against what they currently return. Re-test against the live
 * API if their error shape changes.
 */
interface ElevenLabsErrorBody {
  detail?: { code?: string; status?: string; message?: string };
}

/**
 * Should this STT failure be retried? Retries are scoped to truly
 * transient signals — 429 (rate-limit / system busy), 502/503/504
 * (gateway / availability blips). Hard 4xx (auth, bad request) bail
 * out immediately so we don't hammer ElevenLabs on a config error.
 */
function isRetryableSttFailure(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/**
 * Transcribe PCM audio via ElevenLabs STT. Returns the transcribed
 * text trimmed; empty string when no speech detected.
 *
 * Retries up to 2x on 429 / 5xx. After the final retry exhausts, the
 * raw upstream error JSON is replaced with a user-facing string so
 * the dispatcher's narrate-on-error path doesn't read a stack trace.
 */
export async function transcribePcm(args: {
  pcm: ArrayBuffer;
  sampleRate: number;
  traceId: string;
}): Promise<string> {
  if (!ELEVENLABS_API_KEY) {
    throw new ExternalServiceError("ELEVENLABS_API_KEY is not configured", "elevenlabs");
  }

  const wav = pcmToWav(args.pcm, args.sampleRate);

  let lastStatus = 0;
  let lastBody = "";
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1];
      logger.warn(
        { traceId: args.traceId, attempt, delay, lastStatus },
        "screen:stt retry"
      );
      await sleep(delay);
    }

    const body = new FormData();
    body.append("file", new Blob([wav], { type: "audio/wav" }), "audio.wav");
    body.append("model_id", "scribe_v1");
    body.append("language_code", "eng");

    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY },
      body,
      // Per-attempt budget. A hung STT call would freeze the voice
      // loop; better to fail fast and let the retry kick in.
      signal: AbortSignal.timeout(12_000),
    });

    if (res.ok) {
      const result = (await res.json()) as { text?: string };
      return (result.text ?? "").trim();
    }

    lastStatus = res.status;
    lastBody = await res.text();
    if (!isRetryableSttFailure(res.status)) break;
  }

  logger.error(
    { traceId: args.traceId, status: lastStatus, body: lastBody },
    "screen:stt failed (after retries)"
  );

  // Friendlier message for "busy" / rate-limit situations — Pep
  // narrates this verbatim via the dispatcher's catch block, so the
  // user shouldn't hear a JSON dump.
  let parsed: ElevenLabsErrorBody | null = null;
  try {
    parsed = JSON.parse(lastBody) as ElevenLabsErrorBody;
  } catch {
    /* non-JSON body — keep parsed = null */
  }
  const code = parsed?.detail?.code ?? parsed?.detail?.status;
  const isBusy = lastStatus === 429 || code === "system_busy" || code === "rate_limit_error";
  const friendly = isBusy
    ? "Speech-to-text is busy right now — please try again in a moment."
    : `Speech-to-text failed (${lastStatus}).`;
  throw new ExternalServiceError(friendly, "elevenlabs");
}
