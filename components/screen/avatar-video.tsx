"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";

interface AvatarVideoProps {
  mediaStream: MediaStream | null;
  status: "idle" | "loading" | "ready" | "speaking" | "error";
  error: string | null;
  className?: string;
}

/**
 * Tavus avatar video pane for the v2 demo. Mirrors the v1
 * `AvatarPanel` Tavus branch: starts the video muted (autoplay
 * policy), then unmutes after `play()` succeeds.
 */
export function AvatarVideo({ mediaStream, status, error, className }: AvatarVideoProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !mediaStream) return;
    video.srcObject = mediaStream;
    video.muted = true;
    video
      .play()
      .then(() => {
        // Unmute after playback starts — the user's Start-Screening
        // gesture should satisfy the autoplay policy, but only after
        // play() has resolved.
        video.muted = false;
      })
      .catch((err) => {
        console.warn("[avatar-video] play failed:", err);
      });
  }, [mediaStream]);

  return (
    <div
      className={
        className ??
        "relative flex aspect-video items-center justify-center overflow-hidden rounded-2xl bg-[var(--oc-navy)]"
      }
    >
      {!mediaStream ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
          {status === "loading" ? (
            <>
              <Loader2 className="h-8 w-8 text-white/40 animate-spin" />
              <p className="text-xs text-white/40">Connecting Pep…</p>
            </>
          ) : status === "error" ? (
            <p className="text-xs text-red-300/80">{error ?? "Avatar failed to connect."}</p>
          ) : (
            <p className="text-xs text-white/40">Avatar idle</p>
          )}
        </div>
      ) : null}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // object-contain matches v1's AvatarPanel — letterbox the Tavus
        // feed rather than crop Pep's head.
        className="absolute inset-0 h-full w-full object-contain bg-[var(--oc-dark)]"
      />
    </div>
  );
}
