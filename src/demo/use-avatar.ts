"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LiveAvatarSessionType = import("@heygen/liveavatar-web-sdk").LiveAvatarSession;

const AVATAR_ID = process.env.NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID ?? "";

export type AvatarStatus = "idle" | "loading" | "ready" | "speaking" | "error";

interface UseAvatarReturn {
  status: AvatarStatus;
  mediaStream: MediaStream | null;
  error: string | null;
  initAvatar: () => Promise<boolean>;
  speak: (text: string) => void;
  speakAudio: (pcmBase64: string) => void;
  stopAvatar: () => Promise<void>;
}

export function useAvatar(): UseAvatarReturn {
  const [status, setStatus] = useState<AvatarStatus>("idle");
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
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
          // Get the media stream from the LiveKit room
          const room = (session as unknown as {
            room: {
              remoteParticipants: Map<string, {
                videoTrackPublications: Map<string, {
                  track?: { mediaStream?: MediaStream }
                }>
              }>
            }
          }).room;
          if (room) {
            for (const [, participant] of room.remoteParticipants) {
              for (const [, pub] of participant.videoTrackPublications) {
                if (pub.track?.mediaStream) {
                  setMediaStream(pub.track.mediaStream);
                }
              }
            }
          }
          setStatus("ready");
          resolve(true);
        });

        session.on(SessionEvent.SESSION_DISCONNECTED, () => {
          clearTimeout(timeout);
          setStatus("idle");
          setMediaStream(null);
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

  // Send text for the avatar to speak via TTS + lip-sync
  const speak = useCallback((text: string) => {
    const session = sessionRef.current;
    if (!session) {
      console.warn("Session is not connected");
      return;
    }

    try {
      setStatus("speaking");
      session.repeat(text);
      const estimatedDuration = Math.max(3000, text.length * 60);
      setTimeout(() => {
        setStatus((prev) => (prev === "speaking" ? "ready" : prev));
      }, estimatedDuration);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Speak failed";
      setError(msg);
      setStatus("ready");
    }
  }, []);

  // Send pre-generated PCM audio for the avatar to lip-sync
  const speakAudio = useCallback((pcmBase64: string) => {
    const session = sessionRef.current;
    if (!session) {
      console.warn("Session is not connected");
      return;
    }

    try {
      setStatus("speaking");
      session.repeatAudio(pcmBase64);
      // Estimate duration from PCM size: 24kHz, 16-bit mono = 48000 bytes/sec
      const pcmBytes = (pcmBase64.length * 3) / 4; // base64 → bytes
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
    setMediaStream(null);
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
    mediaStream,
    error,
    initAvatar,
    speak,
    speakAudio,
    stopAvatar,
  };
}
