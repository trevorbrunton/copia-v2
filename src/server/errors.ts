import { logger } from "@/src/lib/logger";

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "FORBIDDEN", details?: unknown) {
    super(message, code, 403, details);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource") {
    super(`${resource} not found`, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict") {
    super(message, "CONFLICT", 409);
    this.name = "ConflictError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, public readonly service: string = "alayacare") {
    super(message, "EXTERNAL_SERVICE_ERROR", 502);
    this.name = "ExternalServiceError";
  }
}

/**
 * Map an unknown error to an HTTP Response with a standardized error envelope.
 * When traceId is provided, it's included in the error response for client-side correlation.
 */
export function handleAppError(err: unknown, traceId?: string): Response {
  if (err instanceof AppError) {
    return Response.json(
      {
        error: {
          code: err.code,
          message: err.message,
          details: err.details,
          ...(traceId && { traceId }),
        },
      },
      { status: err.status }
    );
  }

  // Zod validation errors (Zod v4 ZodError may not extend Error)
  if (
    err != null &&
    typeof err === "object" &&
    "issues" in err &&
    Array.isArray((err as { issues: unknown[] }).issues)
  ) {
    const issues = (err as { issues: Array<{ message: string }> }).issues;
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: issues[0]?.message || "Validation failed",
          details: issues,
          ...(traceId && { traceId }),
        },
      },
      { status: 400 }
    );
  }

  // AlayaCare API errors → 502 ExternalServiceError
  if (err instanceof Error && err.message.startsWith("AlayaCare API error")) {
    return handleAppError(new ExternalServiceError(err.message), traceId);
  }

  logger.error(
    { ...(traceId && { traceId }), err: String(err) },
    "Unhandled error"
  );
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
        ...(traceId && { traceId }),
      },
    },
    { status: 500 }
  );
}
