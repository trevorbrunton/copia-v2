/**
 * Gemini Flash audio matcher for the "flash" processing mode.
 *
 * Sends raw audio directly to Gemini 2.5 Flash, which transcribes
 * and classifies the question in a single inference call — replacing
 * the two-step ElevenLabs STT + Bedrock Haiku pipeline.
 */

import { db } from "@/src/db";
import { demoResponses, demoQuestionPatterns } from "@/src/db/schema";
import { logger } from "@/src/lib/logger";
import type { MatchResult } from "./bedrock-matcher";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// ─── Cached DB data (static seed data, loaded once) ─────────────────

interface CachedData {
  responses: (typeof demoResponses.$inferSelect)[];
  systemPrompt: string;
}

let cachedData: CachedData | null = null;

export function clearGeminiMatcherCache(): void {
  cachedData = null;
}

async function getCachedData(): Promise<CachedData> {
  if (cachedData) return cachedData;

  const responses = await db.select().from(demoResponses);
  const patterns = await db.select().from(demoQuestionPatterns);

  const patternsByResponseId = new Map<string, string[]>();
  for (const p of patterns) {
    const list = patternsByResponseId.get(p.responseId) ?? [];
    list.push(p.pattern);
    patternsByResponseId.set(p.responseId, list);
  }

  const categoryDescriptions = responses
    .filter((r) => r.category !== "fallback")
    .map((r) => {
      const exampleQuestions = patternsByResponseId.get(r.id) ?? [];
      return [
        `CATEGORY: ${r.category}`,
        `LABEL: ${r.label}`,
        `EXAMPLE QUESTIONS: ${exampleQuestions.join(" | ")}`,
      ].join("\n");
    })
    .join("\n\n");

  const systemPrompt = `You are a question classifier for the OC Mid-Cap Fund investor demo. You will receive an audio recording of a user asking a question. Your job is to:

1. Transcribe what the user said
2. Match their question to the single best-matching category from the list below

Rules:
- Return ONLY valid JSON: { "transcript": "<what the user said>", "category": "<matched_category>" }
- If no category is a good match, use "fallback" as the category
- If the audio contains no intelligible speech, return { "transcript": "", "category": "" }
- Match based on semantic meaning, not exact wording
- The user may phrase their question differently from the examples — use judgement

Available categories:

${categoryDescriptions}`;

  cachedData = { responses, systemPrompt };
  return cachedData;
}

// ─── Public API ─────────────────────────────────────────────────────

export interface GeminiMatchResult {
  /** The transcribed user text (empty if no speech detected) */
  text: string;
  /** The full match result (null if no speech detected) */
  match: MatchResult | null;
}

/**
 * Send audio to Gemini Flash for transcription + classification in one call.
 *
 * The audio is sent as inline base64 WAV data alongside the classification
 * system prompt. Gemini transcribes and classifies in a single inference.
 */
export async function processAudioWithGemini(
  wavBase64: string,
  traceId: string
): Promise<GeminiMatchResult> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const MEDIA_BASE = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "";
  const { responses, systemPrompt } = await getCachedData();

  const requestBody = {
    system_instruction: {
      parts: [{ text: systemPrompt }],
    },
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: "audio/wav",
              data: wavBase64,
            },
          },
          {
            text: "Listen to this audio and classify the question. Return JSON only.",
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 200,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          transcript: {
            type: "string",
            description: "What the user said, transcribed verbatim",
          },
          category: {
            type: "string",
            description: "The matched category name, or 'fallback' if no match",
          },
        },
        required: ["transcript", "category"],
      },
    },
  };

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    logger.error(
      { traceId, status: res.status, body: errBody },
      "demo:gemini-matcher API error"
    );
    throw new Error(`Gemini API error: ${res.status} ${errBody}`);
  }

  const data = await res.json();

  // Extract the text response from Gemini's response format
  const rawText =
    data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  logger.debug({ traceId, rawText }, "demo:gemini-matcher raw response");

  // Parse the JSON response
  let transcript = "";
  let category = "";
  try {
    const parsed = JSON.parse(rawText);
    transcript = (parsed.transcript ?? "").trim();
    category = (parsed.category ?? "").trim().toLowerCase();
  } catch {
    logger.warn(
      { traceId, rawText },
      "demo:gemini-matcher failed to parse JSON, falling back"
    );
    return { text: "", match: null };
  }

  if (!transcript) {
    return { text: "", match: null };
  }

  // Clean up category — Gemini is generally well-behaved but sanitise anyway
  category = category.replace(/[^a-z_]/g, "") || "fallback";

  logger.debug(
    { traceId, transcript, category },
    "demo:gemini-matcher classified"
  );

  const matched =
    responses.find((r) => r.category === category) ??
    responses.find((r) => r.category === "fallback");

  if (!matched) {
    return {
      text: transcript,
      match: {
        category: "fallback",
        label: "Fallback",
        answerText:
          "That's a great question. For more detail on that topic, I'd suggest speaking directly with our investor relations team.",
        audioUrl: `${MEDIA_BASE}/audio/fallback.mp3`,
        pcmUrl: `${MEDIA_BASE}/audio/fallback.pcm`,
        videoUrl: `${MEDIA_BASE}/video/fallback.mp4`,
      },
    };
  }

  return {
    text: transcript,
    match: {
      category: matched.category,
      label: matched.label,
      answerText: matched.answerText,
      audioUrl: `${MEDIA_BASE}/audio/${matched.category}.mp3`,
      pcmUrl: `${MEDIA_BASE}/audio/${matched.category}.pcm`,
      videoUrl: `${MEDIA_BASE}/video/${matched.category}.mp4`,
    },
  };
}
