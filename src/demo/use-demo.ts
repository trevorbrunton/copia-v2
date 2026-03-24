"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@11labs/react";
import { FALLBACK_MESSAGE } from "./config";
import { classifyQuestion, PREGENERATED } from "./classifier";
import type { ChatMessage, DemoStatus } from "./types";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

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
  const [isConnected, setIsConnected] = useState(false);
  const [isPlayingCached, setIsPlayingCached] = useState(false);
  const isConnectingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

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

  // Cleanup audio on unmount
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

  // Play a pre-generated audio file
  const playCachedAudio = useCallback((audioUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      // Stop any currently playing audio
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

  // Must be called from a user gesture to satisfy browser autoplay policy
  const connect = useCallback(async () => {
    if (isConnectingRef.current || conversation.status === "connected") return;

    if (!AGENT_ID) {
      setError("NEXT_PUBLIC_ELEVENLABS_AGENT_ID is not configured");
      return;
    }

    isConnectingRef.current = true;
    setError(null);

    try {
      // Play greeting immediately from cache
      const greeting = PREGENERATED.greeting;
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", greeting.text),
      ]);
      playCachedAudio(greeting.audioUrl).catch(() => {});

      // Connect to ElevenLabs in background for fallback
      await conversation.startSession({
        agentId: AGENT_ID,
        connectionType: "webrtc",
      });
      conversation.setVolume({ volume: 1 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg);
    } finally {
      isConnectingRef.current = false;
    }
  }, [conversation, playCachedAudio]);

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

          // Mute live agent while playing cached audio
          if (conversation.status === "connected") {
            conversation.setVolume({ volume: 0 });
          }

          try {
            await playCachedAudio(cached.audioUrl);
          } catch {
            // Audio failed — text is already shown, so not critical
          }

          // Restore live agent volume
          if (conversation.status === "connected") {
            conversation.setVolume({ volume: 1 });
          }
          return;
        }
      }

      // No match — fall back to live ElevenLabs agent
      if (conversation.status !== "connected") {
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", FALLBACK_MESSAGE),
        ]);
        setIsProcessing(false);
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
    [conversation, playCachedAudio]
  );

  const demoStatus: DemoStatus = isProcessing
    ? "processing"
    : isPlayingCached || conversation.isSpeaking
      ? "speaking"
      : "ready";

  return {
    status: demoStatus,
    messages,
    error,
    sendMessage,
    connect,
    isConnected,
  };
}
