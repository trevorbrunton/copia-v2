import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { testDb } from "../setup";
import { createTestUser, cleanupTestData } from "../helpers";

describe("Tenant context mechanism", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await cleanupTestData();
    user = await createTestUser({ email: "test_tenant@test.com" });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("SET LOCAL scopes tenant_id to transaction only", async () => {
    await testDb.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`SET LOCAL app.current_tenant_id = '${user.id}'`)
      );

      const [result] = await tx.execute(
        sql`SELECT current_setting('app.current_tenant_id', true) as tid`
      );
      expect(result.tid).toBe(user.id);
    });

    const [result] = await testDb.execute(
      sql`SELECT current_setting('app.current_tenant_id', true) as tid`
    );
    expect(result.tid === "" || result.tid === null).toBe(true);
  });

  it("SET LOCAL does not leak between transactions", async () => {
    await testDb.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`SET LOCAL app.current_tenant_id = 'user-a-id'`)
      );
    });

    await testDb.transaction(async (tx) => {
      const [result] = await tx.execute(
        sql`SELECT current_setting('app.current_tenant_id', true) as tid`
      );
      expect(result.tid === "" || result.tid === null || result.tid !== "user-a-id").toBe(true);
    });
  });

  it("bootstrap context has no tenant_id set", async () => {
    await testDb.transaction(async (tx) => {
      const [result] = await tx.execute(
        sql`SELECT current_setting('app.current_tenant_id', true) as tid`
      );
      expect(result.tid === "" || result.tid === null).toBe(true);
    });
  });
});
