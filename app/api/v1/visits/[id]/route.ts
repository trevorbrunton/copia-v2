import { NextRequest, NextResponse } from "next/server";
import { alayaFetch } from "@/src/lib/alayacare-client";
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleAppError } from "@/src/server/errors";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    await requireAuthContext(request, traceId);
    const { id } = await params;

    const visitId = Number(id);
    if (!Number.isInteger(visitId) || visitId <= 0) {
      return handleAppError(
        { issues: [{ message: "Visit ID must be a positive integer", path: ["id"] }] },
        traceId
      );
    }

    const data = await alayaFetch(`/scheduler/visits/${visitId}`);
    return NextResponse.json(data);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
