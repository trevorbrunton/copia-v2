"use client";

import { useEffect, useRef, useCallback } from "react";
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

export function AvatarPanel({
  status,
  mediaStream,
  videoSrc,
  idleVideoSrc = "/video/idle.mp4",
  onVideoEnded,
}: AvatarPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Pending response video — waits for current idle loop to finish before playing
  const pendingVideoRef = useRef<string | null>(null);
  const isPlayingResponseRef = useRef(false);

  // Handle live media stream (HeyGen LiveAvatar or Tavus CVI via Daily.co)
  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
      // Unmute so the avatar's audio plays through
      videoRef.current.muted = false;
    }
  }, [mediaStream]);

  const playResponse = useCallback((src: string) => {
    const video = videoRef.current;
    if (!video) return;
    isPlayingResponseRef.current = true;
    pendingVideoRef.current = null;
    video.loop = false;
    video.muted = false;
    video.src = src;
    video.load();
    video.play().catch((err) => {
      console.warn("Response video play blocked:", err);
      isPlayingResponseRef.current = false;
      onVideoEnded?.();
    });
  }, [onVideoEnded]);

  const switchToIdle = useCallback((video: HTMLVideoElement) => {
    isPlayingResponseRef.current = false;
    video.loop = true;
    video.muted = true;
    video.src = idleVideoSrc;
    video.load();
    video.play().catch(() => {});
  }, [idleVideoSrc]);

  // When videoSrc changes, either queue it (if idle is playing) or switch to idle
  useEffect(() => {
    const video = videoRef.current;
    if (!video || mediaStream) return;

    if (videoSrc) {
      if (isPlayingResponseRef.current) {
        // Already playing a response — queue the new one
        pendingVideoRef.current = videoSrc;
      } else {
        // Idle is looping — queue and let it finish the current loop.
        // The onEnded handler will pick it up.
        pendingVideoRef.current = videoSrc;
        // Stop looping so the current iteration ends naturally
        video.loop = false;
      }
    } else if (!isPlayingResponseRef.current && video.src !== new URL(idleVideoSrc, location.href).href) {
      // No videoSrc and not playing a response — ensure idle is running
      switchToIdle(video);
    }
  }, [videoSrc, idleVideoSrc, mediaStream, switchToIdle]);

  // Start idle on mount
  useEffect(() => {
    const video = videoRef.current;
    if (!video || mediaStream) return;
    switchToIdle(video);
  }, [idleVideoSrc, mediaStream, switchToIdle]);

  const handleVideoEnded = useCallback(() => {
    const video = videoRef.current;

    if (isPlayingResponseRef.current) {
      // Response video finished — notify caller, then check for pending or go idle
      isPlayingResponseRef.current = false;
      onVideoEnded?.();

      if (pendingVideoRef.current) {
        playResponse(pendingVideoRef.current);
      } else if (video) {
        switchToIdle(video);
      }
      return;
    }

    // Idle loop iteration ended — check if a response video is queued
    if (pendingVideoRef.current) {
      playResponse(pendingVideoRef.current);
    } else if (video) {
      // No pending video — restart idle loop
      switchToIdle(video);
    }
  }, [onVideoEnded, playResponse, switchToIdle]);

  const handleVideoError = useCallback(() => {
    if (isPlayingResponseRef.current) {
      isPlayingResponseRef.current = false;
      pendingVideoRef.current = null;
      onVideoEnded?.();
    }
    const video = videoRef.current;
    if (video) {
      switchToIdle(video);
    }
  }, [onVideoEnded, switchToIdle]);

  return (
    <div className="relative flex flex-col items-center justify-center rounded-2xl bg-[var(--oc-dark)] aspect-video w-full overflow-hidden">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        onEnded={handleVideoEnded}
        onError={handleVideoError}
        className="absolute inset-0 w-full h-full object-contain bg-[var(--oc-dark)]"
      />
    </div>
  );
}
