import { describe, it, expect } from "vitest";
import { ZodError } from "zod";
import { CreateSessionInput } from "@/src/server/commands/sessions/create-session";
import { SessionIdInput, DeleteSessionInput } from "@/src/server/commands/sessions/manage-session";
import { RevokeAllSessionsInput } from "@/src/server/commands/sessions/revoke-all-sessions";
import { RemoveDeviceInput } from "@/src/server/commands/sessions/remove-device";
import { DeleteAccountInput } from "@/src/server/commands/users/delete-account";
import { LoginHistoryInput } from "@/src/server/queries/users/get-login-history";

describe("Zod input schemas", () => {
  describe("CreateSessionInput", () => {
    it("accepts valid device info", () => {
      const result = CreateSessionInput.parse({
        deviceInfo: {
          fingerprint: "fp123",
          deviceName: "Chrome on Mac",
          deviceType: "desktop",
          os: "macOS",
          browser: "Chrome",
        },
      });
      expect(result.deviceInfo.deviceType).toBe("desktop");
    });

    it("rejects invalid device type", () => {
      expect(() =>
        CreateSessionInput.parse({
          deviceInfo: {
            fingerprint: "fp123",
            deviceName: "Test",
            deviceType: "watch",
            os: "watchOS",
            browser: "Safari",
          },
        })
      ).toThrow(ZodError);
    });
  });

  describe("SessionIdInput", () => {
    it("accepts valid UUID", () => {
      const result = SessionIdInput.parse({ id: "550e8400-e29b-41d4-a716-446655440000" });
      expect(result.id).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("rejects non-UUID", () => {
      expect(() => SessionIdInput.parse({ id: "not-uuid" })).toThrow(ZodError);
    });
  });

  describe("DeleteSessionInput", () => {
    it("defaults to revoke", () => {
      const result = DeleteSessionInput.parse({});
      expect(result.action).toBe("revoke");
    });

    it("accepts end action", () => {
      const result = DeleteSessionInput.parse({ action: "end" });
      expect(result.action).toBe("end");
    });
  });

  describe("RevokeAllSessionsInput", () => {
    it("accepts optional currentSessionId", () => {
      const result = RevokeAllSessionsInput.parse({
        currentSessionId: "550e8400-e29b-41d4-a716-446655440000",
      });
      expect(result.currentSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("accepts empty object", () => {
      const result = RevokeAllSessionsInput.parse({});
      expect(result.currentSessionId).toBeUndefined();
    });
  });

  describe("RemoveDeviceInput", () => {
    it("rejects non-UUID", () => {
      expect(() => RemoveDeviceInput.parse({ id: "bad" })).toThrow(ZodError);
    });
  });

  describe("DeleteAccountInput", () => {
    it("accepts literal DELETE", () => {
      const result = DeleteAccountInput.parse({ confirm: "DELETE" });
      expect(result.confirm).toBe("DELETE");
    });

    it("rejects confirm values other than DELETE", () => {
      expect(() => DeleteAccountInput.parse({ confirm: "delete" })).toThrow(ZodError);
      expect(() => DeleteAccountInput.parse({ confirm: "CONFIRM" })).toThrow(ZodError);
    });

    it("rejects missing confirm", () => {
      expect(() => DeleteAccountInput.parse({})).toThrow(ZodError);
    });
  });

  describe("LoginHistoryInput", () => {
    it("applies default limit", () => {
      const result = LoginHistoryInput.parse({});
      expect(result.limit).toBe(20);
    });

    it("clamps limit", () => {
      expect(() => LoginHistoryInput.parse({ limit: 0 })).toThrow(ZodError);
      expect(() => LoginHistoryInput.parse({ limit: 101 })).toThrow(ZodError);
    });
  });
});
