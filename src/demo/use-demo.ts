"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@11labs/react";
import {
  USE_VIDEO_AVATAR,
  USE_LIVE_AVATAR,
} from "./config";
import { PREGENERATED } from "./classifier";
import { useAvatar } from "./use-avatar";
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
 * Uses chunked conversion to avoid O(n²) string concatenation.
 */
async function fetchPcmAsBase64(pcmUrl: string): Promise<string> {
  const res = await fetch(pcmUrl);
  if (!res.ok) throw new Error(`Failed to fetch PCM: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

export function useDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingCached, setIsPlayingCached] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentVideoSrc, setCurrentVideoSrc] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(true);
  const isConnectingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcmCacheRef = useRef<Record<string, string>>({});

  // Epoch counter — incremented each time busy mode starts.
  // Messages are only accepted if their epoch matches the current one,
  // which prevents stale/queued agent messages from leaking through.
  const epochRef = useRef(0);
  const messageEpochRef = useRef(0);

  // When true, the system is playing a response — ignore all agent messages.
  const busyRef = useRef(false);
  // Resolves when a video finishes playing (set by playResponse, called by handleVideoEnded).
  const videoEndedResolveRef = useRef<(() => void) | null>(null);
  // Ref to track connection status — avoids stale closure issues.
  const isConnectedRef = useRef(false);

  // Avatar hook — always called (hook order stability)
  const avatar = useAvatar();

  const conversation = useConversation({
    micMuted,
    onConnect: () => {
      isConnectedRef.current = true;
    },
    onDisconnect: () => {
      isConnectedRef.current = false;
    },
    onError: (err: string | Error) => {
      const msg = typeof err === "string" ? err : err.message;
      setError(msg);
      setIsProcessing(false);
    },
    onMessage: (message: { source: string; message: string }) => {
      // Drop all messages while a response is playing.
      if (busyRef.current) return;

      // Drop messages from a previous epoch (queued during playback).
      if (messageEpochRef.current !== epochRef.current) {
        messageEpochRef.current = epochRef.current;
        return;
      }

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
            // Tell the agent we just finished — resets its idle timer.
            try {
              conversation.sendContextualUpdate(
                "You just finished answering. Wait silently for the user's next question. Do not prompt or ask if they are still there."
              );
            } catch {
              // Connection may have dropped during playback — safe to ignore.
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

  // Keep the ref in sync with SDK connection state.
  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (isConnectedRef.current) {
        conversationRef.current.endSession().catch(() => {});
      }
    };
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
    async (cached: { audioUrl: string; pcmUrl: string; videoUrl: string }) => {
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
      } else if (USE_LIVE_AVATAR && avatar.status === "ready") {
        try {
          await playPcmOnAvatar(cached.pcmUrl);
        } catch {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else {
        // Audio-only mode — mute agent TTS, play our MP3
        const conv = conversationRef.current;
        if (isConnectedRef.current) {
          conv.setVolume({ volume: 0 });
        }
        try {
          await playCachedAudio(cached.audioUrl);
        } catch {
          // Text already shown
        }
        if (isConnectedRef.current) {
          conv.setVolume({ volume: 1 });
        }
      }
    },
    [avatar, playCachedAudio, playPcmOnAvatar]
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
    epochRef.current += 1;
    setMicMuted(true);

    try {
      if (USE_LIVE_AVATAR) {
        const avatarReady = await avatar.initAvatar();
        if (!avatarReady) {
          console.warn("Avatar failed to connect — running in audio-only mode");
        }
      }

      // Start greeting and agent connection in parallel.
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
      messageEpochRef.current = epochRef.current;
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
    } catch (err) {
      busyRef.current = false;
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg);
    } finally {
      isConnectingRef.current = false;
    }
  }, [conversation, playResponse, avatar]);

  const demoStatus: DemoStatus = isProcessing
    ? "processing"
    : isPlayingCached ||
        currentVideoSrc !== null ||
        avatar.status === "speaking"
      ? "speaking"
      : "ready";

  return {
    status: demoStatus,
    messages,
    error: error || avatar.error,
    connect,
    isConnected: hasStarted,
    avatarStream: avatar.mediaStream,
    currentVideoSrc,
    handleVideoEnded,
  };
}
