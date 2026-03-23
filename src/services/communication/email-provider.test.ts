import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { MockEmailProvider, SESEmailProvider, createEmailProvider, resetEmailProvider } from "./email-provider";

describe("MockEmailProvider", () => {
  it("should store sent emails and return messageId", async () => {
    const provider = new MockEmailProvider();
    const result = await provider.send({
      to: "test@example.com",
      subject: "Test Subject",
      body: "Test body",
    });

    expect(result.messageId).toMatch(/^mock_email_/);
    expect(provider.getSentEmails()).toHaveLength(1);
    expect(provider.getSentEmails()[0].to).toBe("test@example.com");
    expect(provider.getSentEmails()[0].subject).toBe("Test Subject");
  });

  it("should clear sent emails", async () => {
    const provider = new MockEmailProvider();
    await provider.send({ to: "a@b.com", subject: "s", body: "b" });
    expect(provider.getSentEmails()).toHaveLength(1);

    provider.clearSentEmails();
    expect(provider.getSentEmails()).toHaveLength(0);
  });
});

describe("SESEmailProvider", () => {
  it("should throw when env vars are missing", () => {
    delete process.env.SES_REGION;
    delete process.env.SES_FROM_ADDRESS;
    expect(() => new SESEmailProvider()).toThrow("SES_REGION and SES_FROM_ADDRESS");
  });
});

describe("createEmailProvider", () => {
  afterEach(() => {
    resetEmailProvider();
    delete process.env.EMAIL_ENABLED;
  });

  it("should return MockEmailProvider by default", () => {
    const provider = createEmailProvider();
    expect(provider).toBeInstanceOf(MockEmailProvider);
  });

  it("should return singleton on repeated calls", () => {
    const first = createEmailProvider();
    const second = createEmailProvider();
    expect(first).toBe(second);
  });
});
