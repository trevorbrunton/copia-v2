import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleRemoveDevice } from "@/src/server/commands/sessions/remove-device";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

function extractId(url: string): string {
  return new URL(url).pathname.split("/").pop() || "";
}

export async function DELETE(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    await handleRemoveDevice(makeDeps(), extractId(req.url), ctx);
    return new Response(null, { status: 204 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
