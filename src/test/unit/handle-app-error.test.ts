import { describe, it, expect, vi } from "vitest";
import {
  handleAppError,
  AppError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  ExternalServiceError,
} from "@/src/server/errors";
import { ZodError } from "zod";

describe("handleAppError", () => {
  it("maps UnauthorizedError to 401", async () => {
    const res = handleAppError(new UnauthorizedError());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("UNAUTHORIZED");
    expect(body.error.message).toBe("Unauthorized");
  });

  it("maps ForbiddenError to 403 with code and details", async () => {
    const res = handleAppError(
      new ForbiddenError("Account suspended", "ACCOUNT_SUSPENDED", "reason")
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("ACCOUNT_SUSPENDED");
    expect(body.error.details).toBe("reason");
  });

  it("maps NotFoundError to 404", async () => {
    const res = handleAppError(new NotFoundError("Project"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toBe("Project not found");
  });

  it("maps ConflictError to 409", async () => {
    const res = handleAppError(new ConflictError("Duplicate"));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("CONFLICT");
  });

  it("maps ValidationError to 400", async () => {
    const res = handleAppError(new ValidationError("Bad input", { field: "name" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details).toEqual({ field: "name" });
  });

  it("maps generic AppError with custom status", async () => {
    const res = handleAppError(new AppError("Rate limited", "RATE_LIMIT", 429));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error.code).toBe("RATE_LIMIT");
  });

  it("maps ZodError to 400 with issues", async () => {
    const zodError = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        path: ["name"],
        message: "Expected string, received number",
      } as never,
    ]);
    const res = handleAppError(zodError);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Expected string, received number");
    expect(body.error.details).toHaveLength(1);
  });

  it("maps unknown error to 500 without leaking details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = handleAppError(new Error("secret db info"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.message).toBe("Internal server error");
    expect(body.error.details).toBeUndefined();
    vi.restoreAllMocks();
  });

  it("maps non-Error thrown value to 500", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = handleAppError("string error");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    vi.restoreAllMocks();
  });

  it("includes traceId in error envelope when provided", async () => {
    const res = handleAppError(new NotFoundError("Project"), "trace-abc-123");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.traceId).toBe("trace-abc-123");
  });

  it("omits traceId from error envelope when not provided", async () => {
    const res = handleAppError(new NotFoundError("Project"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.traceId).toBeUndefined();
  });

  it("includes traceId in Zod error envelope", async () => {
    const zodError = new ZodError([
      {
        code: "invalid_type",
        expected: "string",
        path: ["name"],
        message: "Bad",
      } as never,
    ]);
    const res = handleAppError(zodError, "trace-zod-456");
    const body = await res.json();
    expect(body.error.traceId).toBe("trace-zod-456");
  });

  it("includes traceId in 500 error envelope", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = handleAppError(new Error("boom"), "trace-500-789");
    const body = await res.json();
    expect(body.error.traceId).toBe("trace-500-789");
    vi.restoreAllMocks();
  });

  it("maps ExternalServiceError to 502", async () => {
    const res = handleAppError(
      new ExternalServiceError("AlayaCare API error: 500 Internal Server Error")
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("EXTERNAL_SERVICE_ERROR");
    expect(body.error.message).toBe(
      "AlayaCare API error: 500 Internal Server Error"
    );
  });

  it("maps ExternalServiceError with custom service name to 502", async () => {
    const res = handleAppError(
      new ExternalServiceError("Service unavailable", "stripe"),
      "trace-502"
    );
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.code).toBe("EXTERNAL_SERVICE_ERROR");
    expect(body.error.traceId).toBe("trace-502");
  });
});
