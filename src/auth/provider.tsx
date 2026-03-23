"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/src/lib/supabase/client";
import { AuthContext } from "./context";
import { getAuthErrorMessage } from "./errors";
import type { AuthUser } from "./types";

const HEARTBEAT_INTERVAL = 15 * 60 * 1000; // 15 minutes
const SESSION_ID_KEY = "mayfly_session_id";

interface AuthProviderProps {
  children: ReactNode;
}

function parseAuthError(error: unknown): Error {
  const message = getAuthErrorMessage(error);
  return new Error(message);
}

// Uses bare fetch (not apiFetch) — runs during auth bootstrap before context is available
async function createSessionWithDevice(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  try {
    const { detectDevice } = await import("@/src/lib/device-detection");
    const deviceInfo = detectDevice();
    const res = await fetch("/api/user/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceInfo }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.id;
    }
  } catch {
    // Session creation failure is non-fatal
  }
  return null;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(SESSION_ID_KEY);
  });

  const supabase = useMemo(() => createClient(), []);
  const mounted = useRef(true);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(
    (sid: string) => {
      stopHeartbeat();
      heartbeatTimerRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/user/sessions/${sid}`, { method: "PATCH" });
          if (res.status === 401 || res.status === 404) {
            setSessionId(null);
            localStorage.removeItem(SESSION_ID_KEY);
            stopHeartbeat();
          }
        } catch {
          // Heartbeat failure is non-fatal
        }
      }, HEARTBEAT_INTERVAL);
    },
    [stopHeartbeat]
  );

  const persistSession = useCallback(
    (sid: string) => {
      setSessionId(sid);
      localStorage.setItem(SESSION_ID_KEY, sid);
      startHeartbeat(sid);
    },
    [startHeartbeat]
  );

  // Listen for auth state changes (sign-in, sign-out, token refresh)
  useEffect(() => {
    // Check initial session
    supabase.auth.getUser().then(({ data: { user: supaUser }, error: initError }) => {
      if (!mounted.current) return;
      if (initError) {
        setError(parseAuthError(initError));
      }
      if (supaUser) {
        setUser({
          userId: supaUser.id,
          email: supaUser.email || "",
          name: supaUser.user_metadata?.name,
        });
      }
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted.current) return;
        if (session?.user) {
          setUser({
            userId: session.user.id,
            email: session.user.email || "",
            name: session.user.user_metadata?.name,
          });
        } else {
          setUser(null);
        }
        setIsLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  // Mount/unmount tracking
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Start/stop heartbeat when auth state changes
  useEffect(() => {
    if (user && sessionId) {
      startHeartbeat(sessionId);
    } else {
      stopHeartbeat();
    }
  }, [user, sessionId, startHeartbeat, stopHeartbeat]);

  // Cleanup heartbeat on unmount
  useEffect(() => {
    return stopHeartbeat;
  }, [stopHeartbeat]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (signInError) {
          throw signInError;
        }

        const sid = await createSessionWithDevice();
        if (sid) persistSession(sid);
      } catch (err) {
        const parsed = parseAuthError(err);
        setIsLoading(false);
        setError(parsed);
        throw parsed;
      }
    },
    [supabase, persistSession]
  );

  const signUp = useCallback(
    async (email: string, password: string, name: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        setIsLoading(false);

        // Supabase returns a user with identities=[] if email already registered
        const needsVerification = !data.session;
        return { needsVerification };
      } catch (err) {
        const parsed = parseAuthError(err);
        setIsLoading(false);
        setError(parsed);
        throw parsed;
      }
    },
    [supabase]
  );

  const confirmSignUp = useCallback(
    async (email: string, code: string) => {
      setIsLoading(true);
      setError(null);

      try {
        const { error: verifyError } = await supabase.auth.verifyOtp({
          email,
          token: code,
          type: "signup",
        });

        if (verifyError) {
          throw verifyError;
        }

        const sid = await createSessionWithDevice();
        if (sid) persistSession(sid);
        setIsLoading(false);
      } catch (err) {
        const parsed = parseAuthError(err);
        setIsLoading(false);
        setError(parsed);
        throw parsed;
      }
    },
    [supabase, persistSession]
  );

  const resendCode = useCallback(
    async (email: string) => {
      try {
        const { error: resendError } = await supabase.auth.resend({
          type: "signup",
          email,
        });
        if (resendError) throw resendError;
      } catch (err) {
        const parsed = parseAuthError(err);
        setError(parsed);
        throw parsed;
      }
    },
    [supabase]
  );

  const signOut = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    // End current session before signing out
    if (sessionId) {
      try {
        await fetch(`/api/user/sessions/${sessionId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "end" }),
        });
      } catch {
        // Non-fatal
      }
    }
    stopHeartbeat();
    setSessionId(null);
    localStorage.removeItem(SESSION_ID_KEY);

    await supabase.auth.signOut();
    setUser(null);
    setIsLoading(false);
  }, [supabase, sessionId, stopHeartbeat]);

  const forgotPassword = useCallback(
    async (email: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(
          email,
          { redirectTo: `${window.location.origin}/reset-password` }
        );
        if (resetError) throw resetError;
        setIsLoading(false);
      } catch (err) {
        const parsed = parseAuthError(err);
        setIsLoading(false);
        setError(parsed);
        throw parsed;
      }
    },
    [supabase]
  );

  const confirmResetPassword = useCallback(
    async (newPassword: string) => {
      setIsLoading(true);
      setError(null);
      try {
        // With Supabase, the user is already authenticated via the reset link.
        // We just need to update the password.
        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (updateError) throw updateError;
        setIsLoading(false);
      } catch (err) {
        const parsed = parseAuthError(err);
        setIsLoading(false);
        setError(parsed);
        throw parsed;
      }
    },
    [supabase]
  );

  const updatePassword = useCallback(
    async (oldPassword: string, newPassword: string) => {
      try {
        // Verify current password first as UX confirmation
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (!currentUser?.email) throw new Error("Not authenticated");

        const { error: verifyError } = await supabase.auth.signInWithPassword({
          email: currentUser.email,
          password: oldPassword,
        });
        if (verifyError) {
          throw new Error("Current password is incorrect");
        }

        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });
        if (updateError) throw updateError;
      } catch (err) {
        const parsed = parseAuthError(err);
        setError(parsed);
        throw parsed;
      }
    },
    [supabase]
  );

  const refreshSession = useCallback(async (): Promise<void> => {
    const { data: { user: supaUser } } = await supabase.auth.getUser();
    if (supaUser && mounted.current) {
      setUser({
        userId: supaUser.id,
        email: supaUser.email || "",
        name: supaUser.user_metadata?.name,
      });
    }
  }, [supabase]);

  const contextValue = useMemo(
    () => ({
      user,
      isAuthenticated: !!user,
      isLoading,
      error,
      sessionId,
      signIn,
      signUp,
      confirmSignUp,
      resendCode,
      signOut,
      forgotPassword,
      confirmResetPassword,
      updatePassword,
      refreshSession,
    }),
    [
      user,
      isLoading,
      error,
      sessionId,
      signIn,
      signUp,
      confirmSignUp,
      resendCode,
      signOut,
      forgotPassword,
      confirmResetPassword,
      updatePassword,
      refreshSession,
    ]
  );

  return (
    <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>
  );
}
