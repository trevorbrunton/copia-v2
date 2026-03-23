import { sql, eq } from "drizzle-orm";
import { testDb } from "./setup";
import {
  users,
  projects,
  chatConversations,
  chatMessages,
  userStatusHistory,
  userDevices,
  userSessions,
  meetings,
} from "@/src/db/schema";

const TEST_PREFIX = "test_";

/**
 * Create a test user directly in the DB (bypasses auth).
 * Returns the created user.
 */
export async function createTestUser(overrides: {
  supabaseId?: string;
  email?: string;
  name?: string;
  status?: string;
} = {}) {
  const id = crypto.randomUUID();
  const supabaseId = overrides.supabaseId || `${TEST_PREFIX}supabase_${id}`;
  const email = overrides.email || `${TEST_PREFIX}${id}@test.com`;

  const [user] = await testDb
    .insert(users)
    .values({
      supabaseId,
      email,
      name: overrides.name || "Test User",
      status: overrides.status || "active",
    })
    .returning();

  return user;
}

/**
 * Create a test project for a given user.
 */
export async function createTestProject(userId: string, overrides: {
  name?: string;
  description?: string;
  status?: string;
} = {}) {
  const [project] = await testDb
    .insert(projects)
    .values({
      userId,
      name: overrides.name || "Test Project",
      description: overrides.description || null,
      status: overrides.status || "active",
    })
    .returning();

  return project;
}

/**
 * Set tenant context for RLS within a transaction.
 * Uses the current variable name (app.current_tenant_id).
 */
export async function withTestTenantContext<T>(
  userId: string,
  fn: (tx: Parameters<Parameters<typeof testDb.transaction>[0]>[0]) => Promise<T>
): Promise<T> {
  return testDb.transaction(async (tx) => {
    await tx.execute(
      sql.raw(`SET LOCAL app.current_tenant_id = '${userId.replace(/'/g, "''")}'`)
    );
    return fn(tx);
  });
}

/**
 * Delete all test data (users with test_ prefix emails).
 * Deletes in FK-safe order: children first, then parents.
 */
export async function cleanupTestData() {
  const testUsers = await testDb
    .select({ id: users.id })
    .from(users)
    .where(sql`${users.email} LIKE 'test_%'`);

  if (testUsers.length === 0) return;

  for (const u of testUsers) {
    // Delete in FK-dependency order (deepest children first)
    await testDb.delete(chatMessages).where(eq(chatMessages.userId, u.id));
    await testDb.delete(chatConversations).where(eq(chatConversations.userId, u.id));
    await testDb.delete(meetings).where(eq(meetings.userId, u.id));
    await testDb.delete(userSessions).where(eq(userSessions.userId, u.id));
    await testDb.delete(userDevices).where(eq(userDevices.userId, u.id));
    await testDb.delete(userStatusHistory).where(eq(userStatusHistory.userId, u.id));
    await testDb.delete(projects).where(eq(projects.userId, u.id));
  }

  // Finally delete test users
  await testDb.delete(users).where(sql`${users.email} LIKE 'test_%'`);
}
