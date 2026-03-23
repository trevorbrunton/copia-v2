import { logger } from "@/src/lib/logger";
import type { EmailProvider } from "./types";

interface SentEmail {
  to: string;
  subject: string;
  body: string;
  html?: string;
  messageId: string;
  sentAt: Date;
}

export class MockEmailProvider implements EmailProvider {
  private sentEmails: SentEmail[] = [];

  async send(options: {
    to: string;
    subject: string;
    body: string;
    html?: string;
  }): Promise<{ messageId: string }> {
    const messageId = `mock_email_${crypto.randomUUID()}`;
    this.sentEmails.push({ ...options, messageId, sentAt: new Date() });
    logger.info(
      { to: options.to, subject: options.subject, messageId },
      "Mock email sent"
    );
    return { messageId };
  }

  getSentEmails(): SentEmail[] {
    return this.sentEmails;
  }

  clearSentEmails(): void {
    this.sentEmails = [];
  }
}

export class SESEmailProvider implements EmailProvider {
  private readonly region: string;
  private readonly fromAddress: string;

  constructor() {
    const region = process.env.SES_REGION;
    const fromAddress = process.env.SES_FROM_ADDRESS;
    if (!region || !fromAddress) {
      throw new Error("SESEmailProvider requires SES_REGION and SES_FROM_ADDRESS env vars");
    }
    this.region = region;
    this.fromAddress = fromAddress;
  }

  async send(_options: {
    to: string;
    subject: string;
    body: string;
    html?: string;
  }): Promise<{ messageId: string }> {
    // Stub — real SES integration deferred to go-live sprint
    throw new Error("SES email provider not yet implemented — use MockEmailProvider for development");
  }
}

let emailProviderInstance: EmailProvider | null = null;

export function createEmailProvider(): EmailProvider {
  if (emailProviderInstance) return emailProviderInstance;

  if (process.env.EMAIL_ENABLED === "true") {
    emailProviderInstance = new SESEmailProvider();
  } else {
    emailProviderInstance = new MockEmailProvider();
  }
  return emailProviderInstance;
}

/** Reset singleton (for tests). */
export function resetEmailProvider(): void {
  emailProviderInstance = null;
}
