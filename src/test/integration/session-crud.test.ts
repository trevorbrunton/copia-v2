import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  createTestUser,
  withTestTenantContext,
  cleanupTestData,
} from "../helpers";
import {
  registerDevice,
  createSession,
  listActiveSessions,
  listDevices,
  revokeSession,
  heartbeat,
  removeDevice,
} from "@/src/services/session-service";

describe("Session & Device CRUD (service layer)", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;

  beforeAll(async () => {
    await cleanupTestData();
    user = await createTestUser({ email: "test_session@test.com" });
  });

  afterAll(async () => {
    await cleanupTestData();
  });

  it("registers a device", async () => {
    const device = await withTestTenantContext(user.id, async (tx) => {
      return registerDevice(tx, user.id, {
        fingerprint: "fp-test-123",
        deviceName: "Chrome on Mac",
        deviceType: "desktop",
        os: "macOS",
        browser: "Chrome",
      }, "127.0.0.1");
    });

    expect(device.id).toBeDefined();
    expect(device.deviceName).toBe("Chrome on Mac");
    expect(device.userId).toBe(user.id);
  });

  it("creates a session and lists active sessions", async () => {
    const result = await withTestTenantContext(user.id, async (tx) => {
      const device = await registerDevice(tx, user.id, {
        fingerprint: "fp-session-test",
        deviceName: "Firefox",
        deviceType: "desktop",
        os: "Linux",
        browser: "Firefox",
      }, "127.0.0.1");

      const session = await createSession(tx, user.id, {
        deviceId: device.id,
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
      });

      return { device, session };
    });

    expect(result.session.id).toBeDefined();
    expect(result.session.userId).toBe(user.id);

    const sessions = await withTestTenantContext(user.id, async (tx) => {
      return listActiveSessions(tx, user.id);
    });

    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });

  it("heartbeats a session", async () => {
    const session = await withTestTenantContext(user.id, async (tx) => {
      const device = await registerDevice(tx, user.id, {
        fingerprint: "fp-heartbeat",
        deviceName: "Safari",
        deviceType: "mobile",
        os: "iOS",
        browser: "Safari",
      }, "10.0.0.1");

      return createSession(tx, user.id, {
        deviceId: device.id,
        ipAddress: "10.0.0.1",
        userAgent: "Safari",
      });
    });

    // Heartbeat should not throw
    await withTestTenantContext(user.id, async (tx) => {
      await heartbeat(tx, user.id, session.id);
    });
  });

  it("revokes a session", async () => {
    const session = await withTestTenantContext(user.id, async (tx) => {
      const device = await registerDevice(tx, user.id, {
        fingerprint: "fp-revoke",
        deviceName: "Edge",
        deviceType: "desktop",
        os: "Windows",
        browser: "Edge",
      }, "192.168.1.1");

      return createSession(tx, user.id, {
        deviceId: device.id,
        ipAddress: "192.168.1.1",
        userAgent: "Edge",
      });
    });

    await withTestTenantContext(user.id, async (tx) => {
      await revokeSession(tx, user.id, session.id);
    });

    const sessions = await withTestTenantContext(user.id, async (tx) => {
      return listActiveSessions(tx, user.id);
    });

    const revoked = sessions.find((s) => s.id === session.id);
    expect(revoked).toBeUndefined();
  });

  it("lists devices", async () => {
    const devices = await withTestTenantContext(user.id, async (tx) => {
      return listDevices(tx, user.id);
    });

    expect(devices.length).toBeGreaterThanOrEqual(1);
  });

  it("removes a device", async () => {
    const device = await withTestTenantContext(user.id, async (tx) => {
      return registerDevice(tx, user.id, {
        fingerprint: "fp-remove-me",
        deviceName: "Temp Device",
        deviceType: "tablet",
        os: "iPadOS",
        browser: "Safari",
      }, "10.0.0.2");
    });

    await withTestTenantContext(user.id, async (tx) => {
      await removeDevice(tx, user.id, device.id);
    });

    const devices = await withTestTenantContext(user.id, async (tx) => {
      return listDevices(tx, user.id);
    });

    const found = devices.find((d) => d.id === device.id);
    expect(found).toBeUndefined();
  });
});
