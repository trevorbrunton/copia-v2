"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@11labs/react";
import {
  USE_VIDEO_AVATAR,
  USE_LIVE_AVATAR,
  USE_TAVUS_AVATAR,
  USE_HAIKU_MODE,
  USE_LOCAL_PIPELINE,
} from "./config";
import { PREGENERATED } from "./classifier";
import { useAvatar } from "./use-avatar";
import { useTavusAvatar } from "./use-tavus-avatar";
import { useVoiceListener } from "./use-voice-listener";
import type { ChatMessage, DemoStatus } from "./types";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

/** Parse a `[category_name]` tag from an agent response, ignoring any prefix. */
function parseCategoryTag(text: string): { category: string; rest: string } | null {
  const match = text.match(/\[(\w+)\]\s*/);
  if (!match) return null;
  return { category: match[1], rest: text.slice(match.index! + match[0].length) };
}

function createMessage(
  role: "user" | "assistant",
  content: string
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  };
}

export function useDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingCached, setIsPlayingCached] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isInitialising, setIsInitialising] = useState(false);
  const [currentVideoSrc, setCurrentVideoSrc] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(true);
  const isConnectingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // PCM base64 cache for LiveAvatar mode. Bounded by the fixed set of
  // demo_responses categories (~30 entries, ~15MB max). Acceptable for a demo.
  const pcmCacheRef = useRef<Record<string, string>>({});

  // Epoch counter — incremented each time busy mode starts.
  const epochRef = useRef(0);
  const messageEpochRef = useRef(0);

  // When true, the system is playing a response — ignore all input.
  // busyRef for synchronous checks in callbacks; isBusy for reactive UI (status badge).
  const busyRef = useRef(false);
  const [isBusy, setIsBusy] = useState(false);
  const setBusy = useCallback((val: boolean) => {
    busyRef.current = val;
    setIsBusy(val);
  }, []);
  // Resolves when a video finishes playing.
  const videoEndedResolveRef = useRef<(() => void) | null>(null);
  // Ref to track ElevenLabs agent connection status.
  const isConnectedRef = useRef(false);

  // Avatar hooks — always called for hook order stability
  const avatar = useAvatar();
  const tavusAvatar = useTavusAvatar();

  // Track avatar readiness via ref — React state may not have flushed
  // when playResponse runs immediately after initAvatar resolves.
  const avatarReadyRef = useRef(false);

  // ─── Local pipeline: continuous voice listener (haiku + live) ─────

  // Ref for voiceListener controls — avoids stale closure in handleUtterance
  const voiceListenerRef = useRef<{ pause: () => void; resume: () => void }>({
    pause: () => {},
    resume: () => {},
  });

  /**
   * Called by the voice listener when the user finishes an utterance (haiku + live modes).
   * Transcribes via ElevenLabs STT → matches via Bedrock Haiku → plays response.
   */
  const handleUtterance = useCallback(
    async (pcm: ArrayBuffer, sampleRate: number) => {
      if (busyRef.current) return;

      // Pause listener immediately to prevent overlapping utterances
      setBusy(true);
      voiceListenerRef.current.pause();
      setIsProcessing(true);

      try {
        // Transcribe + match in a single server round-trip
        const formData = new FormData();
        formData.append(
          "audio",
          new Blob([pcm], { type: "application/octet-stream" }),
        );
        formData.append("sampleRate", String(sampleRate));

        const processRes = await fetch("/api/v1/demo/process", {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(45_000),
        });

        if (!processRes.ok) {
          throw new Error(`Process error: ${processRes.status}`);
        }

        const result: {
          text: string;
          category?: string;
          answerText?: string;
          audioUrl?: string;
          pcmUrl?: string;
          videoUrl?: string;
        } = await processRes.json();

        if (!result.text) {
          // No speech detected — resume listening
          setIsProcessing(false);
          setBusy(false);
          voiceListenerRef.current.resume();
          return;
        }

        // Show user's transcribed speech in chat
        setMessages((prev) => [...prev, createMessage("user", result.text)]);

        const cached = {
          audioUrl: result.audioUrl ?? "",
          pcmUrl: result.pcmUrl ?? "",
          videoUrl: result.videoUrl ?? "",
          text: result.answerText ?? "",
        };

        // Show response text in chat
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", cached.text),
        ]);
        setIsProcessing(false);

        // Step 3: Play matched video/audio, then resume listening
        await playResponseRef.current(cached);
        setBusy(false);
        voiceListenerRef.current.resume();
      } catch (err) {
        setIsProcessing(false);
        setBusy(false);
        voiceListenerRef.current.resume();
        setError(
          err instanceof Error ? err.message : "Failed to process question",
        );
      }
    },
    [setBusy],
  );

  const voiceListener = useVoiceListener({ onUtterance: handleUtterance });
  voiceListenerRef.current = voiceListener;

  // ─── ElevenLabs agent (only for modes not using the local pipeline) ──

  const conversation = useConversation({
    micMuted,
    onConnect: () => {
      isConnectedRef.current = true;
    },
    onDisconnect: () => {
      isConnectedRef.current = false;
    },
    onError: (err: string | Error) => {
      if (USE_LOCAL_PIPELINE) return;
      const msg = typeof err === "string" ? err : err.message;
      setError(msg);
      setIsProcessing(false);
    },
    onMessage: (message: { source: string; message: string }) => {
      if (USE_LOCAL_PIPELINE) return;
      if (busyRef.current) return;

      if (messageEpochRef.current !== epochRef.current) {
        messageEpochRef.current = epochRef.current;
        return;
      }

      if (message.source === "user") {
        setMessages((prev) => [...prev, createMessage("user", message.message)]);
        setIsProcessing(true);
      }

      if (message.source === "ai") {
        const parsed = parseCategoryTag(message.message);
        const cached = parsed ? PREGENERATED[parsed.category] : null;

        if (cached) {
          busyRef.current = true;
          epochRef.current += 1;
          setMicMuted(true);
          conversation.setVolume({ volume: 0 });
          setMessages((prev) => [
            ...prev,
            createMessage("assistant", cached.text),
          ]);
          setIsProcessing(false);
          playResponseRef.current(cached).finally(() => {
            busyRef.current = false;
            messageEpochRef.current = epochRef.current;
            setMicMuted(false);
              conversation.setVolume({ volume: 1 });
            try {
              conversation.sendContextualUpdate(
                "You just finished answering. Wait silently for the user's next question. Do not prompt or ask if they are still there."
              );
            } catch {
              // Safe to ignore
            }
          });
        } else {
          // No category match — show agent's own response text
          setMessages((prev) => [
            ...prev,
            createMessage("assistant", message.message),
          ]);
          setIsProcessing(false);
        }
      }
    },
  });

  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (USE_LOCAL_PIPELINE) {
        voiceListener.stop();
      } else if (isConnectedRef.current) {
        conversationRef.current.endSession().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Playback helpers ─────────────────────────────────────────────

  const playCachedAudio = useCallback((audioUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        setIsPlayingCached(false);
        audioRef.current = null;
        resolve();
      };
      audio.onerror = () => {
        setIsPlayingCached(false);
        audioRef.current = null;
        reject(new Error("Audio playback failed"));
      };
      setIsPlayingCached(true);
      audio.play().catch(reject);
    });
  }, []);

  const playPcmOnLiveAvatar = useCallback(
    async (pcmUrl: string): Promise<void> => {
      // Fetch pre-recorded PCM (24kHz 16-bit mono) from CloudFront, base64 encode, send to avatar
      let base64 = pcmCacheRef.current[pcmUrl];
      if (!base64) {
        const res = await fetch(pcmUrl);
        if (!res.ok) throw new Error(`Failed to fetch PCM: ${res.status}`);
        const buffer = await res.arrayBuffer();
        base64 = btoa(
          new Uint8Array(buffer).reduce((s, b) => s + String.fromCharCode(b), "")
        );
        pcmCacheRef.current[pcmUrl] = base64;
      }
      // speakAudio returns a promise that resolves on agent.speak_ended
      await avatar.speakAudio(base64);
    },
    [avatar]
  );

  const playTextOnTavus = useCallback(
    (text: string): Promise<void> => {
      return tavusAvatar.echo(text);
    },
    [tavusAvatar]
  );

  const playResponse = useCallback(
    async (cached: { audioUrl: string; pcmUrl: string; videoUrl: string; text: string }) => {
      console.log("[demo:playResponse] Routing decision:", {
        USE_VIDEO_AVATAR, USE_HAIKU_MODE, USE_TAVUS_AVATAR, USE_LIVE_AVATAR,
        avatarReady: avatarReadyRef.current,
        hasVideoUrl: !!cached.videoUrl,
        hasPcmUrl: !!cached.pcmUrl,
        hasAudioUrl: !!cached.audioUrl,
      });
      // Haiku plays pre-recorded video; live sends PCM to avatar (handled below)
      if (USE_VIDEO_AVATAR || USE_HAIKU_MODE) {
        let hasVideo = false;
        try {
          const headRes = await fetch(cached.videoUrl, { method: "HEAD" });
          const contentType = headRes.headers.get("content-type") ?? "";
          hasVideo = headRes.ok && contentType.startsWith("video/");
        } catch {
          // No video available
        }

        if (hasVideo) {
          await new Promise<void>((resolve) => {
            videoEndedResolveRef.current = resolve;
            setCurrentVideoSrc(cached.videoUrl);
          });
        } else {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else if (USE_TAVUS_AVATAR && avatarReadyRef.current) {
        try {
          await playTextOnTavus(cached.text);
        } catch {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else if (USE_LIVE_AVATAR && avatarReadyRef.current) {
        try {
          await playPcmOnLiveAvatar(cached.pcmUrl);
        } catch {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else {
        const conv = conversationRef.current;
        if (isConnectedRef.current) conv.setVolume({ volume: 0 });
        try {
          await playCachedAudio(cached.audioUrl);
        } catch {
          // Text already shown
        }
        if (isConnectedRef.current) conv.setVolume({ volume: 1 });
      }
    },
    [playCachedAudio, playPcmOnLiveAvatar, playTextOnTavus]
  );

  const playResponseRef = useRef(playResponse);
  playResponseRef.current = playResponse;


  const handleVideoEnded = useCallback(() => {
    setCurrentVideoSrc(null);
    setIsPlayingCached(false);
    if (videoEndedResolveRef.current) {
      videoEndedResolveRef.current();
      videoEndedResolveRef.current = null;
    }
  }, []);

  // ─── Connect ──────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setError(null);
    setHasStarted(true);
    setBusy(true);
    epochRef.current += 1;
    setMicMuted(true);

    try {
      console.log("[demo:connect] Mode flags:", {
        USE_LIVE_AVATAR, USE_TAVUS_AVATAR, USE_VIDEO_AVATAR,
        USE_HAIKU_MODE, USE_LOCAL_PIPELINE,
      });

      // Init avatar renderers before greeting so playResponse routes correctly.
      setIsInitialising(true);
      if (USE_TAVUS_AVATAR) {
        avatarReadyRef.current = await tavusAvatar.initAvatar();
        console.log("[demo:connect] Tavus initAvatar result:", avatarReadyRef.current);
        if (!avatarReadyRef.current) {
          console.warn("Tavus avatar failed to connect — running in audio-only mode");
        }
      } else if (USE_LIVE_AVATAR) {
        console.log("[demo:connect] Calling avatar.initAvatar()...");
        avatarReadyRef.current = await avatar.initAvatar();
        console.log("[demo:connect] LiveAvatar initAvatar result:", avatarReadyRef.current);
        if (!avatarReadyRef.current) {
          console.warn("Avatar failed to connect — running in audio-only mode");
        }
      } else {
        console.log("[demo:connect] No live avatar mode — skipping avatar init");
      }
      setIsInitialising(false);

      // Yield to let React flush state and trigger useEffects that wire
      // audio/video to the <video> element — otherwise the greeting plays
      // before tracks are connected and audio is inaudible.
      if ((USE_LIVE_AVATAR || USE_TAVUS_AVATAR) && avatarReadyRef.current) {
        await new Promise((r) => setTimeout(r, 200));
      }

      // Play greeting (avatar is ready at this point, so routing is correct)
      const greeting = PREGENERATED.greeting;
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", greeting.text),
      ]);

      const greetingPromise = playResponse(greeting);

      // Local pipeline modes use voice listener; others use ElevenLabs agent
      const setupPromise = USE_LOCAL_PIPELINE
        ? Promise.resolve()
        : (AGENT_ID
          ? conversation.startSession({
              agentId: AGENT_ID,
              connectionType: "webrtc",
            }).then(() => {
              conversation.setVolume({ volume: 0 });
            }).catch((err) => {
              console.warn("Agent connection failed:", err);
            })
          : Promise.resolve());

      await Promise.all([greetingPromise, setupPromise]);

      // Greeting done — ready for interaction
      setBusy(false);
      messageEpochRef.current = epochRef.current;

      if (USE_LOCAL_PIPELINE) {
        // Start continuous voice listener (haiku, live, tavus modes)
        await voiceListener.start();
      } else {
        setMicMuted(false);
        if (isConnectedRef.current) {
          conversation.setVolume({ volume: 1 });
          try {
            conversation.sendContextualUpdate(
              "You just greeted the user. Wait silently for their first question. Do not prompt or ask if they are still there."
            );
          } catch {
            // Safe to ignore
          }
        }
      }
    } catch (err) {
      setBusy(false);
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg);
    } finally {
      isConnectingRef.current = false;
    }
  }, [conversation, playResponse, avatar, tavusAvatar, voiceListener, setBusy]);

  // ─── Disconnect ──────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    // Stop audio playback
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    // Stop voice listener (local pipeline)
    if (USE_LOCAL_PIPELINE) {
      voiceListener.stop();
    }

    // End ElevenLabs agent session
    if (!USE_LOCAL_PIPELINE && isConnectedRef.current) {
      try {
        await conversation.endSession();
      } catch {
        // Safe to ignore
      }
    }

    // Stop avatars
    if (USE_LIVE_AVATAR && avatarReadyRef.current) {
      avatar.stopAvatar().catch(() => {});
      avatarReadyRef.current = false;
    }

    // Reset state
    setCurrentVideoSrc(null);
    setIsPlayingCached(false);
    setIsProcessing(false);
    setIsInitialising(false);
    setBusy(false);
    setMicMuted(true);
    setHasStarted(false);
    setMessages([]);
    setError(null);
    isConnectingRef.current = false;
  }, [conversation, voiceListener, avatar, tavusAvatar, setBusy]);

  // ─── Status ───────────────────────────────────────────────────────

  // isBusy is included in the "speaking" check to prevent a brief "Ready"
  // flash during the microtask gap between playback ending and setBusy(false).
  // isProcessing is checked first, so isBusy during the transcribe/match phase
  // correctly shows "processing" rather than "speaking".
  const demoStatus: DemoStatus = isInitialising
    ? "initialising"
    : isProcessing
    ? "processing"
    : isPlayingCached ||
        currentVideoSrc !== null ||
        avatar.status === "speaking" ||
        tavusAvatar.status === "speaking" ||
        isBusy
      ? "speaking"
      : voiceListener.isListening
        ? "listening"
        : "ready";

  return {
    status: demoStatus,
    messages,
    error: error || avatar.error || tavusAvatar.error,
    connect,
    disconnect,
    isConnected: hasStarted,
    avatarStream: USE_TAVUS_AVATAR
      ? tavusAvatar.mediaStream
      : null,
    /** Attach LiveAvatar session to a <video> element (live mode only) */
    attachAvatar: avatar.attach,
    avatarReady: avatar.isReady,
    currentVideoSrc,
    handleVideoEnded,
    // Local pipeline (haiku + live) — expose listening/speaking state for UI
    isListening: voiceListener.isListening,
    isSpeaking: voiceListener.isSpeaking,
  };
}
