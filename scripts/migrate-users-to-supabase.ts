/**
 * Migrate users from Cognito to Supabase Auth.
 *
 * Prerequisites:
 *   1. Export Cognito users: aws cognito-idp list-users --user-pool-id <pool-id> --attributes-to-get email name > cognito-users.json
 *   2. Set env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DATABASE_URL
 *   3. Run migration 008 first (rename cognito_id → supabase_id)
 *
 * Usage: bun scripts/migrate-users-to-supabase.ts <path-to-cognito-users.json>
 *
 * What this does:
 *   - For each Cognito user, creates a Supabase Auth user (email confirmed, no password)
 *   - Updates the DB users.supabase_id to the new Supabase auth.uid()
 *   - Users will need to reset their password on first login
 */

import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/src/db";
import { users } from "@/src/db/schema";
import { readFileSync } from "fs";

interface CognitoUser {
  Username: string;
  Attributes: { Name: string; Value: string }[];
  UserStatus: string;
  Enabled: boolean;
}

interface CognitoExport {
  Users: CognitoUser[];
}

const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error("Usage: bun scripts/migrate-users-to-supabase.ts <cognito-users.json>");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabaseAdmin = createClient(url, key);
const raw = readFileSync(jsonPath, "utf-8");
const cognitoExport: CognitoExport = JSON.parse(raw);

console.log(`Found ${cognitoExport.Users.length} Cognito users to migrate.\n`);

// Pre-migration: check for duplicate emails
const emailCounts = new Map<string, number>();
for (const cu of cognitoExport.Users) {
  const email = cu.Attributes.find((a) => a.Name === "email")?.Value;
  if (email) {
    emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }
}
const duplicates = [...emailCounts.entries()].filter(([, count]) => count > 1);
if (duplicates.length > 0) {
  console.error("BLOCKER: Duplicate emails found in Cognito export:");
  for (const [email, count] of duplicates) {
    console.error(`  ${email}: ${count} entries`);
  }
  console.error("Resolve duplicates before proceeding.");
  process.exit(1);
}

let success = 0;
let skipped = 0;
let failed = 0;

for (const cu of cognitoExport.Users) {
  const email = cu.Attributes.find((a) => a.Name === "email")?.Value;
  const name = cu.Attributes.find((a) => a.Name === "name")?.Value;

  if (!email) {
    console.warn(`SKIP: User ${cu.Username} has no email attribute`);
    skipped++;
    continue;
  }

  if (!cu.Enabled || cu.UserStatus === "ARCHIVED") {
    console.warn(`SKIP: User ${email} is disabled/archived`);
    skipped++;
    continue;
  }

  try {
    // Create user in Supabase Auth
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: name ? { name } : undefined,
    });

    if (error) {
      console.error(`FAIL: ${email} — ${error.message}`);
      failed++;
      continue;
    }

    // Update the DB record: set supabase_id to the new Supabase user ID
    const result = await db
      .update(users)
      .set({ supabaseId: data.user.id })
      .where(eq(users.email, email))
      .returning({ id: users.id });

    if (result.length === 0) {
      console.warn(`WARN: ${email} — created in Supabase Auth but no matching DB row found`);
    }

    console.log(`OK: ${email} → ${data.user.id}`);
    success++;
  } catch (err) {
    console.error(`FAIL: ${email} — ${err instanceof Error ? err.message : String(err)}`);
    failed++;
  }
}

console.log(`\nMigration complete: ${success} success, ${skipped} skipped, ${failed} failed`);

if (failed > 0) {
  console.error("Some users failed to migrate. Review errors above.");
  process.exit(1);
}
