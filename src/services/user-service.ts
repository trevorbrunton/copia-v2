import { eq } from "drizzle-orm";
import { users, type User } from "@/src/db/schema";
import type { TransactionClient } from "@/src/lib/tenant";

export async function getUser(
  tx: TransactionClient,
  userId: string
): Promise<User | null> {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user || null;
}

export async function updateUser(
  tx: TransactionClient,
  userId: string,
  data: { name?: string; email?: string; avatarUrl?: string; timezone?: string; locale?: string }
): Promise<User> {
  const [updated] = await tx
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  return updated;
}
