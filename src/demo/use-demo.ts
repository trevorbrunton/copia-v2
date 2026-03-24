"use client";

import { useCallback, useReducer, useRef } from "react";
import { apiFetch } from "@/src/lib/api-client";
import { FALLBACK_MESSAGE } from "./config";
import type { ChatMessage, DemoStatus } from "./types";

interface DemoState {
  status: DemoStatus;
  messages: ChatMessage[];
  error: string | null;
}

type DemoAction =
  | { type: "send"; message: string }
  | { type: "reply"; content: string }
  | { type: "error"; message: string }
  | { type: "set_status"; status: DemoStatus };

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

function reducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "send":
      return {
        ...state,
        status: "processing",
        messages: [...state.messages, createMessage("user", action.message)],
        error: null,
      };
    case "reply":
      return {
        ...state,
        status: "ready",
        error: null,
        messages: [
          ...state.messages,
          createMessage("assistant", action.content),
        ],
      };
    case "error":
      return { ...state, status: "ready", error: action.message };
    case "set_status":
      return { ...state, status: action.status };
  }
}

const initialState: DemoState = {
  status: "ready",
  messages: [],
  error: null,
};

export function useDemo() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const sessionIdRef = useRef<string>(crypto.randomUUID());

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    dispatch({ type: "send", message: trimmed });

    try {
      const res = await apiFetch("/api/demo/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sessionId: sessionIdRef.current,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Request failed: ${res.status}`);
      }

      const { reply } = await res.json();
      dispatch({ type: "reply", content: reply || FALLBACK_MESSAGE });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Something went wrong";
      dispatch({ type: "error", message });
      // Show fallback as the assistant reply so the conversation can continue
      dispatch({ type: "reply", content: FALLBACK_MESSAGE });
    }
  }, []);

  return {
    ...state,
    sendMessage,
  };
}
