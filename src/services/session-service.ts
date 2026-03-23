import { eq, and, sql, ne } from "drizzle-orm";
import {
  userDevices,
  userSessions,
  type UserDevice,
  type UserSession,
} from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Devices ─────────────────────────────────────────────────

export async function registerDevice(
  tx: TransactionClient,
  userId: string,
  info: {
    fingerprint: string;
    deviceName: string;
    deviceType: string;
    os: string;
    browser: string;
  },
  ip: string
): Promise<UserDevice> {
  const now = new Date();

  // Check for existing device by fingerprint
  const [existing] = await tx
    .select()
    .from(userDevices)
    .where(
      and(
        eq(userDevices.userId, userId),
        eq(userDevices.deviceFingerprint, info.fingerprint)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await tx
      .update(userDevices)
      .set({
        deviceName: info.deviceName,
        deviceType: info.deviceType,
        os: info.os,
        browser: info.browser,
        lastIp: ip,
        lastActiveAt: now,
      })
      .where(eq(userDevices.id, existing.id))
      .returning();
    return updated;
  }

  const [device] = await tx
    .insert(userDevices)
    .values({
      userId,
      deviceFingerprint: info.fingerprint,
      deviceName: info.deviceName,
      deviceType: info.deviceType,
      os: info.os,
      browser: info.browser,
      lastIp: ip,
      lastActiveAt: now,
    })
    .returning();

  return device;
}

export async function listDevices(
  tx: TransactionClient,
  userId: string
): Promise<UserDevice[]> {
  return tx
    .select()
    .from(userDevices)
    .where(eq(userDevices.userId, userId))
    .orderBy(sql`${userDevices.lastActiveAt} DESC NULLS LAST`);
}

export async function removeDevice(
  tx: TransactionClient,
  userId: string,
  deviceId: string
): Promise<void> {
  // Revoke all sessions for this device
  const now = new Date();
  await tx
    .update(userSessions)
    .set({
      status: "revoked",
      endedAt: now,
      endedReason: "device_removed",
    })
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.deviceId, deviceId),
        eq(userSessions.status, "active")
      )
    );

  // Delete the device
  await tx
    .delete(userDevices)
    .where(and(eq(userDevices.id, deviceId), eq(userDevices.userId, userId)));
}

// ─── Sessions ────────────────────────────────────────────────

export async function createSession(
  tx: TransactionClient,
  userId: string,
  opts: {
    deviceId?: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<UserSession> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const [session] = await tx
    .insert(userSessions)
    .values({
      userId,
      deviceId: opts.deviceId ?? null,
      ipAddress: opts.ipAddress ?? null,
      userAgent: opts.userAgent ?? null,
      startedAt: now,
      lastActiveAt: now,
      expiresAt,
    })
    .returning();

  return session;
}

export interface SessionWithDevice extends UserSession {
  device: UserDevice | null;
}

export async function listActiveSessions(
  tx: TransactionClient,
  userId: string
): Promise<SessionWithDevice[]> {
  const rows = await tx
    .select({
      session: userSessions,
      device: userDevices,
    })
    .from(userSessions)
    .leftJoin(userDevices, eq(userSessions.deviceId, userDevices.id))
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.status, "active"),
        sql`${userSessions.expiresAt} > now()`
      )
    )
    .orderBy(sql`${userSessions.lastActiveAt} DESC`);

  return rows.map((r) => ({
    ...r.session,
    device: r.device,
  }));
}

export async function heartbeat(
  tx: TransactionClient,
  userId: string,
  sessionId: string
): Promise<void> {
  const now = new Date();

  // Update session lastActiveAt
  const [session] = await tx
    .update(userSessions)
    .set({ lastActiveAt: now })
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId),
        eq(userSessions.status, "active")
      )
    )
    .returning();

  // Also update device lastActiveAt if linked
  if (session?.deviceId) {
    await tx
      .update(userDevices)
      .set({ lastActiveAt: now })
      .where(eq(userDevices.id, session.deviceId));
  }
}

export async function revokeSession(
  tx: TransactionClient,
  userId: string,
  sessionId: string,
  reason = "revoked"
): Promise<void> {
  await tx
    .update(userSessions)
    .set({
      status: "revoked",
      endedAt: new Date(),
      endedReason: reason,
    })
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId),
        eq(userSessions.status, "active")
      )
    );
}

export async function revokeAllSessions(
  tx: TransactionClient,
  userId: string,
  exceptSessionId?: string
): Promise<number> {
  const now = new Date();
  const conditions = [
    eq(userSessions.userId, userId),
    eq(userSessions.status, "active"),
  ];

  if (exceptSessionId) {
    conditions.push(ne(userSessions.id, exceptSessionId));
  }

  const revoked = await tx
    .update(userSessions)
    .set({
      status: "revoked",
      endedAt: now,
      endedReason: "revoked_all",
    })
    .where(and(...conditions))
    .returning();

  return revoked.length;
}

export async function endSession(
  tx: TransactionClient,
  userId: string,
  sessionId: string
): Promise<void> {
  await tx
    .update(userSessions)
    .set({
      status: "logged_out",
      endedAt: new Date(),
      endedReason: "user_logout",
    })
    .where(
      and(
        eq(userSessions.id, sessionId),
        eq(userSessions.userId, userId),
        eq(userSessions.status, "active")
      )
    );
}

// ─── History ─────────────────────────────────────────────────

export async function getLoginHistory(
  tx: TransactionClient,
  userId: string,
  limit = 20
): Promise<SessionWithDevice[]> {
  const rows = await tx
    .select({
      session: userSessions,
      device: userDevices,
    })
    .from(userSessions)
    .leftJoin(userDevices, eq(userSessions.deviceId, userDevices.id))
    .where(eq(userSessions.userId, userId))
    .orderBy(sql`${userSessions.startedAt} DESC`)
    .limit(limit);

  return rows.map((r) => ({
    ...r.session,
    device: r.device,
  }));
}
