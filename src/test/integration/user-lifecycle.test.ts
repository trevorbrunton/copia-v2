import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser,
  withTestTenantContext,
  cleanupTestData,
} from "../helpers";
import { getUser, updateUser } from "@/src/services/user-service";
import {
  suspendUser,
  reactivateUser,
  softDeleteUser,
  getUserStatusHistory,
} from "@/src/services/user-lifecycle-service";

describe("User lifecycle", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await cleanupTestData();
    user = await createTestUser({ email: "test_lifecycle@test.com" });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("gets user profile", async () => {
    const found = await withTestTenantContext(user.id, async (tx) => {
      return getUser(tx, user.id);
    });

    expect(found).not.toBeNull();
    expect(found!.email).toBe("test_lifecycle@test.com");
    expect(found!.status).toBe("active");
  });

  it("updates user profile", async () => {
    const updated = await withTestTenantContext(user.id, async (tx) => {
      return updateUser(tx, user.id, { name: "New Name" });
    });

    expect(updated.name).toBe("New Name");
  });

  it("suspends and reactivates a user", async () => {
    const suspended = await withTestTenantContext(user.id, async (tx) => {
      return suspendUser(tx, user.id, "Test suspension", user.id, "127.0.0.1");
    });

    expect(suspended.status).toBe("suspended");
    expect(suspended.statusReason).toBe("Test suspension");

    const reactivated = await withTestTenantContext(user.id, async (tx) => {
      return reactivateUser(tx, user.id, user.id, "127.0.0.1");
    });

    expect(reactivated.status).toBe("active");

    const history = await withTestTenantContext(user.id, async (tx) => {
      return getUserStatusHistory(tx, user.id);
    });

    expect(history.length).toBeGreaterThanOrEqual(2);
  });

  it("soft deletes a user", async () => {
    const deleteUser = await createTestUser({ email: "test_delete@test.com" });

    const deleted = await withTestTenantContext(deleteUser.id, async (tx) => {
      return softDeleteUser(tx, deleteUser.id, "User requested", "127.0.0.1");
    });

    expect(deleted.status).toBe("soft_deleted");
    expect(deleted.deletedAt).not.toBeNull();
    expect(deleted.purgeAfter).not.toBeNull();
  });
});
