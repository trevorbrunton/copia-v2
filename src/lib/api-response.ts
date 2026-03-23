import { NextResponse } from "next/server";

export function forbidden(message: string, code?: string, reason?: string | null) {
  return NextResponse.json({ error: message, code, reason: reason ?? undefined }, { status: 403 });
}

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
