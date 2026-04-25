import { createServerSupabase } from "@/src/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/demo/screen";

  // Prevent open redirect — only allow relative paths
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/demo/screen";

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      return NextResponse.redirect(new URL(next, request.url));
    }
  }

  // If code exchange fails, redirect to sign-in with error
  return NextResponse.redirect(
    new URL("/sign-in?error=auth_callback_failed", request.url)
  );
}
