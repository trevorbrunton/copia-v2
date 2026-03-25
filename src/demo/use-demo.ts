"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@11labs/react";
import { FALLBACK_MESSAGE } from "./config";
import { classifyQuestion, PREGENERATED } from "./classifier";
import { useAvatar } from "./use-avatar";
import type { ChatMessage, DemoStatus } from "./types";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";
const AVATAR_ENABLED = !!process.env.NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID;

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
 * Fetch a PCM file and return as base64 string.
 * PCM files are pre-generated ElevenLabs audio at 24kHz 16-bit mono.
 */
async function fetchPcmAsBase64(pcmUrl: string): Promise<string> {
  const res = await fetch(pcmUrl);
  if (!res.ok) throw new Error(`Failed to fetch PCM: ${res.status}`);
  const buffer = await res.arrayBuffer();
  // Convert to base64 string
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Call our TTS API to convert text to PCM base64 (for unknown questions).
 */
async function textToPcmBase64(text: string): Promise<string> {
  const res = await fetch("/api/demo/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`TTS API failed: ${res.status}`);
  const body = await res.json();
  return body.audio;
}

export function useDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [isPlayingCached, setIsPlayingCached] = useState(false);
  const isConnectingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Cache PCM base64 so we don't re-fetch on repeated questions
  const pcmCacheRef = useRef<Record<string, string>>({});

  // Avatar hook — always called (hook order stability)
  const avatar = useAvatar();

  const conversation = useConversation({
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
      if (message.source === "ai") {
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", message.message),
        ]);
        setIsProcessing(false);
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

  // Play a pre-generated MP3 audio file (fallback when no avatar)
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

  /**
   * Send pre-generated PCM to the avatar for lip-sync.
   * Fetches the PCM file, base64 encodes it, and calls avatar.speakAudio().
   * Caches the base64 so repeated questions are instant.
   */
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

  // Must be called from a user gesture to satisfy browser autoplay policy
  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setError(null);

    try {
      let avatarReady = false;

      // Start avatar if configured — waits until stream is ready
      if (AVATAR_ENABLED) {
        avatarReady = await avatar.initAvatar();
        if (!avatarReady) {
          console.warn("Avatar failed to connect — running in audio-only mode");
        }
      }

      // Play greeting
      const greeting = PREGENERATED.greeting;
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", greeting.text),
      ]);

      if (avatarReady) {
        // Avatar is connected — pipe PCM audio for lip-sync
        await playPcmOnAvatar(greeting.pcmUrl).catch(() => {
          // Fallback to browser audio if PCM pipe fails
          playCachedAudio(greeting.audioUrl).catch(() => {});
        });
      } else {
        playCachedAudio(greeting.audioUrl).catch(() => {});
      }

      // Connect ElevenLabs agent when:
      // - Audio-only mode (no avatar configured), OR
      // - Avatar was configured but failed to connect (fallback)
      // Don't connect when avatar is active — LiveKit conflicts.
      if (AGENT_ID && (!AVATAR_ENABLED || !avatarReady)) {
        await conversation.startSession({
          agentId: AGENT_ID,
          connectionType: "webrtc",
        });
        conversation.setVolume({ volume: 1 });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg);
    } finally {
      isConnectingRef.current = false;
    }
  }, [conversation, playCachedAudio, playPcmOnAvatar, avatar]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;

      setMessages((prev) => [...prev, createMessage("user", trimmed)]);
      setIsProcessing(true);
      setError(null);

      // Try to classify and use pre-generated response
      const category = classifyQuestion(trimmed);

      if (category) {
        const cached = PREGENERATED[category];
        if (cached) {
          // Instant response — no agent round-trip
          setMessages((prev) => [
            ...prev,
            createMessage("assistant", cached.text),
          ]);
          setIsProcessing(false);

          if (AVATAR_ENABLED && avatar.status === "ready") {
            // Pipe pre-generated PCM to avatar for lip-sync (ElevenLabs voice)
            try {
              await playPcmOnAvatar(cached.pcmUrl);
            } catch {
              // Fall back to browser audio
              await playCachedAudio(cached.audioUrl).catch(() => {});
            }
          } else {
            // No avatar — play cached MP3 via browser
            if (conversation.status === "connected") {
              conversation.setVolume({ volume: 0 });
            }
            try {
              await playCachedAudio(cached.audioUrl);
            } catch {
              // Text is already shown
            }
            if (conversation.status === "connected") {
              conversation.setVolume({ volume: AVATAR_ENABLED ? 0 : 1 });
            }
          }
          return;
        }
      }

      // No match — fall back to live ElevenLabs agent
      // The agent's response arrives via onMessage callback,
      // which calls textToPcmBase64() → avatar.speakAudio() automatically
      if (conversation.status !== "connected") {
        // Agent not connected — use fallback
        const fb = PREGENERATED.fallback;
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", fb.text),
        ]);
        setIsProcessing(false);

        if (AVATAR_ENABLED && avatar.status === "ready") {
          await playPcmOnAvatar(fb.pcmUrl).catch(() => {});
        } else {
          await playCachedAudio(fb.audioUrl).catch(() => {});
        }
        return;
      }

      try {
        conversation.sendUserMessage(trimmed);
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong";
        setError(msg);
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", FALLBACK_MESSAGE),
        ]);
        setIsProcessing(false);
      }
    },
    [conversation, playCachedAudio, playPcmOnAvatar, avatar]
  );

  const demoStatus: DemoStatus = isProcessing
    ? "processing"
    : isPlayingCached || conversation.isSpeaking || avatar.status === "speaking"
      ? "speaking"
      : "ready";

  return {
    status: demoStatus,
    messages,
    error: error || avatar.error,
    sendMessage,
    connect,
    isConnected: isConnected || avatar.status === "ready",
    avatarStream: avatar.mediaStream,
  };
}
