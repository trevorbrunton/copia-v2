import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockSMSProvider, TwilioSMSProvider, createSMSProvider } from "./sms-provider";

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

describe("MockSMSProvider", () => {
  it("should return a messageId on send", async () => {
    const provider = new MockSMSProvider();
    const result = await provider.send("+61400123456", "Hello");
    expect(result.messageId).toMatch(/^mock_/);
  });

  it("should always verify webhook as valid", async () => {
    const provider = new MockSMSProvider();
    const result = await provider.verifyWebhook("", new Headers());
    expect(result).toBe(true);
  });
});

describe("TwilioSMSProvider", () => {
  it("should throw when env vars missing", () => {
    expect(() => new TwilioSMSProvider()).toThrow("TwilioSMSProvider requires env vars");
  });

  it("should throw not-implemented on send when credentials present", async () => {
    process.env.TWILIO_ACCOUNT_SID = "test";
    process.env.TWILIO_AUTH_TOKEN = "test";
    process.env.TWILIO_FROM_NUMBER = "+1234567890";
    try {
      const provider = new TwilioSMSProvider();
      await expect(provider.send("+61400123456", "Hello")).rejects.toThrow("not implemented");
    } finally {
      delete process.env.TWILIO_ACCOUNT_SID;
      delete process.env.TWILIO_AUTH_TOKEN;
      delete process.env.TWILIO_FROM_NUMBER;
    }
  });
});

describe("createSMSProvider", () => {
  const originalEnv = process.env.SMS_ENABLED;

  beforeEach(() => {
    process.env.SMS_ENABLED = originalEnv;
  });

  it("should return MockSMSProvider when SMS_ENABLED is false", () => {
    process.env.SMS_ENABLED = "false";
    const provider = createSMSProvider();
    expect(provider).toBeInstanceOf(MockSMSProvider);
  });

  it("should return MockSMSProvider when SMS_ENABLED is unset", () => {
    delete process.env.SMS_ENABLED;
    const provider = createSMSProvider();
    expect(provider).toBeInstanceOf(MockSMSProvider);
  });

  it("should throw when SMS_ENABLED is true but Twilio credentials missing", () => {
    process.env.SMS_ENABLED = "true";
    expect(() => createSMSProvider()).toThrow("TwilioSMSProvider requires env vars");
  });
});
