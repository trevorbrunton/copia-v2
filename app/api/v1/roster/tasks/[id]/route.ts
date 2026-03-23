import { z } from "zod";
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleGetRosterTask } from "@/src/server/queries/roster/get-roster-task";
import { handleHumanAction } from "@/src/server/commands/roster/handle-human-action";
import { handleAppError } from "@/src/server/errors";
import { makeDeps } from "@/src/server/make-deps";

const TaskIdParam = z.string().uuid();

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const { id } = await params;
    const taskId = TaskIdParam.parse(id);
    const result = await handleGetRosterTask(makeDeps(), { taskId }, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const traceId = crypto.randomUUID();
  try {
    const ctx = await requireAuthContext(req, traceId);
    const { id } = await params;
    const taskId = TaskIdParam.parse(id);
    const body = await req.json();
    const result = await handleHumanAction(makeDeps(), { taskId, ...body }, ctx);
    return Response.json(result);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
