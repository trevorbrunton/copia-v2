/**
 * Phase 0.5: Verify auth.uid() works with direct postgres-js connections.
 *
 * Prerequisites:
 *   1. Supabase Auth enabled in dashboard (Phase 0.1)
 *   2. Test user created in dashboard (Phase 0.4)
 *   3. DATABASE_URL set in .env.local
 *
 * Usage:
 *   bun scripts/test-auth-uid.ts <supabase-user-id>
 *
 * If auth.uid() returns the correct user ID -> proceed with auth.uid() RLS strategy.
 * If auth.uid() returns NULL or errors -> switch to CronIQ pattern (mayfly_app role + current_tenant_id).
 */

import { db } from "@/src/db";
import { sql } from "drizzle-orm";

const testUserId = process.argv[2];
if (!testUserId) {
  console.error("Usage: bun scripts/test-auth-uid.ts <supabase-user-id>");
  console.error("  Get the user ID from Supabase dashboard > Authentication > Users");
  process.exit(1);
}

console.log(`Testing auth.uid() with user ID: ${testUserId}\n`);

// Test 1: Check if auth.uid() function exists
try {
  const result = await db.execute(sql.raw(`SELECT pg_proc.proname FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid WHERE pg_namespace.nspname = 'auth' AND pg_proc.proname = 'uid'`));
  if (result.length === 0) {
    console.error("FAIL: auth.uid() function does not exist.");
    console.error("  -> The auth schema may not be accessible from the postgres role.");
    console.error("  -> Fallback: Use CronIQ pattern (mayfly_app role + current_tenant_id).");
    process.exit(1);
  }
  console.log("PASS: auth.uid() function exists in auth schema.");
} catch (err) {
  console.error("FAIL: Could not query for auth.uid() function:", err);
  process.exit(1);
}

// Test 2: SET LOCAL request.jwt.claims and check auth.uid()
try {
  await db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: testUserId, role: "authenticated" });
    await tx.execute(
      sql.raw(`SET LOCAL request.jwt.claims = '${claims.replace(/'/g, "''")}'`)
    );

    const result = await tx.execute(sql.raw(`SELECT auth.uid()::text as uid`));
    const uid = result[0]?.uid;

    if (uid === testUserId) {
      console.log(`PASS: auth.uid() returned correct user ID: ${uid}`);
      console.log("\n-> Proceed with auth.uid() RLS strategy (plan as written).");
    } else if (uid === null || uid === undefined) {
      console.log(`FAIL: auth.uid() returned NULL.`);
      console.log("\n-> Fallback: Use CronIQ pattern (mayfly_app role + current_tenant_id).");
      process.exit(1);
    } else {
      console.log(`FAIL: auth.uid() returned unexpected value: ${uid} (expected: ${testUserId})`);
      process.exit(1);
    }
  });
} catch (err) {
  console.error("FAIL: SET LOCAL request.jwt.claims or auth.uid() call failed:", err);
  console.error("\n-> Fallback: Use CronIQ pattern (mayfly_app role + current_tenant_id).");
  process.exit(1);
}

// Test 3: Verify auth.uid() resets after transaction
try {
  const result = await db.execute(sql.raw(`SELECT auth.uid()::text as uid`));
  const uid = result[0]?.uid;
  if (uid === null || uid === undefined) {
    console.log("PASS: auth.uid() correctly resets to NULL outside transaction (SET LOCAL scoped).");
  } else {
    console.error(`FAIL: auth.uid() persists outside transaction: ${uid}. SET LOCAL may not be working.`);
    process.exit(1);
  }
} catch {
  console.log("PASS: auth.uid() not accessible outside transaction context (expected).");
}

console.log("\nAll tests passed. auth.uid() strategy is viable.");
process.exit(0);
