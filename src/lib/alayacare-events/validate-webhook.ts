import { timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { UnauthorizedError, AppError } from "@/src/server/errors";

/** Validate the webhook shared secret header (M2M auth, not Supabase user auth). */
export function validateWebhookSecret(request: NextRequest): void {
  const secret = request.headers.get("x-webhook-secret");
  const expected = process.env.ALAYACARE_WEBHOOK_SECRET;

  if (!expected) {
    throw new AppError("Webhook secret not configured", "CONFIG_ERROR", 500);
  }
  if (
    !secret ||
    secret.length !== expected.length ||
    !timingSafeEqual(Buffer.from(secret), Buffer.from(expected))
  ) {
    throw new UnauthorizedError("Invalid webhook secret");
  }
}
