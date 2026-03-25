import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleListQaPairs } from "@/src/server/queries/demo/list-qa-pairs";
import { handleCreateQaPair } from "@/src/server/commands/demo/create-qa-pair";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function GET(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const result = await handleListQaPairs(makeDeps(), ctx);
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
    const result = await handleCreateQaPair(makeDeps(), body, ctx);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
