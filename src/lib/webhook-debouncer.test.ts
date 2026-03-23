import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebhookDebouncer } from "./webhook-debouncer";

describe("WebhookDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should buffer items and flush after window expires", async () => {
    const processor = vi
      .fn()
      .mockImplementation(async (items: string[]) =>
        items.map((i) => `processed:${i}`),
      );

    const debouncer = new WebhookDebouncer(processor, { windowMs: 100 });

    const p1 = debouncer.enqueue("event-1");
    const p2 = debouncer.enqueue("event-2");

    expect(processor).not.toHaveBeenCalled();
    expect(debouncer.pending).toBe(2);

    // Advance past window
    vi.advanceTimersByTime(100);
    // Flush is async — need to drain microtasks
    await vi.runAllTimersAsync();

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe("processed:event-1");
    expect(r2).toBe("processed:event-2");
    expect(processor).toHaveBeenCalledOnce();
    expect(processor).toHaveBeenCalledWith(["event-1", "event-2"]);
  });

  it("should flush immediately when maxBatchSize is reached", async () => {
    const processor = vi
      .fn()
      .mockImplementation(async (items: number[]) => items.map((i) => i * 2));

    const debouncer = new WebhookDebouncer(processor, {
      windowMs: 5_000,
      maxBatchSize: 3,
    });

    const p1 = debouncer.enqueue(1);
    const p2 = debouncer.enqueue(2);
    expect(processor).not.toHaveBeenCalled();

    // Third item triggers flush
    const p3 = debouncer.enqueue(3);
    await vi.runAllTimersAsync();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe(2);
    expect(r2).toBe(4);
    expect(r3).toBe(6);
    expect(processor).toHaveBeenCalledOnce();
  });

  it("should reject all promises if processor throws", async () => {
    vi.useRealTimers(); // forceFlush is simpler for error tests

    const processor = vi
      .fn()
      .mockRejectedValue(new Error("batch-failed"));

    const debouncer = new WebhookDebouncer(processor, { windowMs: 60_000 });

    const p1 = debouncer.enqueue("a");
    const p2 = debouncer.enqueue("b");

    await debouncer.forceFlush();

    await expect(p1).rejects.toThrow("batch-failed");
    await expect(p2).rejects.toThrow("batch-failed");
  });

  it("should process multiple batches independently", async () => {
    const processor = vi
      .fn()
      .mockImplementation(async (items: string[]) =>
        items.map((i) => `done:${i}`),
      );

    const debouncer = new WebhookDebouncer(processor, { windowMs: 100 });

    // Batch 1
    const p1 = debouncer.enqueue("first");
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    expect(await p1).toBe("done:first");

    // Batch 2 (new window)
    const p2 = debouncer.enqueue("second");
    vi.advanceTimersByTime(100);
    await vi.runAllTimersAsync();
    expect(await p2).toBe("done:second");

    expect(processor).toHaveBeenCalledTimes(2);
  });

  it("should support forceFlush for graceful shutdown", async () => {
    const processor = vi
      .fn()
      .mockImplementation(async (items: string[]) =>
        items.map(() => "ok"),
      );

    const debouncer = new WebhookDebouncer(processor, { windowMs: 60_000 });

    const p1 = debouncer.enqueue("urgent");
    expect(debouncer.pending).toBe(1);

    await debouncer.forceFlush();
    expect(await p1).toBe("ok");
    expect(debouncer.pending).toBe(0);
  });

  it("should handle empty forceFlush gracefully", async () => {
    const processor = vi.fn();
    const debouncer = new WebhookDebouncer(processor, { windowMs: 100 });

    await debouncer.forceFlush();
    expect(processor).not.toHaveBeenCalled();
  });
});
