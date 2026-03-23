import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/llm/bedrock-client", () => ({
  generateText: vi.fn(),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { parseResponse } from "./response-handler";
import { generateText } from "@/src/lib/llm/bedrock-client";

describe("parseResponse — keyword matching", () => {
  it("should classify 'yes' as accept", async () => {
    const result = await parseResponse("yes");
    expect(result.intent).toBe("accept");
    expect(result.confidence).toBe(1.0);
  });

  it("should classify 'no' as decline", async () => {
    const result = await parseResponse("no");
    expect(result.intent).toBe("decline");
    expect(result.confidence).toBe(1.0);
  });

  it("should classify 'y' as accept", async () => {
    const result = await parseResponse("y");
    expect(result.intent).toBe("accept");
    expect(result.confidence).toBe(1.0);
  });

  it("should classify 'n' as decline", async () => {
    const result = await parseResponse("n");
    expect(result.intent).toBe("decline");
    expect(result.confidence).toBe(1.0);
  });

  it("should classify 'yes please' as accept with high confidence", async () => {
    const result = await parseResponse("yes please");
    expect(result.intent).toBe("accept");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should classify 'no thanks' as decline with high confidence", async () => {
    const result = await parseResponse("no thanks");
    expect(result.intent).toBe("decline");
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("should classify question marks as question intent", async () => {
    const result = await parseResponse("what time does it start?");
    expect(result.intent).toBe("question");
    expect(result.question).toContain("what time");
  });

  it("should handle case insensitivity", async () => {
    const result = await parseResponse("YES");
    expect(result.intent).toBe("accept");
  });
});

describe("parseResponse — LLM fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should fall back to LLM for ambiguous messages", async () => {
    vi.mocked(generateText).mockResolvedValue({
      text: JSON.stringify({ intent: "accept", confidence: 0.8 }),
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    const result = await parseResponse("I reckon I could probably manage that one");
    expect(result.intent).toBe("accept");
    expect(result.confidence).toBe(0.8);
  });

  it("should default to question when LLM fails", async () => {
    vi.mocked(generateText).mockRejectedValue(new Error("Bedrock timeout"));

    const result = await parseResponse("I might be available depending on traffic");
    expect(result.intent).toBe("question");
    expect(result.confidence).toBeLessThan(0.5);
  });
});
