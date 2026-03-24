import { NextRequest, NextResponse } from "next/server";

// Auth pages that now redirect straight to /demo
const AUTH_PAGES = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify"];

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip API routes, static files, auth callback
  if (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/auth/callback") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // Redirect auth pages straight to demo
  const isAuthPage = AUTH_PAGES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );

  if (isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/demo";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
