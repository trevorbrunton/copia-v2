import { eq } from "drizzle-orm";
import { users } from "@/src/db/schema";
import type { User } from "@/src/db/schema";
import { db } from "@/src/db";

// In-memory cache for user lookups (per-request in serverless)
const userCache = new Map<string, User>();

/**
 * Bootstrap: look up or create a user record by their Supabase auth ID.
 *
 * This runs OUTSIDE the UoW with direct db access (no RLS enforcement).
 * This is the ONLY code path that bypasses tenant isolation — documented
 * exception per migration plan D3.
 */
export async function getOrCreateUser(
  supabaseId: string,
  email: string,
  name?: string
): Promise<User> {
  const cached = userCache.get(supabaseId);
  if (cached) return cached;

  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseId, supabaseId))
    .limit(1);

  if (existing) {
    userCache.set(supabaseId, existing);
    return existing;
  }

  // Migration case: user exists by email but with old auth provider ID.
  // Update their supabaseId to the new value.
  const [byEmail] = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (byEmail) {
    const [updated] = await db
      .update(users)
      .set({ supabaseId })
      .where(eq(users.id, byEmail.id))
      .returning();
    userCache.set(supabaseId, updated);
    return updated;
  }

  const [newUser] = await db
    .insert(users)
    .values({
      supabaseId,
      email,
      name: name || null,
    })
    .returning();

  userCache.set(supabaseId, newUser);
  return newUser;
}
