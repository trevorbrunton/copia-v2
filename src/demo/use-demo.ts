"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@11labs/react";
import { FALLBACK_MESSAGE } from "./config";
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
  const isConnectingRef = useRef(false);

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

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (conversation.status === "connected") {
        conversation.endSession().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Must be called from a user gesture (click) to satisfy browser autoplay policy
  const connect = useCallback(async () => {
    if (isConnectingRef.current || conversation.status === "connected") return;

    if (!AGENT_ID) {
      setError("NEXT_PUBLIC_ELEVENLABS_AGENT_ID is not configured");
      return;
    }

    isConnectingRef.current = true;
    setError(null);

    try {
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
  }, [conversation]);

  const sendMessage = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || conversation.status !== "connected") return;

      setMessages((prev) => [...prev, createMessage("user", trimmed)]);
      setIsProcessing(true);
      setError(null);

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
    [conversation]
  );

  const demoStatus: DemoStatus = isProcessing
    ? "processing"
    : conversation.isSpeaking
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
