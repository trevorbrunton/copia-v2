/**
 * Reasoning service — connects the scoring engine to the LLM.
 *
 * Takes a MatchResult, visit context, and client context, builds a prompt,
 * sends it to the LLM, and returns a validated LLMRecommendation.
 */
import type { MatchResult } from "../scoring/types";
import type {
  LLMRecommendation,
  VisitContext,
  ClientContext,
  ReasoningContext,
} from "./types";
import { ROSTERING_SYSTEM_PROMPT, buildReasoningPrompt } from "./prompts";
import { parseLLMResponse } from "./parse-response";
import { generateText } from "@/src/lib/llm/bedrock-client";
import { DEFAULT_MODEL } from "@/src/lib/llm/types";

/** Reasoning temperature — low for consistent rostering decisions. */
const REASONING_TEMPERATURE = 0.3;
const REASONING_MAX_TOKENS = 1024;

export interface GetRecommendationOptions {
  visit: VisitContext;
  client: ClientContext | null;
  matchResult: MatchResult;
  context: ReasoningContext;
}

/**
 * Get an LLM recommendation for a scored match result.
 *
 * Builds a structured prompt from the match result and context, sends it to
 * the LLM, parses the structured JSON response, and returns a validated
 * LLMRecommendation.
 *
 * @throws Error if the LLM response cannot be parsed or validated.
 */
export async function getRecommendation(
  options: GetRecommendationOptions,
): Promise<LLMRecommendation> {
  const { visit, client, matchResult, context } = options;

  const prompt = buildReasoningPrompt(visit, client, matchResult, context);

  const result = await generateText({
    system: ROSTERING_SYSTEM_PROMPT,
    messages: [{ role: "user", content: prompt }],
    temperature: REASONING_TEMPERATURE,
    maxTokens: REASONING_MAX_TOKENS,
  });

  const parsed = parseLLMResponse(result.text);
  if (!parsed.ok) {
    throw new Error(`LLM response parse error: ${parsed.error}`);
  }

  return {
    ...parsed.data,
    model: DEFAULT_MODEL,
    usage: result.usage ?? { inputTokens: 0, outputTokens: 0 },
  };
}
