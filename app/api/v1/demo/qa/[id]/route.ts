import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleUpdateQaPair } from "@/src/server/commands/demo/update-qa-pair";
import { handleDeleteQaPair } from "@/src/server/commands/demo/delete-qa-pair";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const { id } = await params;
    const body = await req.json();
    const result = await handleUpdateQaPair(makeDeps(), id, body, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const { id } = await params;
    const result = await handleDeleteQaPair(makeDeps(), id, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
