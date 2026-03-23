/**
 * Webhook event debouncer.
 *
 * When many events arrive in quick succession (e.g. an employee quits and
 * 20 visits are vacated), the debouncer buffers them for a short window
 * and flushes the batch together. This ensures the AlayaCare cache is
 * warmed once and shared across all events in the burst.
 *
 * Design:
 *  - Each event is enqueued and a Promise is returned to the caller
 *  - The first event in a quiet period starts a timer (default 2s)
 *  - When the timer fires (or maxBatchSize is reached), all buffered
 *    events are processed sequentially with a shared cache
 *  - Individual promises resolve/reject with their own results
 */

import { logger } from "./logger";

export interface DebouncedItem<T> {
  payload: T;
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
}

export type BatchProcessor<T> = (
  items: T[],
) => Promise<unknown[]>;

export class WebhookDebouncer<T = unknown> {
  private buffer: DebouncedItem<T>[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly windowMs: number;
  private readonly maxBatchSize: number;
  private readonly processor: BatchProcessor<T>;

  constructor(
    processor: BatchProcessor<T>,
    options: { windowMs?: number; maxBatchSize?: number } = {},
  ) {
    this.processor = processor;
    this.windowMs = options.windowMs ?? 2_000;
    this.maxBatchSize = options.maxBatchSize ?? 50;
  }

  /**
   * Enqueue an item for debounced processing.
   * Returns a promise that resolves when the item has been processed.
   */
  enqueue(payload: T): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.buffer.push({ payload, resolve, reject });

      // Flush immediately if batch is full
      if (this.buffer.length >= this.maxBatchSize) {
        this.flush().catch(() => {});
        return;
      }

      // Start timer on first item in batch
      if (!this.timer) {
        this.timer = setTimeout(() => {
          // flush() handles its own errors (rejects individual promises),
          // so we catch here to prevent unhandled rejection from the timer
          this.flush().catch(() => {});
        }, this.windowMs);
      }
    });
  }

  /** Process all buffered items. */
  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const batch = this.buffer.splice(0);
    if (batch.length === 0) return;

    logger.info(
      { batchSize: batch.length },
      "webhook-debouncer flushing batch",
    );

    try {
      const results = await this.processor(batch.map((b) => b.payload));

      // Resolve each promise with its corresponding result
      for (let i = 0; i < batch.length; i++) {
        batch[i].resolve(results[i] ?? null);
      }
    } catch (err) {
      // If the batch processor throws, reject all promises
      for (const item of batch) {
        item.reject(err);
      }
    }
  }

  /** Number of items currently buffered. */
  get pending(): number {
    return this.buffer.length;
  }

  /** Force flush — useful for graceful shutdown or tests. */
  async forceFlush(): Promise<void> {
    await this.flush();
  }
}
