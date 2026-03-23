import { eq, sql } from "drizzle-orm";
import { users, userStatusHistory, type User, type UserStatusHistory } from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

const PURGE_DELAY_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ─── Status Machine ─────────────────────────────────────────

// NOTE: suspendUser and reactivateUser retain their status guards in the service
// layer as a documented deviation from the architecture guide. These functions have
// no command handlers yet — guards will move to handlers when admin routes are built.

export async function suspendUser(
  tx: TransactionClient,
  userId: string,
  reason: string,
  changedBy: string,
  ipAddress?: string
): Promise<User> {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.status !== "active") {
    throw new Error(`Cannot suspend user: current status is '${user?.status ?? "not found"}'`);
  }

  await recordStatusChange(tx, userId, "active", "suspended", reason, changedBy, ipAddress);

  const [updated] = await tx
    .update(users)
    .set({
      status: "suspended",
      statusReason: reason,
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  return updated;
}

export async function reactivateUser(
  tx: TransactionClient,
  userId: string,
  changedBy: string,
  ipAddress?: string
): Promise<User> {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user || user.status !== "suspended") {
    throw new Error(`Cannot reactivate user: current status is '${user?.status ?? "not found"}'`);
  }

  await recordStatusChange(tx, userId, "suspended", "active", null, changedBy, ipAddress);

  const [updated] = await tx
    .update(users)
    .set({
      status: "active",
      statusReason: null,
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  return updated;
}

export async function softDeleteUser(
  tx: TransactionClient,
  userId: string,
  reason: string,
  ipAddress?: string
): Promise<User> {
  const [user] = await tx
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const now = new Date();
  const purgeAfter = new Date(now.getTime() + PURGE_DELAY_MS);

  await recordStatusChange(tx, userId, user?.status ?? "unknown", "soft_deleted", reason, userId, ipAddress);

  const [updated] = await tx
    .update(users)
    .set({
      status: "soft_deleted",
      statusReason: reason,
      statusChangedAt: now,
      deletedAt: now,
      purgeAfter,
      updatedAt: now,
    })
    .where(eq(users.id, userId))
    .returning();

  return updated;
}

// ─── Status History ─────────────────────────────────────────

async function recordStatusChange(
  tx: TransactionClient,
  userId: string,
  fromStatus: string,
  toStatus: string,
  reason: string | null,
  changedBy: string,
  ipAddress?: string
): Promise<void> {
  await tx.insert(userStatusHistory).values({
    userId,
    fromStatus,
    toStatus,
    reason,
    changedBy,
    ipAddress: ipAddress ?? null,
  });
}

export async function getUserStatusHistory(
  tx: TransactionClient,
  userId: string
): Promise<UserStatusHistory[]> {
  return tx
    .select()
    .from(userStatusHistory)
    .where(eq(userStatusHistory.userId, userId))
    .orderBy(sql`${userStatusHistory.createdAt} DESC`);
}

// ─── Login Tracking ─────────────────────────────────────────

export async function recordLogin(
  tx: TransactionClient,
  userId: string
): Promise<void> {
  await tx
    .update(users)
    .set({
      lastLoginAt: new Date(),
      loginCount: sql`${users.loginCount} + 1`,
    })
    .where(eq(users.id, userId));
}
