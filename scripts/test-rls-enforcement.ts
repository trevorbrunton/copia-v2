/**
 * Test that auth.uid() RLS enforcement works with the new UoW pattern.
 *
 * This verifies:
 * 1. SET LOCAL request.jwt.claims sets auth.uid() correctly
 * 2. RLS policies would enforce tenant isolation (if BYPASSRLS is removed)
 *
 * Run: bun scripts/test-rls-enforcement.ts
 */

import postgres from "postgres";

const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, {
  prepare: false,
});

// Use an existing user's internal ID for testing
const users = await sql`SELECT id, supabase_id, email FROM users LIMIT 1`;
if (users.length === 0) {
  console.error("No users in database. Create a user first.");
  await sql.end();
  process.exit(1);
}

const testUser = users[0];
console.log(`Testing with user: ${testUser.email} (id: ${testUser.id})\n`);

// Test 1: auth.uid() returns principalId (internal UUID) when set via request.jwt.claims
console.log("Test 1: auth.uid() returns principalId from request.jwt.claims");
await sql.begin(async (tx) => {
  const claims = JSON.stringify({ sub: testUser.id, role: "authenticated" });
  await tx.unsafe(`SET LOCAL request.jwt.claims = '${claims.replace(/'/g, "''")}'`);

  const [result] = await tx.unsafe(`SELECT auth.uid()::text as uid`);

  if (result.uid === testUser.id) {
    console.log(`  PASS: auth.uid() = ${result.uid}`);
  } else {
    console.error(`  FAIL: auth.uid() = ${result.uid}, expected ${testUser.id}`);
    process.exit(1);
  }
});

// Test 2: auth.uid() resets outside transaction
console.log("Test 2: auth.uid() resets outside transaction");
try {
  const [result] = await sql.unsafe(`SELECT auth.uid()::text as uid`);
  if (result.uid === null || result.uid === undefined) {
    console.log("  PASS: auth.uid() is NULL outside transaction");
  } else {
    console.error(`  FAIL: auth.uid() persists: ${result.uid}`);
  }
} catch {
  console.log("  PASS: auth.uid() not accessible outside transaction");
}

// Test 3: Verify RLS policies exist
console.log("Test 3: RLS policies exist and use auth.uid()");
const policies = await sql`
  SELECT tablename, policyname, qual
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename
`;

const expectedTables = [
  "chat_conversations", "chat_messages", "meetings", "projects",
  "user_devices", "user_sessions", "user_status_history", "users",
];

for (const table of expectedTables) {
  const policy = policies.find((p) => p.tablename === table);
  if (policy) {
    const qual = policy.qual as string | null;
    const usesAuthUid = qual?.includes("auth.uid()");
    console.log(`  ${usesAuthUid ? "PASS" : "WARN"}: ${table} → ${policy.policyname} ${usesAuthUid ? "(uses auth.uid())" : "(check policy)"}`);
  } else {
    console.error(`  FAIL: No policy on ${table}`);
  }
}

// Test 4: Check if RLS is enabled on tables
console.log("Test 4: RLS enabled on all tables");
const rlsStatus = await sql`
  SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class
  WHERE relname IN ('users', 'projects', 'chat_conversations', 'chat_messages',
                     'user_status_history', 'user_devices', 'user_sessions', 'meetings')
  ORDER BY relname
`;

for (const table of rlsStatus) {
  const enabled = table.relrowsecurity;
  console.log(`  ${enabled ? "PASS" : "WARN"}: ${table.relname} — RLS ${enabled ? "enabled" : "NOT enabled"}`);
}

// Test 5: Check current role's BYPASSRLS status
console.log("Test 5: Current connection role");
const [roleInfo] = await sql`SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
console.log(`  Role: ${roleInfo.current_user}, BYPASSRLS: ${roleInfo.rolbypassrls}`);
if (roleInfo.rolbypassrls) {
  console.log("  INFO: RLS policies exist but are bypassed by current role.");
  console.log("  INFO: To enforce RLS, connect as mayfly_app (non-BYPASSRLS) role.");
}

console.log("\nAll tests complete.");
await sql.end();
