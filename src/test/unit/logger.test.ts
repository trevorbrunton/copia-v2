import { describe, it, expect, vi } from "vitest";
import { logger } from "@/src/lib/logger";

describe("logger", () => {
  it("has debug, info, warn, and error methods", () => {
    expect(typeof logger.debug).toBe("function");
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
  });

  it("calls console.error for error level", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logger.error({ traceId: "test-123" }, "something broke");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("calls console.warn for warn level", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    logger.warn({ traceId: "test-456" }, "heads up");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });

  it("calls console.info for info level", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logger.info({}, "status update");
    expect(spy).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});
