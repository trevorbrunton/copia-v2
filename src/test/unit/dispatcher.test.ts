import { describe, it, expect, vi, afterEach } from "vitest";

import {
  dispatch,
  registerHandler,
  clearHandlers,
} from "@/src/lib/alayacare-events/dispatcher";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

function makeEvent(
  eventType: string,
  overrides?: Partial<AlayaCareEvent>
): AlayaCareEvent {
  return {
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    event_type: eventType as AlayaCareEvent["event_type"],
    timestamp: new Date().toISOString(),
    payload: { visit_id: 1 },
    metadata: {
      source: "simulation",
      trace_id: "test-trace-id",
    },
    ...overrides,
  };
}

describe("dispatcher", () => {
  afterEach(() => {
    clearHandlers();
  });

  it("should dispatch to registered handler", async () => {
    const handler = vi.fn().mockResolvedValue({ result: "ok" });
    registerHandler("visit.vacated", handler);

    const event = makeEvent("visit.vacated");
    const result = await dispatch(event, "trace-123");

    expect(handler).toHaveBeenCalledWith(event, "trace-123");
    expect(result).toEqual({ result: "ok" });
  });

  it("should return null for unknown event type", async () => {
    const event = makeEvent("visit.created");
    const result = await dispatch(event, "trace-123");
    expect(result).toBeNull();
  });

  it("should support multiple handlers for different event types", async () => {
    const handler1 = vi.fn().mockResolvedValue("result1");
    const handler2 = vi.fn().mockResolvedValue("result2");

    registerHandler("visit.vacated", handler1);
    registerHandler("employee.status_changed", handler2);

    const event1 = makeEvent("visit.vacated");
    const event2 = makeEvent("employee.status_changed");

    await dispatch(event1, "t1");
    await dispatch(event2, "t2");

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("should propagate handler errors", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("handler failed"));
    registerHandler("visit.vacated", handler);

    const event = makeEvent("visit.vacated");
    await expect(dispatch(event, "trace-123")).rejects.toThrow(
      "handler failed"
    );
  });

  it("should throw on duplicate handler registration", () => {
    const handler = vi.fn();
    registerHandler("visit.vacated", handler);

    expect(() => registerHandler("visit.vacated", vi.fn())).toThrow(
      "Handler already registered for event type: visit.vacated"
    );
  });

  it("should clear all handlers", async () => {
    const handler = vi.fn();
    registerHandler("visit.vacated", handler);
    clearHandlers();

    const event = makeEvent("visit.vacated");
    // After clearing, should return null (no handler)
    await expect(dispatch(event, "t1")).resolves.toBeNull();
  });
});
