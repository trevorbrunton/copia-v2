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
  /** Send text for the replica to speak verbatim (echo mode). Resolves when speech ends. */
  echo: (text: string) => Promise<void>;
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
  // Resolve function for the current echo() call — set when speaking, cleared on speech end.
  const echoResolveRef = useRef<(() => void) | null>(null);

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
          // Log participant state at timeout for diagnostics
          const participants = call.participants();
          const remoteIds = Object.keys(participants).filter((id) => id !== "local");
          console.warn(
            "Tavus avatar stream ready timeout (60s). Remote participants:",
            remoteIds.length,
            remoteIds.map((id) => ({
              id,
              videoState: participants[id]?.tracks?.video?.state,
              audioState: participants[id]?.tracks?.audio?.state,
              hasVideoTrack: !!participants[id]?.tracks?.video?.persistentTrack,
              hasAudioTrack: !!participants[id]?.tracks?.audio?.persistentTrack,
            }))
          );
          resolve(false);
        }, 60_000);

        /** Try to extract the replica's video+audio into a MediaStream. */
        const tryExtractStream = () => {
          if (resolvedRef.current) return;
          const participants = call.participants();
          for (const [id, p] of Object.entries(participants)) {
            if (id === "local") continue;
            const videoTrack = p.tracks?.video?.persistentTrack;
            const audioTrack = p.tracks?.audio?.persistentTrack;
            console.log("[tavus] tryExtractStream participant:", id, {
              videoState: p.tracks?.video?.state,
              audioState: p.tracks?.audio?.state,
              hasVideoTrack: !!videoTrack,
              hasAudioTrack: !!audioTrack,
            });
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
          console.log("[tavus] track-started:", {
            kind: event.track?.kind,
            isLocal: event.participant?.local,
            participantId: event.participant?.session_id,
          });
          if (!event.participant || event.participant.local) return;
          // Try on any track, not just video — audio arriving means the replica is live
          tryExtractStream();
        };

        const handleParticipantUpdated = (event: DailyEventObjectParticipant) => {
          if (!event.participant || event.participant.local) return;
          console.log("[tavus] participant-updated:", {
            id: event.participant.session_id,
            videoState: event.participant.tracks?.video?.state,
            audioState: event.participant.tracks?.audio?.state,
          });
          tryExtractStream();
        };

        call.on("track-started", handleTrackStarted);
        call.on("participant-updated", handleParticipantUpdated);

        call.on("participant-joined", (evt) => {
          console.log("[tavus] participant-joined:", {
            id: evt?.participant?.session_id,
            local: evt?.participant?.local,
          });
        });

        call.on("joined-meeting", (evt) => {
          console.log("[tavus] joined-meeting:", evt);
        });

        // Listen for Tavus CVI app-messages to detect speech completion.
        call.on("app-message", (evt) => {
          const data = evt?.data;
          if (!data) return;
          console.log("[tavus] app-message:", data);

          // Tavus CVI signals speech end with various event types.
          // Check for utterance_end / echo_end / response_end patterns.
          const eventType: string = data.event_type ?? data.type ?? "";
          if (
            eventType.includes("utterance_end") ||
            eventType.includes("echo_end") ||
            eventType.includes("response_end") ||
            eventType.includes("stopped_speaking")
          ) {
            console.log("[tavus] Speech end detected via:", eventType);
            setStatus((prev) => (prev === "speaking" ? "ready" : prev));
            if (echoResolveRef.current) {
              echoResolveRef.current();
              echoResolveRef.current = null;
            }
          }
        });

        call.on("left-meeting", () => {
          console.warn("[tavus] left-meeting — resolving false");
          clearTimeout(timeout);
          setStatus("idle");
          setMediaStream(null);
          callRef.current = null;
          resolve(false);
        });

        call.on("error", (evt) => {
          clearTimeout(timeout);
          console.error("[tavus] Daily call error:", evt);
          setError(
            evt?.error?.msg ?? evt?.errorMsg ?? "Daily.co connection error"
          );
          setStatus("error");
          resolve(false);
        });
      });

      // 4. Join the Daily room
      console.log("[tavus] Joining Daily room:", conversationUrl);
      await call.join({ url: conversationUrl });
      console.log("[tavus] Daily join() resolved, waiting for replica tracks...");

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
   * Resolves when the replica signals speech completion via app-message,
   * or after a generous fallback timeout.
   */
  const echo = useCallback((text: string): Promise<void> => {
    const call = callRef.current;
    if (!call) {
      console.warn("Tavus: No active call for echo");
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      // Fallback timeout in case no speech-end event arrives (~80ms/char + 3s buffer)
      const fallbackMs = Math.max(5000, text.length * 80 + 3000);
      const fallback = setTimeout(() => {
        console.warn("[tavus] echo fallback timeout fired after", fallbackMs, "ms");
        setStatus((prev) => (prev === "speaking" ? "ready" : prev));
        echoResolveRef.current = null;
        resolve();
      }, fallbackMs);

      // Store resolve so the app-message listener can call it
      echoResolveRef.current = () => {
        clearTimeout(fallback);
        resolve();
      };

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
      } catch (err) {
        clearTimeout(fallback);
        echoResolveRef.current = null;
        const msg = err instanceof Error ? err.message : "Echo failed";
        setError(msg);
        setStatus("ready");
        resolve();
      }
    });
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
