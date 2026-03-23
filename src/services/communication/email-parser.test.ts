import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GenerateResult } from "@/src/lib/llm/types";

vi.mock("@/src/lib/llm/bedrock-client", () => ({
  generateText: vi.fn(),
}));
vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { parseHandoverEmail } from "./email-parser";
import { generateText } from "@/src/lib/llm/bedrock-client";

function makeResult(text: string): GenerateResult {
  return { text, usage: { inputTokens: 10, outputTokens: 20 } };
}

describe("parseHandoverEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should parse a well-structured email", async () => {
    vi.mocked(generateText).mockResolvedValue(makeResult(JSON.stringify({
      client_name: "Jane Doe",
      date: "2026-03-15",
      time: "08:00",
      requirements: "Morning care, medication administration",
      confidence: 0.9,
    })));

    const result = await parseHandoverEmail("Hi, I need someone to cover Jane Doe's shift on March 15 at 8am.");

    expect(result.shift_details.client_name).toBe("Jane Doe");
    expect(result.shift_details.date).toBe("2026-03-15");
    expect(result.shift_details.time).toBe("08:00");
    expect(result.confidence).toBe(0.9);
  });

  it("should handle partial extraction", async () => {
    vi.mocked(generateText).mockResolvedValue(makeResult(JSON.stringify({
      client_name: "John Smith",
      date: null,
      time: null,
      requirements: null,
      confidence: 0.4,
    })));

    const result = await parseHandoverEmail("John Smith needs a carer.");

    expect(result.shift_details.client_name).toBe("John Smith");
    expect(result.shift_details.date).toBeUndefined();
    expect(result.confidence).toBe(0.4);
  });

  it("should return fallback on LLM failure", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("Bedrock timeout"));

    const result = await parseHandoverEmail("Some email content");

    expect(result.confidence).toBe(0);
    expect(result.shift_details).toEqual({});
    expect(result.raw_text).toBe("Some email content");
  });

  it("should return fallback when LLM returns non-JSON", async () => {
    vi.mocked(generateText).mockResolvedValue(makeResult("I cannot parse this email."));

    const result = await parseHandoverEmail("Unclear email");

    expect(result.confidence).toBe(0);
    expect(result.shift_details).toEqual({});
  });

  it("should clamp confidence to [0, 1]", async () => {
    vi.mocked(generateText).mockResolvedValue(makeResult(JSON.stringify({
      client_name: "Test",
      confidence: 1.5,
    })));

    const result = await parseHandoverEmail("Test email");
    expect(result.confidence).toBe(1);
  });

  it("should truncate long emails to 2000 chars", async () => {
    vi.mocked(generateText).mockResolvedValue(makeResult(JSON.stringify({
      client_name: "Test",
      confidence: 0.5,
    })));

    const longEmail = "x".repeat(5000);
    await parseHandoverEmail(longEmail);

    const passedOptions = vi.mocked(generateText).mock.calls[0][0];
    const userMessage = passedOptions.messages[0].content;
    expect(userMessage.length).toBeLessThan(5000);
  });
});
