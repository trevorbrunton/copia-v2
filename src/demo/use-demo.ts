"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@11labs/react";
import {
  USE_VIDEO_AVATAR,
  USE_LIVE_AVATAR,
  USE_TAVUS_AVATAR,
} from "./config";
import { PREGENERATED } from "./classifier";
import { useAvatar } from "./use-avatar";
import { useTavusAvatar } from "./use-tavus-avatar";
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

/**
 * Fetch a PCM file and return as base64 string (for LiveAvatar mode).
 */
async function fetchPcmAsBase64(pcmUrl: string): Promise<string> {
  const res = await fetch(pcmUrl);
  if (!res.ok) throw new Error(`Failed to fetch PCM: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function useDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isPlayingCached, setIsPlayingCached] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentVideoSrc, setCurrentVideoSrc] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(true);
  const isConnectingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcmCacheRef = useRef<Record<string, string>>({});

  // When true, the system is playing a response — ignore all agent messages.
  const busyRef = useRef(false);
  // Timestamp when busy ended — messages are dropped for a grace period after this.
  const busyEndedAtRef = useRef(0);
  // Resolves when a video finishes playing (set by playResponse, called by handleVideoEnded).
  const videoEndedResolveRef = useRef<(() => void) | null>(null);

  // Avatar hooks — always called for hook order stability
  const avatar = useAvatar();
  const tavusAvatar = useTavusAvatar();

  const conversation = useConversation({
    micMuted,
    onConnect: () => {
      setIsConnected(true);
    },
    onDisconnect: () => {
      setIsConnected(false);
    },
    onError: (err: string | Error) => {
      const msg = typeof err === "string" ? err : err.message;
      setError(msg);
      setIsProcessing(false);
    },
    onMessage: (message: { source: string; message: string }) => {
      // Drop all messages while a response is playing, and for a grace period
      // after playback ends (to drain any queued agent messages).
      if (busyRef.current) return;
      if (busyEndedAtRef.current > 0 && Date.now() - busyEndedAtRef.current < 3000) return;

      if (message.source === "user") {
        // ElevenLabs transcribed the user's speech — show in chat
        setMessages((prev) => [...prev, createMessage("user", message.message)]);
        setIsProcessing(true);
      }

      if (message.source === "ai") {
        // Check for a category tag from the agent
        const parsed = parseCategoryTag(message.message);
        const cached = parsed ? PREGENERATED[parsed.category] : null;

        if (cached) {
          // Agent classified into a known category — use pre-generated response.
          // Mute mic + agent output so it doesn't hear/speak during playback.
          busyRef.current = true;
          setMicMuted(true);
          conversation.setVolume({ volume: 0 });
          setMessages((prev) => [
            ...prev,
            createMessage("assistant", cached.text),
          ]);
          setIsProcessing(false);
          playResponseRef.current(cached).finally(() => {
            busyRef.current = false;
            busyEndedAtRef.current = Date.now();
            setMicMuted(false);
            conversation.setVolume({ volume: 1 });
            // Tell the agent we just finished speaking — resets its idle timer
            // so it doesn't immediately prompt "are you still there?"
            conversation.sendContextualUpdate(
              "You just finished answering. Wait silently for the user's next question. Do not prompt or ask if they are still there."
            );
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (conversation.status === "connected") {
        conversation.endSession().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Play a pre-generated MP3 audio file (audio-only fallback)
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

  // Send pre-generated PCM to LiveAvatar for lip-sync
  const playPcmOnAvatar = useCallback(
    async (pcmUrl: string) => {
      let base64 = pcmCacheRef.current[pcmUrl];
      if (!base64) {
        base64 = await fetchPcmAsBase64(pcmUrl);
        pcmCacheRef.current[pcmUrl] = base64;
      }
      avatar.speakAudio(base64);
    },
    [avatar]
  );

  // Send text to Tavus avatar for lip-synced speech (echo mode)
  const playTextOnTavus = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve) => {
        tavusAvatar.echo(text);
        // Estimate duration from text length (~60ms per character)
        const estimatedDuration = Math.max(3000, text.length * 60);
        setTimeout(resolve, estimatedDuration);
      });
    },
    [tavusAvatar]
  );

  /**
   * Play a response — dispatches to the correct mode.
   *
   * Video mode flow:
   *   1. Check if a video file exists for this response
   *   2. If yes → play video (unmuted — audio is embedded in the MP4)
   *   3. If no  → play MP3 audio while idle video keeps looping
   *
   * Returns a promise that resolves when playback is complete.
   */
  const playResponse = useCallback(
    async (cached: { audioUrl: string; pcmUrl: string; videoUrl: string; text: string }) => {
      if (USE_VIDEO_AVATAR) {
        // Check if a pre-generated video exists for this response
        let hasVideo = false;
        try {
          const headRes = await fetch(cached.videoUrl, { method: "HEAD" });
          const contentType = headRes.headers.get("content-type") ?? "";
          hasVideo = headRes.ok && contentType.startsWith("video/");
        } catch {
          // Network error — no video available
        }

        if (hasVideo) {
          // Play the response video (with embedded audio) — idle stops
          await new Promise<void>((resolve) => {
            videoEndedResolveRef.current = resolve;
            setCurrentVideoSrc(cached.videoUrl);
          });
        } else {
          // No video — play MP3 audio while idle video keeps looping
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else if (USE_TAVUS_AVATAR && tavusAvatar.status === "ready") {
        // Tavus CVI — send text via echo mode for lip-synced speech
        try {
          await playTextOnTavus(cached.text);
        } catch {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else if (USE_LIVE_AVATAR && avatar.status === "ready") {
        try {
          await playPcmOnAvatar(cached.pcmUrl);
        } catch {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else {
        // Audio-only mode — mute agent TTS, play our MP3
        if (conversation.status === "connected") {
          conversation.setVolume({ volume: 0 });
        }
        try {
          await playCachedAudio(cached.audioUrl);
        } catch {
          // Text already shown
        }
        if (conversation.status === "connected") {
          conversation.setVolume({ volume: 1 });
        }
      }
    },
    [avatar, tavusAvatar, conversation, playCachedAudio, playPcmOnAvatar, playTextOnTavus]
  );

  // Stable ref for playResponse so onMessage callback can access latest version
  const playResponseRef = useRef(playResponse);
  playResponseRef.current = playResponse;

  // Called by avatar panel when a response video finishes
  const handleVideoEnded = useCallback(() => {
    setCurrentVideoSrc(null);
    setIsPlayingCached(false);
    if (videoEndedResolveRef.current) {
      videoEndedResolveRef.current();
      videoEndedResolveRef.current = null;
    }
  }, []);

  // Must be called from a user gesture to satisfy browser autoplay policy.
  // Starts greeting immediately, connects ElevenLabs agent in parallel.
  // Mic stays muted until greeting finishes.
  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setError(null);
    setHasStarted(true);
    busyRef.current = true;
    setMicMuted(true);

    try {
      if (USE_TAVUS_AVATAR) {
        const avatarReady = await tavusAvatar.initAvatar();
        if (!avatarReady) {
          console.warn("Tavus avatar failed to connect — running in audio-only mode");
        }
      } else if (USE_LIVE_AVATAR) {
        const avatarReady = await avatar.initAvatar();
        if (!avatarReady) {
          console.warn("Avatar failed to connect — running in audio-only mode");
        }
      }

      // Start greeting and agent connection in parallel.
      // Greeting plays immediately; agent connects in background.
      const greeting = PREGENERATED.greeting;
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", greeting.text),
      ]);

      const greetingPromise = playResponse(greeting);

      const agentPromise = AGENT_ID
        ? conversation.startSession({
            agentId: AGENT_ID,
            connectionType: "webrtc",
          }).then(() => {
            // Mute agent output during greeting
            conversation.setVolume({ volume: 0 });
          }).catch((err) => {
            console.warn("Agent connection failed:", err);
          })
        : Promise.resolve();

      // Wait for both greeting and agent to be ready
      await Promise.all([greetingPromise, agentPromise]);

      // Greeting done, agent connected — unmute and start listening.
      busyRef.current = false;
      busyEndedAtRef.current = Date.now();
      setMicMuted(false);
      if (conversation.status === "connected") {
        conversation.setVolume({ volume: 1 });
        conversation.sendContextualUpdate(
          "You just greeted the user. Wait silently for their first question. Do not prompt or ask if they are still there."
        );
      }
      if (conversation.status === "connected") {
        conversation.setVolume({ volume: 1 });
      }
    } catch (err) {
      busyRef.current = false;
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg);
    } finally {
      isConnectingRef.current = false;
    }
  }, [conversation, playResponse, avatar, tavusAvatar]);

  const demoStatus: DemoStatus = isProcessing
    ? "processing"
    : isPlayingCached ||
        currentVideoSrc !== null ||
        avatar.status === "speaking" ||
        tavusAvatar.status === "speaking"
      ? "speaking"
      : "ready";

  return {
    status: demoStatus,
    messages,
    error: error || avatar.error || tavusAvatar.error,
    connect,
    isConnected: hasStarted,
    avatarStream: USE_TAVUS_AVATAR
      ? tavusAvatar.mediaStream
      : avatar.mediaStream,
    currentVideoSrc,
    handleVideoEnded,
  };
}
