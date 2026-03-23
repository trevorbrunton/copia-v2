import type { SMSProvider } from "./types";
import { logger } from "@/src/lib/logger";

/**
 * Mock SMS provider for development — logs messages via structured logger.
 * In-memory state does NOT persist across serverless invocations.
 * Sent messages are visible in the audit trail (written by the dispatcher).
 */
export class MockSMSProvider implements SMSProvider {
  async send(to: string, body: string): Promise<{ messageId: string }> {
    const messageId = `mock_${crypto.randomUUID()}`;
    logger.info({ to, messageId, bodyLength: body.length }, "mock-sms-sent");
    return { messageId };
  }

  async verifyWebhook(_body: string, _headers: Headers): Promise<boolean> {
    return true; // Always valid in mock mode
  }
}

/**
 * Twilio SMS provider — stub for go-live sprint.
 * Requires TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER env vars.
 */
export class TwilioSMSProvider implements SMSProvider {
  constructor() {
    const required = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"] as const;
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
      throw new Error(`TwilioSMSProvider requires env vars: ${missing.join(", ")}`);
    }
  }

  async send(_to: string, _body: string): Promise<{ messageId: string }> {
    throw new Error("TwilioSMSProvider not implemented — deferred to go-live sprint");
  }

  async verifyWebhook(_body: string, _headers: Headers): Promise<boolean> {
    throw new Error("TwilioSMSProvider not implemented — deferred to go-live sprint");
  }
}

/** Factory: returns MockSMSProvider unless SMS_ENABLED=true. */
export function createSMSProvider(): SMSProvider {
  if (process.env.SMS_ENABLED === "true") {
    return new TwilioSMSProvider();
  }
  return new MockSMSProvider();
}
