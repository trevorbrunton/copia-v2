import { logger } from "@/src/lib/logger";
import type { AlayaCareEvent } from "@/src/lib/alayacare-events/types";

export async function handleClientCreated(
  event: AlayaCareEvent,
  traceId: string,
): Promise<unknown> {
  const { client_id } = event.payload;

  logger.info({ traceId, clientId: client_id }, "New client registered");

  return { client_id, action: "logged" };
}
