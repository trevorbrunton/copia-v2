import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleDeleteAccount } from "@/src/server/commands/users/delete-account";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";
import { getClientIp } from "@/src/lib/api-response";

export async function DELETE(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const body = await req.json();
    const ipAddress = getClientIp(req);
    const result = await handleDeleteAccount(makeDeps(), body, ctx, ipAddress);

    // Supabase handles cookie clearing via signOut on the client side.
    return Response.json(
      { ok: true, purgeAfter: result.purgeAfter },
      { status: 200 }
    );
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
