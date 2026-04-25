/**
 * Claude Haiku response matcher for the investor demo.
 *
 * Loads all demo responses + question patterns from the database,
 * sends them to Claude Haiku via the Anthropic API, and asks it to pick
 * the best matching category for a user's question.
 */

import { db } from "@/src/db";
import { demoResponses, demoQuestionPatterns } from "@/src/db/schema";
import { logger } from "@/src/lib/logger";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY ?? "";
const MODEL_ID = process.env.ANTHROPIC_MODEL_ID || "claude-haiku-4-5-20251001";

export interface MatchResult {
  category: string;
  label: string;
  answerText: string;
  audioUrl: string;
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
 * Match a user question to the best demo response using Claude Haiku.
 *
 * 1. Loads all responses + patterns from the DB (cached after first call)
 * 2. Builds a prompt listing every category with its label and example questions
 * 3. Asks Haiku to return the single best-matching category
 * 4. Returns the matched response with media URLs
 */
export async function matchQuestion(userText: string): Promise<MatchResult> {
  const MEDIA_BASE = process.env.NEXT_PUBLIC_MEDIA_BASE_URL ?? "";
  const { responses, systemPrompt } = await getCachedData();

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL_ID,
      max_tokens: 50,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userText }],
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Anthropic API error: ${res.status} ${errBody}`);
  }

  const responseBody = await res.json();

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
    "anthropic-matcher"
  );

  // Find the matched response
  const matched =
    responses.find((r) => r.category === category) ??
    responses.find((r) => r.category === "fallback");

  if (!matched) {
    return {
      category: "fallback",
      label: "Fallback",
      answerText:
        "That's a great question. For more detail on that topic, I'd suggest speaking directly with our investor relations team.",
      audioUrl: `${MEDIA_BASE}/audio/fallback.mp3`,
      videoUrl: `${MEDIA_BASE}/video/fallback.mp4`,
    };
  }

  return {
    category: matched.category,
    label: matched.label,
    answerText: matched.answerText,
    audioUrl: `${MEDIA_BASE}/audio/${matched.category}.mp3`,
    videoUrl: `${MEDIA_BASE}/video/${matched.category}.mp4`,
  };
}
