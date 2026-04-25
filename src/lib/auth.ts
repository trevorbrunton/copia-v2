import { eq } from "drizzle-orm";
import { users } from "@/src/db/schema";
import type { User } from "@/src/db/schema";
import { db } from "@/src/db";

/**
 * Bootstrap: look up or create a user record by their Supabase auth ID.
 *
 * Runs OUTSIDE the UoW with direct db access (no RLS enforcement) — the
 * documented exception per migration plan D3.
 *
 * Hits the DB on every call. An earlier process-wide `Map` cache here
 * leaked suspended/soft-deleted state forward — once a user was cached
 * `active`, lifecycle transitions wouldn't surface until the process
 * restarted. The select is a single indexed lookup on `supabase_id`,
 * so the loss is negligible. Don't reintroduce a cache at this layer.
 */
export async function getOrCreateUser(
  supabaseId: string,
  email: string,
  name?: string
): Promise<User> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.supabaseId, supabaseId))
    .limit(1);

  if (existing) return existing;

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

  return newUser;
}
