import type { AlayaCareEvent } from "./types";
import { logger } from "@/src/lib/logger";

type EventHandler = (event: AlayaCareEvent, traceId: string) => Promise<unknown>;

// Module-level handler registry. Handlers are registered at import time
// (deterministic, idempotent). Safe for serverless — re-registered on cold start.
const handlers: Record<string, EventHandler> = {};

export function registerHandler(eventType: string, handler: EventHandler): void {
  if (handlers[eventType]) {
    throw new Error(`Handler already registered for event type: ${eventType}`);
  }
  handlers[eventType] = handler;
}

export async function dispatch(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const handler = handlers[event.event_type];
  if (!handler) {
    logger.warn({ traceId, eventType: event.event_type }, "No handler for event type");
    return null;
  }
  return handler(event, traceId);
}

/** Clear all registered handlers (used in tests). */
export function clearHandlers(): void {
  for (const key of Object.keys(handlers)) {
    delete handlers[key];
  }
}
