import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleGetProfile } from "@/src/server/queries/users/get-profile";
import { handleUpdateProfile } from "@/src/server/commands/users/update-profile";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function GET(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const result = await handleGetProfile(makeDeps(), ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function PATCH(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const body = await req.json();
    const result = await handleUpdateProfile(makeDeps(), body, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
