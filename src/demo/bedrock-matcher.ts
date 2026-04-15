/**
 * Bedrock Haiku response matcher for the "haiku" avatar mode.
 *
 * Loads all demo responses + question patterns from the database,
 * sends them to Claude Haiku on AWS Bedrock, and asks it to pick
 * the best matching category for a user's question.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from "@aws-sdk/client-bedrock-runtime";
import { db } from "@/src/db";
import { demoResponses, demoQuestionPatterns } from "@/src/db/schema";
import { logger } from "@/src/lib/logger";

const MODEL_ID =
  process.env.BEDROCK_MODEL_ID || "anthropic.claude-haiku-4-5-20251001-v1:0";
const ANTHROPIC_VERSION = "bedrock-2023-05-31";

let client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: process.env.AWS_REGION || "ap-southeast-2",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
  }
  return client;
}

export interface MatchResult {
  category: string;
  label: string;
  answerText: string;
  audioUrl: string;
  pcmUrl: string;
  videoUrl: string;
}

// ─── Cached DB data (static seed data, loaded once) ─────────────────

interface CachedData {
  responses: (typeof demoResponses.$inferSelect)[];
  systemPrompt: string;
}

let cachedData: CachedData | null = null;

/** Clear the cached data so the next match re-reads from the database. */
export function clearMatcherCache(): void {
  cachedData = null;
}

async function getCachedData(): Promise<CachedData> {
  if (cachedData) return cachedData;

  const responses = await db.select().from(demoResponses);
  const patterns = await db.select().from(demoQuestionPatterns);

  // Group patterns by response ID
  const patternsByResponseId = new Map<string, string[]>();
  for (const p of patterns) {
    const list = patternsByResponseId.get(p.responseId) ?? [];
    list.push(p.pattern);
    patternsByResponseId.set(p.responseId, list);
  }

  // Build the category reference for the prompt
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

  const systemPrompt = `You are a question classifier for the OC Mid-Cap Fund investor demo. Your job is to match the user's question to the single best-matching category from the list below.

Rules:
- Return ONLY the category name, nothing else (e.g. "fees" or "fund_manager")
- If no category is a good match, return "fallback"
- Match based on semantic meaning, not exact wording
- The user may phrase their question differently from the examples — use judgement

Available categories:

${categoryDescriptions}`;

  cachedData = { responses, systemPrompt };
  return cachedData;
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Match a user question to the best demo response using Bedrock Haiku.
 *
 * 1. Loads all responses + patterns from the DB (cached after first call)
 * 2. Builds a prompt listing every category with its label and example questions
 * 3. Asks Haiku to return the single best-matching category
 * 4. Returns the matched response with media URLs
 */
export async function matchQuestion(userText: string): Promise<MatchResult> {
  const MEDIA_BASE = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "";
  const { responses, systemPrompt } = await getCachedData();

  const requestBody = {
    anthropic_version: ANTHROPIC_VERSION,
    max_tokens: 50,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userText }],
  };

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: "application/json",
    accept: "application/json",
    body: JSON.stringify(requestBody),
  });

  const bedrockResponse = await getClient().send(command);
  const responseBody = JSON.parse(
    new TextDecoder().decode(bedrockResponse.body)
  );

  const rawCategory =
    responseBody.content
      ?.find((c: { type: string }) => c.type === "text")
      ?.text?.trim()
      .toLowerCase() ?? "fallback";

  // Clean up — Haiku sometimes wraps in quotes or adds explanation
  const category = rawCategory.replace(/[^a-z_]/g, "") || "fallback";

  logger.debug(
    {
      userText,
      matchedCategory: category,
      inputTokens: responseBody.usage?.input_tokens,
      outputTokens: responseBody.usage?.output_tokens,
    },
    "bedrock-matcher"
  );

  // Find the matched response
  const matched =
    responses.find((r) => r.category === category) ??
    responses.find((r) => r.category === "fallback");

  if (!matched) {
    // Should never happen if DB is seeded, but handle gracefully
    return {
      category: "fallback",
      label: "Fallback",
      answerText:
        "That's a great question. For more detail on that topic, I'd suggest speaking directly with our investor relations team.",
      audioUrl: `${MEDIA_BASE}/audio/fallback.mp3`,
      pcmUrl: `${MEDIA_BASE}/audio/fallback.pcm`,
      videoUrl: `${MEDIA_BASE}/video/fallback.mp4`,
    };
  }

  return {
    category: matched.category,
    label: matched.label,
    answerText: matched.answerText,
    audioUrl: `${MEDIA_BASE}/audio/${matched.category}.mp3`,
    pcmUrl: `${MEDIA_BASE}/audio/${matched.category}.pcm`,
    videoUrl: `${MEDIA_BASE}/video/${matched.category}.mp4`,
  };
}
