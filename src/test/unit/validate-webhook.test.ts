import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { validateWebhookSecret } from "@/src/lib/alayacare-events/validate-webhook";

function makeRequest(secret?: string): NextRequest {
  const headers = new Headers();
  if (secret !== undefined) {
    headers.set("x-webhook-secret", secret);
  }
  return new NextRequest("http://localhost:3000/api/v1/webhooks/alayacare", {
    method: "POST",
    headers,
  });
}

describe("validateWebhookSecret", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  it("should pass when secret matches", () => {
    process.env.ALAYACARE_WEBHOOK_SECRET = "test-secret";
    const req = makeRequest("test-secret");
    expect(() => validateWebhookSecret(req)).not.toThrow();
  });

  it("should throw UnauthorizedError when secret is missing", () => {
    process.env.ALAYACARE_WEBHOOK_SECRET = "test-secret";
    const req = makeRequest(); // no header
    expect(() => validateWebhookSecret(req)).toThrow("Invalid webhook secret");
  });

  it("should throw UnauthorizedError when secret is wrong", () => {
    process.env.ALAYACARE_WEBHOOK_SECRET = "test-secret";
    const req = makeRequest("wrong-secret");
    expect(() => validateWebhookSecret(req)).toThrow("Invalid webhook secret");
  });

  it("should throw AppError when env var is not configured", () => {
    delete process.env.ALAYACARE_WEBHOOK_SECRET;
    const req = makeRequest("any-secret");
    expect(() => validateWebhookSecret(req)).toThrow(
      "Webhook secret not configured"
    );
  });
});
