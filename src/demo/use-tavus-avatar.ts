"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyCall, DailyEventObjectTrack, DailyEventObjectParticipant } from "@daily-co/daily-js";

export type TavusAvatarStatus =
  | "idle"
  | "loading"
  | "ready"
  | "speaking"
  | "error";

interface UseTavusAvatarReturn {
  status: TavusAvatarStatus;
  mediaStream: MediaStream | null;
  error: string | null;
  initAvatar: () => Promise<boolean>;
  /** Send text for the replica to speak verbatim (echo mode). */
  echo: (text: string) => void;
  /** Interrupt the replica mid-sentence. */
  interrupt: () => void;
  stopAvatar: () => Promise<void>;
}

/**
 * Hook for managing a Tavus CVI streaming avatar via Daily.co WebRTC.
 *
 * Flow:
 * 1. `initAvatar()` calls our server to create a Tavus conversation → gets a Daily.co room URL
 * 2. Joins the Daily room → receives the replica's video/audio as a MediaStream
 * 3. `echo(text)` sends text via Daily app-message for the replica to speak with lip-sync
 * 4. `stopAvatar()` leaves the call and ends the conversation
 */
export function useTavusAvatar(): UseTavusAvatarReturn {
  const [status, setStatus] = useState<TavusAvatarStatus>("idle");
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Daily call object ref
  const callRef = useRef<DailyCall | null>(null);
  const initializingRef = useRef(false);
  const conversationIdRef = useRef<string | null>(null);
  const resolvedRef = useRef(false);

  const initAvatar = useCallback(async (): Promise<boolean> => {
    if (initializingRef.current || callRef.current) return false;
    initializingRef.current = true;
    resolvedRef.current = false;
    setStatus("loading");
    setError(null);

    try {
      // 1. Create conversation via our server
      const res = await fetch("/api/demo/tavus", { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error?.message ?? `Tavus session request failed: ${res.status}`
        );
      }
      const { conversationId, conversationUrl } = await res.json();
      conversationIdRef.current = conversationId;

      // 2. Dynamic import to avoid SSR issues
      const DailyIframe = (await import("@daily-co/daily-js")).default;

      const call = DailyIframe.createCallObject({
        videoSource: false,
        audioSource: false,
      });
      callRef.current = call;

      // 3. Set up participant tracking to capture the replica's media stream
      const ready = new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          console.warn("Tavus avatar stream ready timeout (30s)");
          resolve(false);
        }, 30_000);

        /** Try to extract the replica's video+audio into a MediaStream. */
        const tryExtractStream = () => {
          if (resolvedRef.current) return;
          const participants = call.participants();
          for (const [id, p] of Object.entries(participants)) {
            if (id === "local") continue;
            const videoTrack = p.tracks?.video?.persistentTrack;
            const audioTrack = p.tracks?.audio?.persistentTrack;
            if (videoTrack) {
              const stream = new MediaStream();
              stream.addTrack(videoTrack);
              if (audioTrack) {
                stream.addTrack(audioTrack);
              }
              setMediaStream(stream);
              setStatus("ready");
              clearTimeout(timeout);
              resolvedRef.current = true;
              resolve(true);
              return;
            }
          }
        };

        const handleTrackStarted = (event: DailyEventObjectTrack) => {
          if (!event.participant || event.participant.local) return;
          if (event.track?.kind === "video") {
            tryExtractStream();
          }
        };

        const handleParticipantUpdated = (event: DailyEventObjectParticipant) => {
          if (!event.participant || event.participant.local) return;
          if (event.participant.tracks?.video?.persistentTrack) {
            tryExtractStream();
          }
        };

        call.on("track-started", handleTrackStarted);
        call.on("participant-updated", handleParticipantUpdated);

        call.on("left-meeting", () => {
          clearTimeout(timeout);
          setStatus("idle");
          setMediaStream(null);
          callRef.current = null;
          resolve(false);
        });

        call.on("error", (evt) => {
          clearTimeout(timeout);
          console.error("Daily call error:", evt);
          setError(
            evt?.error?.msg ?? evt?.errorMsg ?? "Daily.co connection error"
          );
          setStatus("error");
          resolve(false);
        });
      });

      // 4. Join the Daily room
      await call.join({ url: conversationUrl });

      return await ready;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Tavus avatar init failed";
      console.error("Tavus avatar init error:", err);
      setError(msg);
      setStatus("error");
      callRef.current = null;
      return false;
    } finally {
      initializingRef.current = false;
    }
  }, []);

  /**
   * Send text for the replica to speak verbatim with lip-sync (echo mode).
   * Uses Daily's sendAppMessage to send a CVI interaction.
   */
  const echo = useCallback((text: string) => {
    const call = callRef.current;
    if (!call) {
      console.warn("Tavus: No active call for echo");
      return;
    }

    try {
      setStatus("speaking");
      call.sendAppMessage(
        {
          message_type: "conversation",
          event_type: "conversation.echo",
          properties: { modality: "text", text },
        },
        "*"
      );

      // Estimate speaking duration from text length (~60ms per character)
      const estimatedDuration = Math.max(3000, text.length * 60);
      setTimeout(() => {
        setStatus((prev) => (prev === "speaking" ? "ready" : prev));
      }, estimatedDuration);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Echo failed";
      setError(msg);
      setStatus("ready");
    }
  }, []);

  /** Interrupt the replica mid-sentence. */
  const interrupt = useCallback(() => {
    const call = callRef.current;
    if (!call) return;

    try {
      call.sendAppMessage(
        {
          message_type: "conversation",
          event_type: "conversation.interrupt",
        },
        "*"
      );
      setStatus("ready");
    } catch {
      // Best-effort
    }
  }, []);

  const stopAvatar = useCallback(async () => {
    const call = callRef.current;
    if (!call) return;

    try {
      await call.leave();
    } catch {
      // Best-effort cleanup
    }
    try {
      await call.destroy();
    } catch {
      // Best-effort cleanup
    }
    callRef.current = null;
    setMediaStream(null);
    setStatus("idle");

    // End the conversation server-side (best-effort)
    const convId = conversationIdRef.current;
    if (convId) {
      fetch(`/api/demo/tavus/${convId}`, { method: "DELETE" }).catch(() => {});
      conversationIdRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const call = callRef.current;
      if (call) {
        call.leave().catch(() => {});
        call.destroy().catch(() => {});
        callRef.current = null;
      }
    };
  }, []);

  return {
    status,
    mediaStream,
    error,
    initAvatar,
    echo,
    interrupt,
    stopAvatar,
  };
}
