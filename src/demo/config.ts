/**
 * Configuration constants for the OC Mid-Cap Fund investor demo.
 * Brand colors are defined as CSS custom properties in globals.css (--oc-*).
 */

export const PERSONA = {
  name: "Robert Frost",
  title: "Head of Investments",
  company: "OC Funds Management",
  fundName: "OC Mid-Cap Fund",
} as const;

export const FALLBACK_MESSAGE =
  "That's a great question — I'd suggest speaking directly with our investor relations team for more detail on that.";

/**
 * Avatar mode — controls how the avatar is rendered.
 *
 * "video" — Pre-generated MP4 clips (bulletproof for demos)
 * "live"  — LiveAvatar rendering with local voice pipeline (VAD → STT → Bedrock matcher → PCM lip-sync)
 * "tavus" — Tavus CVI with local voice pipeline (VAD → STT → Bedrock matcher → echo lip-sync)
 * "haiku" — ElevenLabs STT → Bedrock Haiku matcher → pre-recorded video/audio
 * "audio" — Audio-only, no avatar video (placeholder image)
 */
const AVATAR_MODE = process.env.NEXT_PUBLIC_AVATAR_MODE ?? "audio";
export const USE_VIDEO_AVATAR = AVATAR_MODE === "video";
export const USE_LIVE_AVATAR = AVATAR_MODE === "live";
export const USE_TAVUS_AVATAR = AVATAR_MODE === "tavus";
export const USE_HAIKU_MODE = AVATAR_MODE === "haiku";
export const USE_AUDIO_ONLY = AVATAR_MODE === "audio" || !AVATAR_MODE;

/**
 * Modes that use the local voice pipeline (VAD → STT → matcher)
 * instead of the ElevenLabs Conversational AI agent.
 * Only "video" and "audio" modes still use the agent.
 */
export const USE_LOCAL_PIPELINE = USE_HAIKU_MODE || USE_LIVE_AVATAR || USE_TAVUS_AVATAR;

/**
 * Processing pipeline — controls how audio is transcribed and classified.
 *
 * "flash"   — Gemini 2.5 Flash: single API call for STT + classification
 * "default" — ElevenLabs STT + Bedrock Haiku classifier (two-step)
 *
 * Only applies to local pipeline modes (haiku, live, tavus).
 * Set via NEXT_PUBLIC_PROCESSING_MODE env var.
 */
const PROCESSING_MODE = process.env.NEXT_PUBLIC_PROCESSING_MODE ?? "default";
export const USE_GEMINI_FLASH = PROCESSING_MODE === "flash";

// Debug: log resolved avatar mode on load
if (typeof window !== "undefined") {
  console.log("[demo:config] AVATAR_MODE =", JSON.stringify(AVATAR_MODE),
    "| PROCESSING_MODE =", JSON.stringify(PROCESSING_MODE),
    "| USE_LIVE_AVATAR =", USE_LIVE_AVATAR,
    "| USE_LOCAL_PIPELINE =", USE_LOCAL_PIPELINE);
}
