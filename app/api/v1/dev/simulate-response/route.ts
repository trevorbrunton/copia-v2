import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleSMSResponse } from "@/src/server/commands/webhooks/handle-sms-response";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

/**
 * Development-only endpoint — simulates a caregiver responding to an SMS offer.
 * Guards: only available when SMS_ENABLED=false AND NODE_ENV !== "production"
 */
export async function POST(req: Request) {
  // Guard: don't expose in production or when real SMS is enabled
  if (process.env.NODE_ENV === "production" || process.env.SMS_ENABLED === "true") {
    return new Response(null, { status: 404 });
  }

  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const body = await req.json();
    const result = await handleSMSResponse(makeDeps(), body, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
