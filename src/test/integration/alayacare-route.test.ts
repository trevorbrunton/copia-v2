import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Mock db for idempotency/audit helpers
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/src/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => mockSelect(),
        }),
      }),
    }),
    insert: () => ({
      values: (v: unknown) => mockInsert(v),
    }),
    update: () => ({
      set: (v: unknown) => ({
        where: () => mockUpdate(v),
      }),
    }),
  },
}));

// Mock dispatcher (include registerHandler since register-handlers.ts calls it)
const mockDispatch = vi.fn();
vi.mock("@/src/lib/alayacare-events/dispatcher", () => ({
  dispatch: (...args: unknown[]) => mockDispatch(...args),
  registerHandler: vi.fn(),
  clearHandlers: vi.fn(),
}));

import { POST } from "@/app/api/v1/webhooks/alayacare/route";

const VALID_SECRET = "test-webhook-secret";

function makeWebhookRequest(body: unknown, secret?: string): NextRequest {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (secret !== undefined) {
    headers["x-webhook-secret"] = secret;
  }
  return new NextRequest("http://localhost:3000/api/v1/webhooks/alayacare", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

function validEvent(overrides?: Record<string, unknown>) {
  return {
    event_id: "550e8400-e29b-41d4-a716-446655440000",
    event_type: "visit.vacated",
    timestamp: "2026-03-11T00:00:00Z",
    payload: { visit_id: 42 },
    metadata: {
      source: "simulation",
      trace_id: "sim-trace-001",
    },
    ...overrides,
  };
}

describe("POST /api/v1/webhooks/alayacare", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
    process.env.ALAYACARE_WEBHOOK_SECRET = VALID_SECRET;
    process.env.WEBHOOK_DEBOUNCE_MS = "0"; // Disable debouncer for deterministic tests
    // Default: event not yet processed
    mockSelect.mockResolvedValue([]);
    mockInsert.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue(undefined);
    mockDispatch.mockResolvedValue({ some: "result" });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  // --- Auth ---

  it("rejects request with missing webhook secret", async () => {
    const req = makeWebhookRequest(validEvent());
    const res = await POST(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  it("rejects request with wrong webhook secret", async () => {
    const req = makeWebhookRequest(validEvent(), "wrong-secret");
    const res = await POST(req);
    expect(res.status).toBe(401);
  });

  it("rejects when ALAYACARE_WEBHOOK_SECRET env var is not set", async () => {
    delete process.env.ALAYACARE_WEBHOOK_SECRET;
    const req = makeWebhookRequest(validEvent(), "any");
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("CONFIG_ERROR");
  });

  // --- Validation ---

  it("rejects invalid event payload", async () => {
    const req = makeWebhookRequest({ bad: "data" }, VALID_SECRET);
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects event with invalid event_type", async () => {
    const req = makeWebhookRequest(
      validEvent({ event_type: "not.a.valid.type" }),
      VALID_SECRET
    );
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  // --- Idempotency ---

  it("returns already_processed for duplicate event_id", async () => {
    mockSelect.mockResolvedValue([{ id: "existing-row" }]);

    const req = makeWebhookRequest(validEvent(), VALID_SECRET);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("already_processed");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  // --- Happy path ---

  it("processes valid event and returns 200", async () => {
    const req = makeWebhookRequest(validEvent(), VALID_SECRET);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("processed");
    expect(body.traceId).toBeDefined();
  });

  it("calls dispatch with event and traceId", async () => {
    const event = validEvent();
    const req = makeWebhookRequest(event, VALID_SECRET);
    await POST(req);

    expect(mockDispatch).toHaveBeenCalledOnce();
    const [dispatchedEvent, traceId] = mockDispatch.mock.calls[0];
    expect(dispatchedEvent.event_id).toBe(event.event_id);
    expect(dispatchedEvent.event_type).toBe(event.event_type);
    expect(typeof traceId).toBe("string");
  });

  it("records event then updates status after dispatch", async () => {
    const req = makeWebhookRequest(validEvent(), VALID_SECRET);
    await POST(req);

    // recordEvent called with status "received"
    expect(mockInsert).toHaveBeenCalledOnce();
    const insertValues = mockInsert.mock.calls[0][0];
    expect(insertValues.status).toBe("received");
    expect(insertValues.eventId).toBe("550e8400-e29b-41d4-a716-446655440000");

    // updateEventStatus called with "completed"
    expect(mockUpdate).toHaveBeenCalledOnce();
    const updateValues = mockUpdate.mock.calls[0][0];
    expect(updateValues.status).toBe("completed");
  });

  // --- Error handling ---

  it("returns error response when dispatch fails", async () => {
    mockDispatch.mockRejectedValue(new Error("handler exploded"));

    const req = makeWebhookRequest(validEvent(), VALID_SECRET);
    const res = await POST(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
  });

  it("marks event as failed when handler throws", async () => {
    mockDispatch.mockRejectedValue(new Error("scoring failed"));

    const req = makeWebhookRequest(validEvent(), VALID_SECRET);
    await POST(req);

    // updateEventStatus called with "failed"
    expect(mockUpdate).toHaveBeenCalledOnce();
    const updateValues = mockUpdate.mock.calls[0][0];
    expect(updateValues.status).toBe("failed");
  });

  it("handles concurrent duplicate via unique constraint", async () => {
    // Insert throws unique constraint error (race condition)
    mockInsert.mockRejectedValue(new Error("unique constraint violation"));

    const req = makeWebhookRequest(validEvent(), VALID_SECRET);
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("already_processed");
  });
});
