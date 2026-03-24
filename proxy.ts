import { createMiddlewareSupabase } from "@/src/lib/supabase/middleware";
import { NextRequest, NextResponse } from "next/server";

// Routes accessible without authentication
const PUBLIC_ROUTES = ["/", "/sign-in", "/sign-up", "/forgot-password", "/reset-password", "/verify", "/demo"];
// Auth pages that redirect to /demo if user is already logged in
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

  const { supabase, response } = await createMiddlewareSupabase(request);
  const { data: { user } } = await supabase.auth.getUser();

  const isPublic = PUBLIC_ROUTES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );
  const isAuthPage = AUTH_PAGES.some(
    (r) => pathname === r || pathname.startsWith(r + "/")
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    if (pathname !== "/") url.searchParams.set("redirect", pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/demo";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
