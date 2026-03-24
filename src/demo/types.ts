/**
 * Types for the OC Mid-Cap Fund investor demo.
 *
 * Architecture: User question → Voiceflow (RAG) → ElevenLabs (TTS) → HeyGen (avatar)
 */

// --- Voiceflow (RAG / Chat Agent) ---

export type VoiceflowMessage =
  | { type: "text"; payload: { message: string } }
  | { type: "visual"; payload: { slate: { content: unknown[] } } }
  | { type: "end"; payload: Record<string, never> };

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

// --- ElevenLabs (Text-to-Speech) ---

export interface TTSRequest {
  text: string;
  voiceId?: string;
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
  | "initialising"
  | "ready"
  | "listening"
  | "processing"
  | "speaking"
  | "error";

export interface DemoState {
  status: DemoStatus;
  messages: ChatMessage[];
  error: string | null;
}
