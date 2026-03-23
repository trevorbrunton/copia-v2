import { z } from "zod";
import type { AuthContext } from "../../auth-context";
import type { UnitOfWork } from "../../uow/types";
import {
  createSession,
  registerDevice,
} from "@/src/services/session-service";
import { recordLogin } from "@/src/services/user-lifecycle-service";
import { deviceTypes } from "@/src/db/schema";

export const CreateSessionInput = z.object({
  deviceInfo: z.object({
    fingerprint: z.string().min(1),
    deviceName: z.string().max(200),
    deviceType: z.enum(deviceTypes),
    os: z.string().max(100),
    browser: z.string().max(100),
  }),
});

export async function handleCreateSession(
  deps: { uow: UnitOfWork },
  rawInput: unknown,
  ctx: AuthContext,
  ipAddress: string,
  userAgent: string
) {
  const input = CreateSessionInput.parse(rawInput);

  return deps.uow.run(ctx, async ({ db: tx }) => {
    const device = await registerDevice(
      tx,
      ctx.principalId,
      input.deviceInfo,
      ipAddress
    );

    const session = await createSession(tx, ctx.principalId, {
      deviceId: device.id,
      ipAddress,
      userAgent,
    });

    await recordLogin(tx, ctx.principalId);

    return { ...session, device };
  });
}
