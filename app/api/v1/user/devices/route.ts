import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleListDevices } from "@/src/server/queries/users/list-devices";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function GET(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const result = await handleListDevices(makeDeps(), ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
