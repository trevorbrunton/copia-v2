import { describe, it, expect } from "vitest";
import { parseLLMResponse } from "./parse-response";

describe("parseLLMResponse", () => {
  const validPayload = {
    primary: {
      employee_id: 1,
      employee_name: "Alice Smith",
      explanation: "Alice is the best match due to proximity and high acceptance rate.",
      confidence: "high" as const,
    },
    escalation: {
      should_escalate: false,
      reason: null,
      urgency: "informational" as const,
    },
    factors_considered: ["Proximity to client", "High acceptance rate"],
    trade_offs: ["Further from client than Bob but better acceptance"],
  };

  it("should parse valid JSON response", () => {
    const result = parseLLMResponse(JSON.stringify(validPayload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.primary.employee_id).toBe(1);
      expect(result.data.primary.employee_name).toBe("Alice Smith");
      expect(result.data.escalation.should_escalate).toBe(false);
      expect(result.data.factors_considered).toHaveLength(2);
    }
  });

  it("should strip markdown json fences", () => {
    const wrapped = "```json\n" + JSON.stringify(validPayload) + "\n```";
    const result = parseLLMResponse(wrapped);
    expect(result.ok).toBe(true);
  });

  it("should strip plain markdown fences", () => {
    const wrapped = "```\n" + JSON.stringify(validPayload) + "\n```";
    const result = parseLLMResponse(wrapped);
    expect(result.ok).toBe(true);
  });

  it("should handle whitespace around JSON", () => {
    const padded = "  \n" + JSON.stringify(validPayload) + "\n  ";
    const result = parseLLMResponse(padded);
    expect(result.ok).toBe(true);
  });

  it("should return error for empty response", () => {
    const result = parseLLMResponse("");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Empty response from LLM");
    }
  });

  it("should return error for invalid JSON", () => {
    const result = parseLLMResponse("not json at all");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Invalid JSON/);
    }
  });

  it("should return validation error for missing required fields", () => {
    const incomplete = JSON.stringify({ primary: { employee_id: 1 } });
    const result = parseLLMResponse(incomplete);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed/);
    }
  });

  it("should return validation error for invalid confidence value", () => {
    const bad = {
      ...validPayload,
      primary: { ...validPayload.primary, confidence: "very_high" },
    };
    const result = parseLLMResponse(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed/);
    }
  });

  it("should return validation error for invalid urgency value", () => {
    const bad = {
      ...validPayload,
      escalation: { ...validPayload.escalation, urgency: "asap" },
    };
    const result = parseLLMResponse(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/Validation failed/);
    }
  });

  it("should accept escalation with should_escalate true and reason", () => {
    const escalated = {
      ...validPayload,
      escalation: {
        should_escalate: true,
        reason: "Only 1 viable candidate",
        urgency: "before_shift" as const,
      },
    };
    const result = parseLLMResponse(JSON.stringify(escalated));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.escalation.should_escalate).toBe(true);
      expect(result.data.escalation.reason).toBe("Only 1 viable candidate");
      expect(result.data.escalation.urgency).toBe("before_shift");
    }
  });

  it("should accept zero-candidate escalation response", () => {
    const noCandidates = {
      primary: {
        employee_id: 0,
        employee_name: "None",
        explanation: "No eligible candidates after hard constraint filtering.",
        confidence: "low" as const,
      },
      escalation: {
        should_escalate: true,
        reason: "Zero eligible employees",
        urgency: "immediate" as const,
      },
      factors_considered: ["All employees filtered out by skill requirements"],
      trade_offs: [],
    };
    const result = parseLLMResponse(JSON.stringify(noCandidates));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.primary.employee_id).toBe(0);
      expect(result.data.escalation.urgency).toBe("immediate");
    }
  });

  it("should accept empty factors and trade-offs arrays", () => {
    const minimal = {
      ...validPayload,
      factors_considered: [],
      trade_offs: [],
    };
    const result = parseLLMResponse(JSON.stringify(minimal));
    expect(result.ok).toBe(true);
  });
});
