import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleProcessPendingEvents } from "@/src/server/commands/roster/process-pending-events";
import { handleAppError, ForbiddenError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

/**
 * Batch event processing — system/admin operation.
 * Restricted to admin role (when RBAC is implemented) or owner-level access.
 * Currently guarded by checking that the user has the "admin" role.
 * Since RBAC is not yet implemented, all authenticated users have role "user",
 * so this endpoint is effectively locked until admin roles are assigned.
 */
export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);

    // Guard: only admin role can trigger batch event processing
    if (!ctx.roles.includes("admin")) {
      throw new ForbiddenError("Admin role required for batch event processing");
    }

    const result = await handleProcessPendingEvents(makeDeps(), undefined, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
