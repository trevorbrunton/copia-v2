import { NextRequest } from "next/server";
import { requireAuthContext } from "@/src/server/require-auth-context";
import { makeDeps } from "@/src/server/make-deps";
import { handleSearchAuditLog } from "@/src/server/queries/roster/search-audit-log";
import { handleAppError } from "@/src/server/errors";

export async function GET(req: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const deps = makeDeps();
    const params = Object.fromEntries(req.nextUrl.searchParams.entries());
    const result = await handleSearchAuditLog(deps, params, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
