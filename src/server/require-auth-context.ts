import { getServerUserFromRequest } from "@/src/auth/server";
import { getOrCreateUser } from "@/src/lib/auth";
import type { AuthContext } from "./auth-context";
import { UnauthorizedError, ForbiddenError } from "./errors";

/**
 * Extract and validate AuthContext from a request.
 * Handles both cookie (web) and Bearer token (mobile) auth.
 *
 * This runs OUTSIDE the UoW — it uses direct db access internally
 * for getOrCreateUser, which is the only code path that runs without
 * tenant context (documented exception per migration plan D3).
 */
export async function requireAuthContext(req: Request, traceId: string): Promise<AuthContext> {
  const authUser = await getServerUserFromRequest(req);
  if (!authUser) {
    throw new UnauthorizedError();
  }

  const dbUser = await getOrCreateUser(
    authUser.userId,
    authUser.email,
    authUser.name
  );

  if (dbUser.status === "suspended") {
    throw new ForbiddenError(
      "Account suspended",
      "ACCOUNT_SUSPENDED",
      dbUser.statusReason
    );
  }
  if (dbUser.status === "soft_deleted") {
    throw new ForbiddenError("Account deleted", "ACCOUNT_DELETED");
  }

  if (!dbUser.email) {
    throw new Error("User record has no email — data integrity issue");
  }

  return {
    principalId: dbUser.id,
    supabaseId: authUser.userId,
    email: dbUser.email,
    roles: [],
    traceId,
  };
}
