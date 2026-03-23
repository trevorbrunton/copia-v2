"use client";

export interface DeviceInfo {
  fingerprint: string;
  deviceName: string;
  deviceType: "desktop" | "mobile" | "tablet";
  os: string;
  browser: string;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(36);
}

function parseUserAgent(ua: string): {
  browser: string;
  os: string;
  deviceType: "desktop" | "mobile" | "tablet";
} {
  let browser = "Unknown";
  if (ua.includes("Firefox/")) browser = "Firefox";
  else if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("OPR/") || ua.includes("Opera/")) browser = "Opera";
  else if (ua.includes("Chrome/")) browser = "Chrome";
  else if (ua.includes("Safari/")) browser = "Safari";

  let os = "Unknown";
  if (ua.includes("Windows")) os = "Windows";
  else if (ua.includes("Mac OS X") || ua.includes("Macintosh")) os = "macOS";
  else if (ua.includes("Linux")) os = "Linux";
  else if (ua.includes("Android")) os = "Android";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS";
  else if (ua.includes("CrOS")) os = "ChromeOS";

  let deviceType: "desktop" | "mobile" | "tablet" = "desktop";
  if (ua.includes("iPad") || ua.includes("Tablet") || (ua.includes("Android") && !ua.includes("Mobile"))) {
    deviceType = "tablet";
  } else if (ua.includes("Mobile") || ua.includes("iPhone") || ua.includes("Android")) {
    deviceType = "mobile";
  }

  return { browser, os, deviceType };
}

export function detectDevice(): DeviceInfo {
  if (typeof window === "undefined") {
    return {
      fingerprint: "ssr",
      deviceName: "Unknown",
      deviceType: "desktop",
      os: "Unknown",
      browser: "Unknown",
    };
  }

  const ua = navigator.userAgent;
  const { browser, os, deviceType } = parseUserAgent(ua);

  const parts = [
    ua,
    `${screen.width}x${screen.height}`,
    navigator.platform || "",
    Intl.DateTimeFormat().resolvedOptions().timeZone || "",
  ];
  const fingerprint = simpleHash(parts.join("|"));

  const deviceName = `${browser} on ${os}`;

  return { fingerprint, deviceName, deviceType, os, browser };
}
