"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LiveAvatarSessionType = import("@heygen/liveavatar-web-sdk").LiveAvatarSession;

const AVATAR_ID = process.env.NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID ?? "";

export type AvatarStatus = "idle" | "loading" | "ready" | "speaking" | "error";

interface UseAvatarReturn {
  status: AvatarStatus;
  error: string | null;
  /** true once SESSION_STREAM_READY has fired and attach() will work */
  isReady: boolean;
  initAvatar: () => Promise<boolean>;
  /** Attach the avatar's video+audio to a <video> element (call once stream is ready) */
  attach: (element: HTMLVideoElement) => void;
  speakAudio: (pcmBinaryStr: string) => void;
  stopAvatar: () => Promise<void>;
}

export function useAvatar(): UseAvatarReturn {
  const [status, setStatus] = useState<AvatarStatus>("idle");
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<LiveAvatarSessionType | null>(null);
  const initializingRef = useRef(false);

  const initAvatar = useCallback(async (): Promise<boolean> => {
    if (!AVATAR_ID) {
      setError("NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID is not configured");
      return false;
    }

    if (initializingRef.current || sessionRef.current) return false;
    initializingRef.current = true;
    setStatus("loading");
    setError(null);

    try {
      // Get session token from our server
      const tokenRes = await fetch("/api/demo/avatar", { method: "POST" });
      if (!tokenRes.ok) {
        const body = await tokenRes.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Token request failed: ${tokenRes.status}`);
      }
      const { sessionToken } = await tokenRes.json();

      // Dynamic import to avoid SSR
      const { LiveAvatarSession, SessionEvent } = await import(
        "@heygen/liveavatar-web-sdk"
      );

      const session = new LiveAvatarSession(sessionToken);
      sessionRef.current = session;

      // Set up event listeners BEFORE starting
      const ready = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn("Avatar stream ready timeout (15s)");
          resolve(false);
        }, 15_000);

        session.on(SessionEvent.SESSION_STREAM_READY, () => {
          clearTimeout(timeout);
          setStatus("ready");
          setIsReady(true);
          resolve(true);
        });

        session.on(SessionEvent.SESSION_DISCONNECTED, () => {
          clearTimeout(timeout);
          setStatus("idle");
          setIsReady(false);
          sessionRef.current = null;
          resolve(false);
        });
      });

      // Start the session — connects to LiveKit and starts the avatar
      await session.start();

      return await ready;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Avatar init failed";
      console.error("Avatar init error:", err);
      setError(msg);
      setStatus("error");
      sessionRef.current = null;
      return false;
    } finally {
      initializingRef.current = false;
    }
  }, []);

  // Use the SDK's attach() to wire both video+audio tracks to a <video> element
  const attach = useCallback((element: HTMLVideoElement) => {
    const session = sessionRef.current;
    if (!session) {
      console.warn("Cannot attach: session is not connected");
      return;
    }
    session.attach(element);
  }, []);

  /**
   * Send PCM audio (base64-encoded) directly to the WebSocket.
   *
   * The SDK's `repeatAudio()` has a bug: it splits base64 at raw-byte boundaries
   * (960-char chunks) instead of base64-aligned boundaries, corrupting the encoding.
   * We bypass it and send properly chunked base64 directly per the HeyGen docs:
   * "PCM 16Bit 24KHz bytes encoded as Base64", ~1 second chunks, < 1MB per message.
   */
  const speakAudio = useCallback((pcmBase64: string) => {
    const session = sessionRef.current;
    if (!session) {
      console.warn("Session is not connected");
      return;
    }

    // Access the WebSocket directly
    const ws = (session as unknown as { _sessionEventSocket: WebSocket | null })
      ._sessionEventSocket;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn("WebSocket not open for audio");
      return;
    }

    try {
      setStatus("speaking");

      const eventId = crypto.randomUUID();
      // ~1 second of audio at 24kHz 16-bit mono = 48000 bytes = 64000 base64 chars
      // Use 64000 chars per chunk (must be multiple of 4 for valid base64)
      const CHUNK_SIZE = 64000;

      for (let i = 0; i < pcmBase64.length; i += CHUNK_SIZE) {
        const chunk = pcmBase64.slice(i, i + CHUNK_SIZE);
        ws.send(JSON.stringify({
          type: "agent.speak",
          event_id: eventId,
          audio: chunk,
        }));
      }

      // Signal end of audio
      ws.send(JSON.stringify({
        type: "agent.speak_end",
        event_id: eventId,
      }));

      // Estimate duration: base64 length * 3/4 = PCM bytes, 48000 bytes/sec
      const pcmBytes = (pcmBase64.length * 3) / 4;
      const durationMs = Math.max(3000, (pcmBytes / 48000) * 1000);
      setTimeout(() => {
        setStatus((prev) => (prev === "speaking" ? "ready" : prev));
      }, durationMs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Audio playback failed";
      setError(msg);
      setStatus("ready");
    }
  }, []);

  const stopAvatar = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;

    try {
      await session.stop();
    } catch {
      // Best-effort cleanup
    }
    sessionRef.current = null;
    setIsReady(false);
    setStatus("idle");
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        sessionRef.current.stop().catch(() => {});
        sessionRef.current = null;
      }
    };
  }, []);

  return {
    status,
    isReady,
    error,
    initAvatar,
    attach,
    speakAudio,
    stopAvatar,
  };
}
