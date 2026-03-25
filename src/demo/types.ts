/**
 * Types for the OC Mid-Cap Fund investor demo.
 *
 * Architecture: User question → ElevenLabs Conversational AI (RAG + TTS) → Avatar (HeyGen or Tavus CVI)
 */

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// --- HeyGen (Streaming Avatar) ---

export type AvatarStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "speaking"
  | "error";

export interface AvatarSession {
  sessionId: string;
  accessToken: string;
  url: string;
}

// --- Demo Page State ---

export type DemoStatus =
  | "ready"
  | "listening"
  | "processing"
  | "speaking";
