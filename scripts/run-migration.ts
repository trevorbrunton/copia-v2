/**
 * Run SQL migration via direct PostgreSQL connection.
 * Usage: bun scripts/run-migration.ts src/db/migrations/005_user_lifecycle_and_sessions.sql
 */
import postgres from "postgres";
import { readFileSync } from "fs";

const file = process.argv[2];
if (!file) {
  console.error("Usage: bun scripts/run-migration.ts <path-to-sql>");
  process.exit(1);
}

const sqlContent = readFileSync(file, "utf-8");

const sql = postgres(process.env.DIRECT_URL || process.env.DATABASE_URL!, { prepare: false });

// Split on semicolons, strip comment-only lines, skip empty statements
const statements = sqlContent
  .split(";")
  .map((s) =>
    s
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .trim()
  )
  .filter((s) => s.length > 0);

console.log(`Running ${statements.length} statements from ${file}...\n`);

for (const stmt of statements) {
  const preview = stmt.slice(0, 80).replace(/\n/g, " ");
  console.log(`  → ${preview}...`);
  try {
    await sql.unsafe(stmt);
    console.log(`    ✓ OK`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Skip "already exists" errors for idempotent migrations
    if (msg.includes("already exists") || msg.includes("duplicate")) {
      console.log(`    ⚠ Already exists (skipped)`);
    } else {
      console.error(`    ✗ FAILED: ${msg}`);
      await sql.end();
      process.exit(1);
    }
  }
}

await sql.end();
console.log("\n✓ Migration complete.");
