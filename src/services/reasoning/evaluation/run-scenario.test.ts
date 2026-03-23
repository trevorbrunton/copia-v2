import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: vi.fn(),
}));

vi.mock("@/src/lib/llm/bedrock-client", () => ({
  generateText: vi.fn(),
}));

import { alayaFetch } from "@/src/lib/alayacare-client";
import { generateText } from "@/src/lib/llm/bedrock-client";
import { runScenarioEvaluation } from "./run-scenario";
import { SCENARIOS } from "../../scoring/scenario-test-helpers";
import { SCENARIO_BASELINES } from "../scenario-baselines";

const mockedAlayaFetch = vi.mocked(alayaFetch);
const mockedGenerateText = vi.mocked(generateText);

const validLLMResponse = JSON.stringify({
  primary: {
    employee_id: 1,
    employee_name: "Alice Smith",
    explanation: "Alice is the best match due to proximity and relationship.",
    confidence: "high",
  },
  escalation: {
    should_escalate: false,
    reason: null,
    urgency: "informational",
  },
  factors_considered: ["proximity", "relationship"],
  trade_offs: ["slightly higher workload"],
});

const escalatedLLMResponse = JSON.stringify({
  primary: {
    employee_id: 0,
    employee_name: "None",
    explanation: "No eligible candidates after filtering.",
    confidence: "low",
  },
  escalation: {
    should_escalate: true,
    reason: "Zero eligible employees",
    urgency: "immediate",
  },
  factors_considered: ["All employees filtered out"],
  trade_offs: [],
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("runScenarioEvaluation", () => {
  it("should run a straightforward scenario and return an evaluation result", async () => {
    const scenario = SCENARIOS.find((s) => s.id === "S1")!;
    const baseline = SCENARIO_BASELINES.find((b) => b.id === "S1")!;

    // Set up scoring mock
    scenario.setup(mockedAlayaFetch);

    // Set up LLM mock
    mockedGenerateText.mockResolvedValue({
      text: validLLMResponse,
      usage: { inputTokens: 500, outputTokens: 200 },
    });

    const result = await runScenarioEvaluation(scenario, baseline);

    expect(result.scenario_id).toBe("S1");
    expect(result.classification).toBe("straightforward");
    expect(result.match_result).toBeDefined();
    expect(result.match_result.candidates.length).toBeGreaterThan(0);
    expect(result.recommendation).toBeDefined();
    expect(result.recommendation!.primary.employee_id).toBe(1);
    expect(result.baseline).toBe(baseline);
    expect(result.error).toBeUndefined();
  });

  it("should handle zero-candidate scenario (H1)", async () => {
    const scenario = SCENARIOS.find((s) => s.id === "H1")!;
    const baseline = SCENARIO_BASELINES.find((b) => b.id === "H1")!;

    scenario.setup(mockedAlayaFetch);
    mockedGenerateText.mockResolvedValue({
      text: escalatedLLMResponse,
      usage: { inputTokens: 300, outputTokens: 150 },
    });

    const result = await runScenarioEvaluation(scenario, baseline);

    expect(result.scenario_id).toBe("H1");
    expect(result.match_result.candidates).toHaveLength(0);
    expect(result.recommendation!.escalation.should_escalate).toBe(true);
    expect(result.recommendation!.escalation.urgency).toBe("immediate");
  });

  it("should capture error when LLM returns invalid response", async () => {
    const scenario = SCENARIOS.find((s) => s.id === "S1")!;
    const baseline = SCENARIO_BASELINES.find((b) => b.id === "S1")!;

    scenario.setup(mockedAlayaFetch);
    mockedGenerateText.mockResolvedValue({
      text: "I cannot process this request.",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const result = await runScenarioEvaluation(scenario, baseline);

    expect(result.scenario_id).toBe("S1");
    expect(result.recommendation).toBeNull();
    expect(result.error).toBeDefined();
    expect(result.error).toContain("LLM response parse error");
  });

  it("should pass MatchResult context to the reasoning service", async () => {
    const scenario = SCENARIOS.find((s) => s.id === "P1")!;
    const baseline = SCENARIO_BASELINES.find((b) => b.id === "P1")!;

    scenario.setup(mockedAlayaFetch);
    mockedGenerateText.mockResolvedValue({
      text: validLLMResponse,
      usage: { inputTokens: 500, outputTokens: 200 },
    });

    await runScenarioEvaluation(scenario, baseline);

    // Verify LLM was called with prompt containing scenario data
    expect(mockedGenerateText).toHaveBeenCalledOnce();
    const call = mockedGenerateText.mock.calls[0][0];
    expect(call.messages[0].content).toContain("Visit ID: 100");
    expect(call.system).toContain("rostering assistant");
  });

  it("should handle null client scenarios (N4)", async () => {
    const scenario = SCENARIOS.find((s) => s.id === "N4")!;
    const baseline = SCENARIO_BASELINES.find((b) => b.id === "N4")!;

    scenario.setup(mockedAlayaFetch);
    mockedGenerateText.mockResolvedValue({
      text: validLLMResponse,
      usage: { inputTokens: 400, outputTokens: 180 },
    });

    const result = await runScenarioEvaluation(scenario, baseline);

    expect(result.match_result.client_id).toBeNull();
    expect(result.recommendation).toBeDefined();

    // Verify prompt mentions no client
    const prompt = mockedGenerateText.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("No client assigned");
  });
});
