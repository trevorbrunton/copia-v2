import { NextRequest, NextResponse } from "next/server";
import { alayaFetch, type AlayaPaginatedResponse } from "@/src/lib/alayacare-client";
import { requireAuthContext } from "@/src/server/require-auth-context";
import { handleAppError } from "@/src/server/errors";

export async function GET(request: NextRequest) {
  const traceId = crypto.randomUUID();
  try {
    await requireAuthContext(request, traceId);

    const searchParams = request.nextUrl.searchParams;
    const params = new URLSearchParams();

    for (const [key, value] of searchParams.entries()) {
      params.append(key, value);
    }

    const data = await alayaFetch<AlayaPaginatedResponse>(
      "/employees/skills",
      { searchParams: params }
    );

    return NextResponse.json(data);
  } catch (err) {
    return handleAppError(err, traceId);
  }
}
