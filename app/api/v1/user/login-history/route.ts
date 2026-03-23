import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleGetLoginHistory } from "@/src/server/queries/users/get-login-history";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function GET(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const url = new URL(req.url);
    const result = await handleGetLoginHistory(
      makeDeps(),
      Object.fromEntries(url.searchParams),
      ctx
    );
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
