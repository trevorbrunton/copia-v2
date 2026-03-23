import { describe, it, expect, vi } from "vitest";
import { dispatchContact } from "./dispatcher";
import type { RosterTask } from "@/src/db/schema";
import type { ScoredCandidate } from "@/src/services/scoring/types";
import type { SMSProvider } from "./types";

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const mockTask = {
  id: "task-123",
  clientId: 10,
  detectedAt: new Date("2026-03-12T08:00:00Z"),
} as RosterTask;

const mockCandidate: ScoredCandidate = {
  employee_id: 1,
  employee_name: "Alice Smith",
  overall: 0.85,
  confidence: "high",
  dimensions: {
    skills: { score: 0.9, confidence: "high", reason: "" },
    relationship: { score: 0.8, confidence: "medium", reason: "" },
    proximity: { score: 0.7, confidence: "high", reason: "" },
    workload: { score: 0.9, confidence: "high", reason: "" },
    acceptance: { score: 0.85, confidence: "high", reason: "" },
  },
  warnings: [],
};

describe("dispatchContact", () => {
  it("should send SMS and return ContactAttempt", async () => {
    const mockProvider: SMSProvider = {
      send: vi.fn().mockResolvedValue({ messageId: "msg-123" }),
      verifyWebhook: vi.fn<(body: string, headers: Headers) => Promise<boolean>>().mockResolvedValue(true),
    };

    const result = await dispatchContact(
      mockTask,
      mockCandidate,
      "+61400123456",
      "sms",
      mockProvider,
      20
    );

    expect(mockProvider.send).toHaveBeenCalledWith("+61400123456", expect.stringContaining("Alice Smith"));
    expect(result.messageId).toBe("msg-123");
    expect(result.attempt.employee_id).toBe(1);
    expect(result.attempt.contact_address).toBe("+61400123456");
    expect(result.attempt.channel).toBe("sms");
    expect(result.attempt.response).toBe("pending");
  });

  it("should set expiry based on expiryMinutes", async () => {
    const mockProvider: SMSProvider = {
      send: vi.fn().mockResolvedValue({ messageId: "msg-456" }),
      verifyWebhook: vi.fn<(body: string, headers: Headers) => Promise<boolean>>().mockResolvedValue(true),
    };

    const result = await dispatchContact(
      mockTask,
      mockCandidate,
      "+61400123456",
      "sms",
      mockProvider,
      30
    );

    const sentAt = new Date(result.attempt.sent_at).getTime();
    const expiresAt = new Date(result.attempt.expires_at).getTime();
    expect(expiresAt - sentAt).toBe(30 * 60 * 1000);
  });
});
