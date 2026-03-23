import type { ParsedResponse } from "./types";
import { generateText } from "@/src/lib/llm/bedrock-client";
import { logger } from "@/src/lib/logger";

const ACCEPT_KEYWORDS = new Set(["yes", "yep", "sure", "ok", "accept", "confirm", "y", "yeah", "yea"]);
const DECLINE_KEYWORDS = new Set(["no", "nope", "decline", "can't", "cant", "busy", "n", "nah", "pass"]);

/**
 * Parse an inbound SMS/email response using two-tier strategy:
 * 1. Keyword matching (fast, no LLM cost)
 * 2. LLM classification (fallback for ambiguous messages)
 */
export async function parseResponse(message: string): Promise<ParsedResponse> {
  const normalized = message.trim().toLowerCase();

  // Step 1: Try keyword matching (handles ~80% of responses)
  const keywordResult = matchKeywords(normalized);
  if (keywordResult && keywordResult.confidence >= 0.9) {
    return keywordResult;
  }

  // Step 2: Fall back to LLM for ambiguous messages
  return classifyWithLLM(message);
}

function matchKeywords(normalized: string): ParsedResponse | null {
  // Exact single-word match
  if (ACCEPT_KEYWORDS.has(normalized)) {
    return { intent: "accept", confidence: 1.0 };
  }
  if (DECLINE_KEYWORDS.has(normalized)) {
    return { intent: "decline", confidence: 1.0 };
  }

  // Check if message starts with keyword (e.g., "yes please", "no thanks")
  const firstWord = normalized.split(/\s+/)[0];
  if (firstWord && ACCEPT_KEYWORDS.has(firstWord)) {
    return { intent: "accept", confidence: 0.95 };
  }
  if (firstWord && DECLINE_KEYWORDS.has(firstWord)) {
    return { intent: "decline", confidence: 0.95 };
  }

  // Question markers
  if (normalized.includes("?")) {
    return { intent: "question", confidence: 0.85, question: normalized };
  }

  return null;
}

const VALID_INTENTS = new Set(["accept", "decline", "question"]);

const CLASSIFICATION_PROMPT = `You are classifying an SMS response to a shift offer.
The caregiver was asked: "Reply YES to accept or NO to decline."

Respond with ONLY valid JSON (no markdown):
{"intent": "accept"|"decline"|"question", "confidence": 0.0-1.0, "decline_reason": "optional", "question": "optional"}

Message: `;

async function classifyWithLLM(message: string): Promise<ParsedResponse> {
  try {
    // Sanitize: limit input length to prevent prompt injection via long messages
    const sanitized = message.slice(0, 500);
    const result = await generateText({
      messages: [{ role: "user", content: CLASSIFICATION_PROMPT + JSON.stringify(sanitized) }],
      maxTokens: 128,
      temperature: 0.1,
    });

    const parsed = JSON.parse(result.text) as ParsedResponse;
    if (!VALID_INTENTS.has(parsed.intent)) {
      throw new Error(`Invalid intent: ${String(parsed.intent)}`);
    }
    if (typeof parsed.confidence !== "number" || !isFinite(parsed.confidence)) {
      throw new Error(`Invalid confidence: ${String(parsed.confidence)}`);
    }
    return {
      intent: parsed.intent,
      confidence: Math.min(1, Math.max(0, parsed.confidence)),
      decline_reason: typeof parsed.decline_reason === "string" ? parsed.decline_reason : undefined,
      question: typeof parsed.question === "string" ? parsed.question : undefined,
    };
  } catch (err) {
    logger.error({ err: String(err), message }, "LLM response classification failed — defaulting to question");
    return { intent: "question", confidence: 0.3, question: message };
  }
}
