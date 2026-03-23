import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/src/db";
import { workflowEvents } from "@/src/db/schema";
import { validateWebhookSecret } from "@/src/lib/alayacare-events/validate-webhook";
import { AlayaCareEventSchema, type AlayaCareEvent } from "@/src/lib/alayacare-events/types";
import { dispatch } from "@/src/lib/alayacare-events/dispatcher";
import { handleAppError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { WebhookDebouncer } from "@/src/lib/webhook-debouncer";

// Register all event handlers (side-effect import — idempotent per cold start)
import "@/src/server/commands/webhooks/register-handlers";

// --- Idempotency + audit helpers (direct db, no UoW — system events, not user data) ---

async function checkProcessed(eventId: string): Promise<boolean> {
  const rows = await db
    .select({ id: workflowEvents.id })
    .from(workflowEvents)
    .where(eq(workflowEvents.eventId, eventId))
    .limit(1);
  return rows.length > 0;
}

async function recordEvent(
  event: AlayaCareEvent,
  traceId: string,
  status: string,
): Promise<void> {
  await db.insert(workflowEvents).values({
    eventId: event.event_id,
    eventType: event.event_type,
    source: event.metadata.source,
    payload: event.payload,
    traceId,
    status,
  });
}

async function updateEventStatus(
  eventId: string,
  status: string,
  result?: unknown,
): Promise<void> {
  await db
    .update(workflowEvents)
    .set({
      status,
      result: result ?? null,
      processedAt: new Date(),
    })
    .where(eq(workflowEvents.eventId, eventId));
}

// --- Debouncer for scoring-heavy events ---
// Buffers visit.vacated and visit.created events so the AlayaCare
// employee+skills cache is warmed once and shared across all events in a burst.
// Other event types are dispatched immediately (no debounce).
// Set WEBHOOK_DEBOUNCE_MS=0 to disable (useful for tests).

interface BufferedEvent {
  event: AlayaCareEvent;
  traceId: string;
}

let _scoringDebouncer: WebhookDebouncer<BufferedEvent> | null = null;

function getDebounceMs(): number {
  return Number(process.env.WEBHOOK_DEBOUNCE_MS ?? "2000");
}

function getScoringDebouncer(): WebhookDebouncer<BufferedEvent> | null {
  if (getDebounceMs() <= 0) return null;
  if (!_scoringDebouncer) {
    _scoringDebouncer = new WebhookDebouncer<BufferedEvent>(
      async (items) => {
        // Process each event sequentially within the batch — first event warms
        // the cache, subsequent events hit it.
        const results: unknown[] = [];
        for (const { event, traceId } of items) {
          try {
            const result = await dispatch(event, traceId);
            await updateEventStatus(event.event_id, "completed", result);
            results.push(result);
          } catch (err) {
            await updateEventStatus(event.event_id, "failed").catch(() => {});
            logger.error(
              { traceId, eventId: event.event_id, err: String(err) },
              "Debounced event handler failed",
            );
            results.push({ error: String(err) });
          }
        }
        return results;
      },
      { windowMs: getDebounceMs(), maxBatchSize: 50 },
    );
  }
  return _scoringDebouncer;
}

/** Event types that trigger scoring + LLM (expensive — worth debouncing). */
const SCORING_EVENT_TYPES = new Set([
  "visit.vacated",
  "visit.created",
  "visit.updated",
]);

// NOTE: This route uses validateWebhookSecret() instead of requireAuthContext().
// Webhook events are machine-to-machine (M2M) — not tied to a Supabase user session.
// The workflow_events table has no RLS (system data, not user data).

export async function POST(request: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    validateWebhookSecret(request);

    const body = await request.json();
    const event = AlayaCareEventSchema.parse(body);

    // Idempotency: check if event_id already processed
    const existing = await checkProcessed(event.event_id);
    if (existing) {
      logger.info({ traceId, eventId: event.event_id }, "Event already processed, skipping");
      return Response.json({ status: "already_processed", traceId });
    }

    // Record receipt (unique constraint handles race condition)
    try {
      await recordEvent(event, traceId, "received");
    } catch (insertErr) {
      // Unique constraint violation = concurrent duplicate → treat as idempotency hit
      if (String(insertErr).includes("unique") || String(insertErr).includes("duplicate")) {
        logger.info({ traceId, eventId: event.event_id }, "Concurrent duplicate detected");
        return Response.json({ status: "already_processed", traceId });
      }
      throw insertErr;
    }

    // Route: scoring-heavy events go through debouncer (if enabled), others dispatch immediately
    const debouncer = SCORING_EVENT_TYPES.has(event.event_type) ? getScoringDebouncer() : null;
    if (debouncer) {
      // Debounced path — buffer event, await batch processing
      // The debouncer handles updateEventStatus internally
      const debouncedResult = await debouncer.enqueue({ event, traceId });

      // Re-throw if the debounced processor recorded a failure for this event
      if (debouncedResult && typeof debouncedResult === "object" && "error" in debouncedResult) {
        throw new Error(String((debouncedResult as { error: string }).error));
      }

      logger.info({ traceId, eventType: event.event_type }, "Event processed (debounced)");
      return Response.json({ status: "processed", traceId });
    }

    // Immediate path — non-scoring events, or debounce disabled
    let result: unknown;
    try {
      result = await dispatch(event, traceId);
    } catch (handlerErr) {
      // Record failure status for dashboard visibility / retry
      await updateEventStatus(event.event_id, "failed").catch(() => {});
      throw handlerErr;
    }

    // Mark completed
    await updateEventStatus(event.event_id, "completed", result);

    logger.info({ traceId, eventType: event.event_type }, "Event processed");
    return Response.json({ status: "processed", traceId });
  } catch (err) {
    logger.error({ traceId, err: String(err) }, "Webhook processing failed");
    return handleAppError(err, traceId);
  }
}
