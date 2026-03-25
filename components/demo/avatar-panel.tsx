"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import type { DemoStatus } from "@/src/demo/types";

interface AvatarPanelProps {
  status: DemoStatus;
  /** LiveAvatar media stream (live mode) */
  mediaStream?: MediaStream | null;
  /** Current MP4 video source — null means show idle loop */
  videoSrc?: string | null;
  /** Idle video to loop between responses */
  idleVideoSrc?: string;
  /** Called when a response video finishes playing */
  onVideoEnded?: () => void;
}

/**
 * Two-layer video panel that eliminates flicker on transitions.
 *
 * Layer 1 (back):  Idle video loops continuously, always loaded.
 * Layer 2 (front): Response video plays on top, hidden when not active.
 *
 * When a response arrives, the response video loads and plays over the idle loop.
 * When it ends, it hides — revealing the idle loop still running underneath.
 * No src-swapping on a single element = no flicker.
 */
export function AvatarPanel({
  status,
  mediaStream,
  videoSrc,
  idleVideoSrc = "/video/idle.mp4",
  onVideoEnded,
}: AvatarPanelProps) {
  const idleRef = useRef<HTMLVideoElement>(null);
  const responseRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<HTMLVideoElement>(null);
  const [showResponse, setShowResponse] = useState(false);

  // Handle live media stream (HeyGen LiveAvatar or Tavus CVI via Daily.co)
  useEffect(() => {
    if (streamRef.current && mediaStream) {
      streamRef.current.srcObject = mediaStream;
      streamRef.current.muted = false;
    }
  }, [mediaStream]);

  // Start idle loop on mount
  useEffect(() => {
    const idle = idleRef.current;
    if (!idle || mediaStream) return;
    idle.src = idleVideoSrc;
    idle.loop = true;
    idle.muted = true;
    idle.load();
    idle.play().catch(() => {});
  }, [idleVideoSrc, mediaStream]);

  // When videoSrc changes, load and play the response video on top
  useEffect(() => {
    const response = responseRef.current;
    if (!response || mediaStream) return;

    if (videoSrc) {
      response.src = videoSrc;
      response.muted = false;
      response.load();
      response.play()
        .then(() => setShowResponse(true))
        .catch((err) => {
          console.warn("Response video play blocked:", err);
          onVideoEnded?.();
        });
    }
  }, [videoSrc, mediaStream, onVideoEnded]);

  const handleResponseEnded = useCallback(() => {
    setShowResponse(false);
    // Clear src so the response element doesn't hold a stale last-frame
    const response = responseRef.current;
    if (response) {
      response.removeAttribute("src");
      response.load();
    }
    onVideoEnded?.();
  }, [onVideoEnded]);

  const handleResponseError = useCallback(() => {
    setShowResponse(false);
    onVideoEnded?.();
  }, [onVideoEnded]);

  // Live stream mode — single video element
  if (mediaStream) {
    return (
      <div className="relative flex flex-col items-center justify-center rounded-2xl bg-[var(--oc-dark)] aspect-video w-full overflow-hidden">
        <video
          ref={streamRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-contain bg-[var(--oc-dark)]"
        />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col items-center justify-center rounded-2xl bg-[var(--oc-dark)] aspect-video w-full overflow-hidden">
      {/* Layer 1: Idle loop — always running underneath */}
      <video
        ref={idleRef}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-contain bg-[var(--oc-dark)]"
      />
      {/* Layer 2: Response video — plays on top, hidden when inactive */}
      <video
        ref={responseRef}
        playsInline
        onEnded={handleResponseEnded}
        onError={handleResponseError}
        className={`absolute inset-0 w-full h-full object-contain bg-[var(--oc-dark)] transition-opacity duration-150 ${
          showResponse ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
    </div>
  );
}
