import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/llm/bedrock-client", () => ({
  generateText: vi.fn(),
}));

import { generateText } from "@/src/lib/llm/bedrock-client";
import { getRecommendation } from "./reasoning-service";
import type { MatchResult, ScoredCandidate, WeightConfig } from "../scoring/types";
import type { VisitContext, ClientContext, ReasoningContext } from "./types";

const mockedGenerateText = vi.mocked(generateText);

// ── Test data ──

const weights: WeightConfig = {
  skills: 0.20, relationship: 0.30, proximity: 0.15, workload: 0.20, acceptance: 0.15,
};

const candidate: ScoredCandidate = {
  employee_id: 1,
  employee_name: "Alice Smith",
  overall: 0.85,
  confidence: "high",
  dimensions: {
    skills: { score: 1.0, confidence: "high", reason: "All skills present" },
    relationship: { score: 0.9, confidence: "high", reason: "15 visits" },
    proximity: { score: 0.95, confidence: "high", reason: "2km" },
    workload: { score: 0.7, confidence: "medium", reason: "1 shift" },
    acceptance: { score: 0.9, confidence: "high", reason: "90%" },
  },
  warnings: [],
};

const matchResult: MatchResult = {
  visit_id: 100, client_id: 10,
  candidates: [candidate],
  weights_used: weights,
  preset_name: "planned",
  candidate_pool_size: 4, eligible_pool_size: 3,
  data_warnings: [],
  match_confidence: "high",
  scored_at: "2026-03-15T08:00:00Z",
};

const visit: VisitContext = {
  id: 100,
  start_at: "2026-03-15T09:00:00Z",
  end_at: "2026-03-15T11:00:00Z",
  status: "scheduled",
};

const client: ClientContext = {
  first_name: "Margaret", last_name: "Thompson",
  city: "Melbourne", state: "VIC",
};

const context: ReasoningContext = { urgency: "planned" };

const validLLMResponse = JSON.stringify({
  primary: {
    employee_id: 1,
    employee_name: "Alice Smith",
    explanation: "Alice is the best match due to proximity and strong relationship.",
    confidence: "high",
  },
  escalation: {
    should_escalate: false,
    reason: null,
    urgency: "informational",
  },
  factors_considered: ["Strong relationship history", "Close proximity"],
  trade_offs: ["Slightly higher workload than alternatives"],
});

// ── Tests ──

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getRecommendation", () => {
  it("should call generateText with system prompt and low temperature", async () => {
    mockedGenerateText.mockResolvedValue({
      text: validLLMResponse,
      usage: { inputTokens: 500, outputTokens: 200 },
    });

    await getRecommendation({ visit, client, matchResult, context });

    expect(mockedGenerateText).toHaveBeenCalledOnce();
    const call = mockedGenerateText.mock.calls[0][0];
    expect(call.system).toContain("rostering assistant");
    expect(call.temperature).toBe(0.3);
    expect(call.maxTokens).toBe(1024);
    expect(call.messages).toHaveLength(1);
    expect(call.messages[0].role).toBe("user");
  });

  it("should include visit and client details in the prompt", async () => {
    mockedGenerateText.mockResolvedValue({
      text: validLLMResponse,
      usage: { inputTokens: 500, outputTokens: 200 },
    });

    await getRecommendation({ visit, client, matchResult, context });

    const prompt = mockedGenerateText.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("Visit ID: 100");
    expect(prompt).toContain("Margaret Thompson");
    expect(prompt).toContain("Urgency: planned");
  });

  it("should return a valid LLMRecommendation with metadata", async () => {
    mockedGenerateText.mockResolvedValue({
      text: validLLMResponse,
      usage: { inputTokens: 500, outputTokens: 200 },
    });

    const result = await getRecommendation({ visit, client, matchResult, context });

    expect(result.primary.employee_id).toBe(1);
    expect(result.primary.employee_name).toBe("Alice Smith");
    expect(result.escalation.should_escalate).toBe(false);
    expect(result.factors_considered).toHaveLength(2);
    expect(result.model).toBe("au.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(result.usage.inputTokens).toBe(500);
    expect(result.usage.outputTokens).toBe(200);
  });

  it("should handle LLM response wrapped in markdown fences", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "```json\n" + validLLMResponse + "\n```",
      usage: { inputTokens: 500, outputTokens: 200 },
    });

    const result = await getRecommendation({ visit, client, matchResult, context });
    expect(result.primary.employee_id).toBe(1);
  });

  it("should throw on invalid LLM response", async () => {
    mockedGenerateText.mockResolvedValue({
      text: "I'm sorry, I can't process that request.",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    await expect(
      getRecommendation({ visit, client, matchResult, context })
    ).rejects.toThrow("LLM response parse error");
  });

  it("should throw on structurally invalid JSON from LLM", async () => {
    mockedGenerateText.mockResolvedValue({
      text: JSON.stringify({ primary: { employee_id: "not a number" } }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    await expect(
      getRecommendation({ visit, client, matchResult, context })
    ).rejects.toThrow("Validation failed");
  });

  it("should handle null client", async () => {
    mockedGenerateText.mockResolvedValue({
      text: validLLMResponse,
      usage: { inputTokens: 500, outputTokens: 200 },
    });

    const result = await getRecommendation({ visit, client: null, matchResult, context });

    const prompt = mockedGenerateText.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("No client assigned");
    expect(result.primary.employee_id).toBe(1);
  });

  it("should handle missing usage in LLM response", async () => {
    mockedGenerateText.mockResolvedValue({
      text: validLLMResponse,
    } as { text: string; usage: undefined });

    const result = await getRecommendation({ visit, client, matchResult, context });
    expect(result.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("should handle escalation response", async () => {
    const escalatedResponse = JSON.stringify({
      primary: {
        employee_id: 0,
        employee_name: "None",
        explanation: "No eligible candidates.",
        confidence: "low",
      },
      escalation: {
        should_escalate: true,
        reason: "Zero eligible employees after filtering",
        urgency: "immediate",
      },
      factors_considered: ["All employees filtered by skill requirements"],
      trade_offs: [],
    });

    mockedGenerateText.mockResolvedValue({
      text: escalatedResponse,
      usage: { inputTokens: 400, outputTokens: 150 },
    });

    const result = await getRecommendation({ visit, client, matchResult, context });
    expect(result.primary.employee_id).toBe(0);
    expect(result.escalation.should_escalate).toBe(true);
    expect(result.escalation.urgency).toBe("immediate");
  });
});
