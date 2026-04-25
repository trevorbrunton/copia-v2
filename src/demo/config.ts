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
 * "tavus" — Tavus CVI with local voice pipeline (VAD → STT → matcher → echo lip-sync)
 * "haiku" — ElevenLabs STT → Anthropic Haiku matcher → pre-recorded video/audio
 */
const AVATAR_MODE = process.env.NEXT_PUBLIC_AVATAR_MODE ?? "haiku";
export const USE_TAVUS_AVATAR = AVATAR_MODE === "tavus";
export const USE_HAIKU_MODE = AVATAR_MODE === "haiku";
