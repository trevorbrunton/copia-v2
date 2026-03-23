import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleListSessions } from "@/src/server/queries/users/list-sessions";
import { handleCreateSession } from "@/src/server/commands/sessions/create-session";
import { handleRevokeAllSessions } from "@/src/server/commands/sessions/revoke-all-sessions";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";
import { getClientIp } from "@/src/lib/api-response";

export async function GET(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const result = await handleListSessions(makeDeps(), ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const body = await req.json();
    const ip = getClientIp(req);
    const ua = req.headers.get("user-agent") || "";
    const result = await handleCreateSession(makeDeps(), body, ctx, ip, ua);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function DELETE(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const body = await req.json();
    const result = await handleRevokeAllSessions(makeDeps(), body, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
