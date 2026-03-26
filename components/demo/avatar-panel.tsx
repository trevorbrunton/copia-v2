"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { Loader2 } from "lucide-react";
import type { DemoStatus } from "@/src/demo/types";

interface AvatarPanelProps {
  status: DemoStatus;
  /** Whether the demo session is connected */
  isConnected: boolean;
  /** Tavus media stream (tavus mode) */
  mediaStream?: MediaStream | null;
  /** LiveAvatar attach function (live mode) — SDK manages tracks internally */
  attachAvatar?: (element: HTMLVideoElement) => void;
  /** True once the LiveAvatar session is ready for attach */
  avatarReady?: boolean;
  /** True when a live stream is expected (tavus/live modes) — suppresses idle video */
  expectsStream?: boolean;
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
  isConnected,
  mediaStream,
  attachAvatar,
  avatarReady = false,
  expectsStream = false,
  videoSrc,
  idleVideoSrc = "/video/idle.mp4",
  onVideoEnded,
}: AvatarPanelProps) {
  const idleRef = useRef<HTMLVideoElement>(null);
  const responseRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<HTMLVideoElement>(null);
  const liveAvatarRef = useRef<HTMLVideoElement>(null);
  const attachedRef = useRef(false);
  const [showResponse, setShowResponse] = useState(false);

  // Handle Tavus media stream
  useEffect(() => {
    if (streamRef.current && mediaStream) {
      streamRef.current.srcObject = mediaStream;
      streamRef.current.muted = false;
    }
  }, [mediaStream]);

  // Handle LiveAvatar attach — SDK manages its own tracks via session.attach()
  useEffect(() => {
    if (liveAvatarRef.current && attachAvatar && avatarReady && !attachedRef.current) {
      attachAvatar(liveAvatarRef.current);
      attachedRef.current = true;
    }
  }, [attachAvatar, avatarReady]);

  // Start idle loop on mount
  useEffect(() => {
    const idle = idleRef.current;
    if (!idle || mediaStream || expectsStream) return;
    idle.src = idleVideoSrc;
    idle.loop = true;
    idle.muted = true;
    idle.load();
    idle.play().catch(() => {});
  }, [idleVideoSrc, mediaStream, expectsStream]);

  // When videoSrc changes, load and play the response video on top
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

  // LiveAvatar mode — SDK attaches tracks directly to the <video> element
  if (attachAvatar) {
    return (
      <div className="relative flex flex-col items-center justify-center rounded-2xl bg-[var(--oc-dark)] aspect-video w-full overflow-hidden">
        {!isConnected ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <p className="text-sm text-white/50">Please press the Start Conversation button</p>
          </div>
        ) : !avatarReady && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <Loader2 className="h-8 w-8 text-white/40 animate-spin" />
            <p className="text-sm text-white/40">Connecting avatar...</p>
          </div>
        )}
        <video
          ref={liveAvatarRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-contain bg-[var(--oc-dark)]"
        />
      </div>
    );
  }

  // Tavus stream mode — srcObject from Daily.co WebRTC
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
