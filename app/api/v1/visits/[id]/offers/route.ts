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
      `/scheduler/visits/${id}/offers`
    );

    return NextResponse.json(data);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const traceId = crypto.randomUUID();
  try {
    await requireAuthContext(request, traceId);
    const { id } = await params;
    const body = await request.json();

    const data = await alayaFetch(`/scheduler/visits/${id}/offers`, {
      method: "POST",
      body,
    });

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
