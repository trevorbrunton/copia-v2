/** SMS provider interface — implemented by MockSMSProvider and TwilioSMSProvider. */
export interface SMSProvider {
  send(to: string, body: string): Promise<{ messageId: string }>;
  verifyWebhook(body: string, headers: Headers): Promise<boolean>;
}

/** Email provider interface — implemented by MockEmailProvider and SESEmailProvider. */
export interface EmailProvider {
  send(options: {
    to: string;
    subject: string;
    body: string;
    html?: string;
  }): Promise<{ messageId: string }>;
}

/** A message template with variable substitution. */
export interface MessageTemplate {
  subject?: string;
  body: string;
  variables: Record<string, string>;
}

/** Result of parsing an inbound SMS/email response. */
export interface ParsedResponse {
  intent: "accept" | "decline" | "question";
  confidence: number;
  decline_reason?: string;
  question?: string;
}
