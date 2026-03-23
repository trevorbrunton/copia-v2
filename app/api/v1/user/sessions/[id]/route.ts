import { requireAuthContext } from "@/src/server/require-auth-context";
import {
  handleDeleteSession,
  handleHeartbeat,
} from "@/src/server/commands/sessions/manage-session";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

function extractId(url: string): string {
  return new URL(url).pathname.split("/").pop() || "";
}

export async function DELETE(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    let body = {};
    try {
      body = await req.json();
    } catch {
      // No body or invalid JSON — default to revoke
    }
    await handleDeleteSession(makeDeps(), extractId(req.url), body, ctx);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function PATCH(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const result = await handleHeartbeat(makeDeps(), extractId(req.url), ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
