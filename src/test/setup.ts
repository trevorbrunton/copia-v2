import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/src/db/schema";

const connectionString =
  process.env.DATABASE_URL ||
  process.env.DIRECT_URL ||
  "";

if (!connectionString) {
  throw new Error("DATABASE_URL or DIRECT_URL must be set for tests");
}

const testClient = postgres(connectionString, {
  prepare: false,
  max: 5,
  idle_timeout: 10,
});

export const testDb = drizzle(testClient, { schema });

export type TestDb = typeof testDb;

export async function cleanupAfterAll() {
  await testClient.end({ timeout: 5 });
}
