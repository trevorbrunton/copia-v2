import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleCreateRosterTask } from "@/src/server/commands/roster/create-roster-task";
import { handleListRosterTasks } from "@/src/server/queries/roster/list-roster-tasks";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const body = await req.json();
    const result = await handleCreateRosterTask(makeDeps(), body, ctx);
    return Response.json(result, { status: 201 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function GET(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const url = new URL(req.url);
    const limitStr = url.searchParams.get("limit");
    const offsetStr = url.searchParams.get("offset");
    const filter = {
      status: url.searchParams.get("status") || undefined,
      limit: limitStr ? Number(limitStr) : undefined,
      offset: offsetStr ? Number(offsetStr) : undefined,
    };
    const result = await handleListRosterTasks(makeDeps(), filter, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
