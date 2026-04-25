"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DailyCall, DailyEventObjectTrack, DailyEventObjectParticipant } from "@daily-co/daily-js";

/**
 * Best-effort end of a Tavus conversation. `keepalive: true` allows the
 * request to survive page tear-down (tab close, hard navigation) — a
 * plain fetch is aborted by the browser on unload, which used to leak
 * conversations and quietly bill the demo.
 */
function endConversation(conversationId: string): void {
  try {
    fetch(`/api/demo/tavus/${conversationId}`, {
      method: "DELETE",
      keepalive: true,
    }).catch(() => {});
  } catch {
    // No-op — last-ditch effort, never throw from cleanup paths.
  }
}

const RECONNECT_FAILED_MSG = "Pep disconnected and reconnect failed.";
const RECONNECTING_MSG = "Pep disconnected — reconnecting…";

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
  initAvatar: (personaId?: string) => Promise<boolean>;
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
  // Timer for the echo() fallback timeout so unmount can clear it.
  const echoFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Persisted across reconnect attempts: the persona we last initialised
  // with, and a one-shot guard so a flaky connection can't loop on
  // creating new (billable) Tavus conversations.
  const lastPersonaIdRef = useRef<string | undefined>(undefined);
  const reconnectAttemptedRef = useRef(false);
  const reconnectingRef = useRef(false);
  // Forward-ref to initAvatar — populated in a useEffect below so the
  // disconnect listeners (declared inside initAvatar) can call back into
  // a fresh session without a circular closure.
  const reinitRef = useRef<((personaId?: string) => Promise<boolean>) | null>(
    null
  );

  /**
   * One-shot reconnect attempt fired when an established Tavus session
   * drops (replica leaves, local left-meeting after ready). Bills a new
   * conversation, so guarded by `reconnectAttemptedRef` — a flaky
   * connection only burns one extra session, not a loop.
   */
  const tryReconnect = useCallback((): void => {
    if (reconnectingRef.current) return;
    if (reconnectAttemptedRef.current) {
      setStatus("error");
      setError(RECONNECT_FAILED_MSG);
      return;
    }
    reconnectAttemptedRef.current = true;
    reconnectingRef.current = true;
    setStatus("loading");
    setError(RECONNECTING_MSG);

    // Tear down lingering refs so initAvatar's guard clears.
    resolvedRef.current = false;
    initializingRef.current = false;
    callRef.current = null;
    conversationIdRef.current = null;

    void (async () => {
      const ok = (await reinitRef.current?.(lastPersonaIdRef.current)) ?? false;
      reconnectingRef.current = false;
      if (!ok) {
        setStatus("error");
        setError(RECONNECT_FAILED_MSG);
      }
    })();
  }, []);

  const initAvatar = useCallback(async (personaId?: string): Promise<boolean> => {
    if (initializingRef.current || callRef.current) return false;
    initializingRef.current = true;
    resolvedRef.current = false;
    lastPersonaIdRef.current = personaId;
    setStatus("loading");
    setError(null);

    try {
      // 1. Create conversation via our server
      const res = await fetch("/api/demo/tavus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(personaId ? { persona_id: personaId } : {}),
      });
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
          // Try on any track, not just video — audio arriving means the replica is live
          tryExtractStream();
        };

        const handleParticipantUpdated = (event: DailyEventObjectParticipant) => {
          if (!event.participant || event.participant.local) return;
          // No log here: Daily fires this per audio-level update (many times per
          // second) and devtools cannot keep up — the tab freezes.
          if (resolvedRef.current) return;
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
        // Audio Echo: stopped_speaking includes our inference_id, so we
        // can ignore stale events from earlier utterances. Text echo
        // (no tracking) keeps the legacy string-match behaviour.
        call.on("app-message", (evt) => {
          const data = evt?.data;
          if (!data) return;
          const eventType: string = data.event_type ?? data.type ?? "";
          // Diagnostic: warn-level so Next dev forwards each line to
          // the terminal as a [browser] log. Lets us see exactly what
          // Tavus dispatches during a session without opening DevTools.
          if (eventType.startsWith("conversation.")) {
            console.warn(
              "[tavus] event:",
              eventType,
              "inference_id=" + (data?.properties?.inference_id ?? data?.inference_id ?? "?")
            );
          }
          const isSpeechEnd =
            eventType.includes("utterance_end") ||
            eventType.includes("echo_end") ||
            eventType.includes("response_end") ||
            eventType.includes("stopped_speaking");
          if (!isSpeechEnd) return;

          console.log("[tavus] Speech end detected via:", eventType);
          setStatus((prev) => (prev === "speaking" ? "ready" : prev));
          if (echoResolveRef.current) {
            echoResolveRef.current();
            echoResolveRef.current = null;
          }
        });

        call.on("left-meeting", () => {
          console.warn("[tavus] left-meeting");
          clearTimeout(timeout);
          setMediaStream(null);
          callRef.current = null;
          if (resolvedRef.current) {
            // We had a working session — try to reconnect once.
            tryReconnect();
          } else {
            setStatus("idle");
            resolve(false);
          }
        });

        // The Tavus replica can leave the call if its session expires
        // server-side. Treat as a disconnect and try to recover.
        call.on("participant-left", (evt) => {
          if (evt?.participant?.local) return;
          console.warn("[tavus] participant-left (replica)");
          if (resolvedRef.current) tryReconnect();
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
  }, [tryReconnect]);

  // Bridge for tryReconnect — assigning here avoids a circular closure
  // with initAvatar's listener registration.
  useEffect(() => {
    reinitRef.current = initAvatar;
  }, [initAvatar]);

  /**
   * Send text for the replica to speak. The persona is configured with
   * `pipeline_mode: "echo"` and a server-side ElevenLabs TTS layer
   * (see docs/TAVUS-PERSONA-SETUP.md), so Tavus runs the user-supplied
   * text through ElevenLabs in our cloned voice and the replica
   * lip-syncs to the result. We don't need to bypass Tavus's TTS layer
   * with Audio Echo — the persona's TTS layer already uses the voice
   * we picked.
   *
   * Resolves when Tavus fires `conversation.replica.stopped_speaking`,
   * or the per-utterance fallback timeout fires.
   */
  const echo = useCallback((text: string): Promise<void> => {
    const call = callRef.current;
    if (!call) {
      console.warn("Tavus: No active call for echo");
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      // Fallback timer — ~55ms/char + 1s budget. Safety net for the
      // case where stopped_speaking doesn't arrive (network blip,
      // replica drop).
      const fallbackMs = Math.max(3000, text.length * 55 + 1000);
      const fallback = setTimeout(() => {
        console.warn("[tavus] echo fallback timeout fired after", fallbackMs, "ms");
        echoFallbackRef.current = null;
        setStatus((prev) => (prev === "speaking" ? "ready" : prev));
        echoResolveRef.current = null;
        resolve();
      }, fallbackMs);
      echoFallbackRef.current = fallback;

      echoResolveRef.current = () => {
        clearTimeout(fallback);
        echoFallbackRef.current = null;
        resolve();
      };

      try {
        setStatus("speaking");
        const convId = conversationIdRef.current;
        // Schema per Tavus Interactions Protocol → Echo Interaction.
        // pipeline_mode: "echo" is required on the persona. See
        // docs/TAVUS-PERSONA-SETUP.md.
        call.sendAppMessage(
          {
            message_type: "conversation",
            event_type: "conversation.echo",
            ...(convId && { conversation_id: convId }),
            properties: { modality: "text", text },
          },
          "*"
        );
      } catch (err) {
        clearTimeout(fallback);
        echoFallbackRef.current = null;
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
    const convId = conversationIdRef.current;

    try {
      call.sendAppMessage(
        {
          message_type: "conversation",
          event_type: "conversation.interrupt",
          ...(convId && { conversation_id: convId }),
        },
        "*"
      );
      setStatus("ready");
    } catch {
      // Best-effort
    }
  }, []);

  const stopAvatar = useCallback(async () => {
    if (echoFallbackRef.current) {
      clearTimeout(echoFallbackRef.current);
      echoFallbackRef.current = null;
    }
    echoResolveRef.current = null;

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
      endConversation(convId);
      conversationIdRef.current = null;
    }

    // User-initiated stop is the explicit "fresh slate" signal — clear
    // the one-shot reconnect guard so the next initAvatar() session
    // gets its own reconnect budget. Don't reset in initAvatar itself,
    // which would clobber the guard during tryReconnect's chained init.
    reconnectAttemptedRef.current = false;
  }, []);

  // Cleanup on unmount + on tab close. The unmount path covers React
  // navigations; `pagehide` is the only event that fires reliably across
  // browsers on tab close / hard navigation, including BFCache transitions.
  // `keepalive: true` lets the DELETE survive the page tear-down — the
  // plain fetch the unmount path used to dispatch was being aborted on
  // unload, which leaked Tavus conversations (= billing).
  useEffect(() => {
    const onPageHide = () => {
      const convId = conversationIdRef.current;
      if (convId) {
        endConversation(convId);
        conversationIdRef.current = null;
      }
    };
    window.addEventListener("pagehide", onPageHide);

    return () => {
      window.removeEventListener("pagehide", onPageHide);
      if (echoFallbackRef.current) {
        clearTimeout(echoFallbackRef.current);
        echoFallbackRef.current = null;
      }
      echoResolveRef.current = null;
      const call = callRef.current;
      if (call) {
        call.leave().catch(() => {});
        call.destroy().catch(() => {});
        callRef.current = null;
      }
      const convId = conversationIdRef.current;
      if (convId) {
        endConversation(convId);
        conversationIdRef.current = null;
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
