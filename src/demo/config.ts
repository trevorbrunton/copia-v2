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

export const VOICEFLOW_CONFIG = {
  baseUrl: "https://general-runtime.voiceflow.com",
  versionAlias: "production",
} as const;

export const ELEVENLABS_CONFIG = {
  baseUrl: "https://api.elevenlabs.io/v1",
  modelId: "eleven_multilingual_v2",
  outputFormat: "mp3_44100_128",
} as const;

export const HEYGEN_CONFIG = {
  baseUrl: "https://api.heygen.com/v1",
  quality: "medium",
} as const;

export const FALLBACK_MESSAGE =
  "That's a great question — I'd suggest speaking directly with our investor relations team for more detail on that.";
