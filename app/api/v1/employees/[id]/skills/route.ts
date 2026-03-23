import { NextRequest, NextResponse } from "next/server";
import { alayaFetch, type AlayaPaginatedResponse } from "@/src/lib/alayacare-client";
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

    const data = await alayaFetch<AlayaPaginatedResponse>(
      `/employees/employees/${id}/skills`
    );

    return NextResponse.json(data);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
