import { createClient } from "@supabase/supabase-js";
import { createServerSupabase } from "@/src/lib/supabase/server";
import type { AuthUser } from "./types";

function toAuthUser(user: { id: string; email?: string; user_metadata?: Record<string, unknown> }): AuthUser {
  return {
    userId: user.id,
    email: user.email || "",
    name: user.user_metadata?.name as string | undefined,
  };
}

/**
 * Get the authenticated user from cookies (server components / API routes).
 */
export async function getServerUser(): Promise<AuthUser | null> {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) return null;
  return toAuthUser(user);
}

/**
 * Get the authenticated user from a Request object.
 * Supports both cookie auth (web) and Bearer token (mobile).
 */
export async function getServerUserFromRequest(
  request: Request
): Promise<AuthUser | null> {
  // Try Bearer token first (mobile)
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return null;
    return toAuthUser(user);
  }

  // Fall back to cookie auth (web)
  return getServerUser();
}
