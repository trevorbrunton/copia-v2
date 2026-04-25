"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Loader2 } from "lucide-react";

interface AvatarPanelProps {
  /** Whether the demo session is connected */
  isConnected: boolean;
  /** Tavus media stream (tavus mode) */
  mediaStream?: MediaStream | null;
  /** True when a live stream is expected (tavus mode) — suppresses idle video */
  expectsStream?: boolean;
  /** Current MP4 video source — null means show idle loop (haiku mode) */
  videoSrc?: string | null;
  /** Idle video to loop between responses */
  idleVideoSrc?: string;
  /** Called when a response video finishes playing */
  onVideoEnded?: () => void;
}

/**
 * Two-layer video panel that eliminates flicker on transitions (haiku mode):
 *   Layer 1 (back):  Idle video loops continuously, always loaded.
 *   Layer 2 (front): Response video plays on top, hidden when not active.
 *
 * Tavus mode renders a single <video> bound to the Daily.co WebRTC stream.
 */
export function AvatarPanel({
  isConnected,
  mediaStream,
  expectsStream = false,
  videoSrc,
  idleVideoSrc = "/video/idle.mp4",
  onVideoEnded,
}: AvatarPanelProps) {
  const idleRef = useRef<HTMLVideoElement>(null);
  const responseRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<HTMLVideoElement>(null);
  const [showResponse, setShowResponse] = useState(false);

  // Tavus media stream — start muted for autoplay policy, then unmute.
  useEffect(() => {
    const video = streamRef.current;
    if (!video || !mediaStream) return;
    video.srcObject = mediaStream;
    video.muted = true;
    video.play()
      .then(() => {
        video.muted = false;
      })
      .catch((err) => {
        console.warn("[avatar-panel] Tavus stream play failed:", err);
      });
  }, [mediaStream]);

  // Start idle loop on mount (haiku mode only).
  useEffect(() => {
    const idle = idleRef.current;
    if (!idle || mediaStream || expectsStream) return;
    idle.src = idleVideoSrc;
    idle.loop = true;
    idle.muted = true;
    idle.load();
    idle.play().catch(() => {});
  }, [idleVideoSrc, mediaStream, expectsStream]);

  // When videoSrc changes, load and play the response video on top.
  useEffect(() => {
    const response = responseRef.current;
    if (!response || mediaStream || expectsStream) return;

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
  }, [videoSrc, mediaStream, expectsStream, onVideoEnded]);

  const handleResponseEnded = useCallback(() => {
    setShowResponse(false);
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

  // Tavus stream mode — srcObject from Daily.co WebRTC.
  if (mediaStream || expectsStream) {
    return (
      <div className="relative flex flex-col items-center justify-center rounded-2xl bg-[var(--oc-dark)] aspect-video w-full overflow-hidden">
        {!isConnected ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <p className="text-sm text-white/50">Please press the Start Conversation button</p>
          </div>
        ) : !mediaStream && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <Loader2 className="h-8 w-8 text-white/40 animate-spin" />
            <p className="text-sm text-white/40">Connecting avatar...</p>
          </div>
        )}
        <video
          ref={streamRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-contain bg-[var(--oc-dark)]"
        />
      </div>
    );
  }

  // Haiku mode — pre-recorded idle/response videos.
  return (
    <div className="relative flex flex-col items-center justify-center rounded-2xl bg-[var(--oc-dark)] aspect-video w-full overflow-hidden">
      <video
        ref={idleRef}
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-contain bg-[var(--oc-dark)]"
      />
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
