const encoder = new TextEncoder();

/**
 * Create a Server-Sent Events response from an async callback.
 * The callback receives a `send` function for emitting JSON events
 * and should signal completion by returning normally.
 * Errors thrown by the handler are NOT sent to the client —
 * the handler must catch and send error events itself.
 */
export function createSSEResponse(
  handler: (send: (data: Record<string, unknown>) => void) => Promise<void>
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        await handler(send);
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
