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
 * "live"  — LiveAvatar streaming SDK (real-time lip-sync via HeyGen)
 * "tavus" — Tavus CVI streaming avatar (real-time lip-sync via Daily.co WebRTC)
 * "audio" — Audio-only, no avatar video (placeholder image)
 */
const AVATAR_MODE = process.env.NEXT_PUBLIC_AVATAR_MODE ?? "audio";
export const USE_VIDEO_AVATAR = AVATAR_MODE === "video";
export const USE_LIVE_AVATAR = AVATAR_MODE === "live";
export const USE_TAVUS_AVATAR = AVATAR_MODE === "tavus";
export const USE_AUDIO_ONLY = AVATAR_MODE === "audio" || !AVATAR_MODE;
