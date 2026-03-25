"use client";

import { useEffect, useRef } from "react";
import { Volume2 } from "lucide-react";
import type { DemoStatus } from "@/src/demo/types";
import { PERSONA } from "@/src/demo/config";

const STATUS_LABELS: Record<DemoStatus, string> = {
  initialising: "Starting up…",
  ready: "Ready",
  listening: "Listening…",
  processing: "Thinking…",
  speaking: "Speaking…",
  error: "Unavailable",
};

interface AvatarPanelProps {
  status: DemoStatus;
  mediaStream?: MediaStream | null;
}

export function AvatarPanel({ status, mediaStream }: AvatarPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && mediaStream) {
      videoRef.current.srcObject = mediaStream;
    }
  }, [mediaStream]);

  const hasVideo = !!mediaStream;

  return (
    <div className="relative flex flex-col items-center justify-center rounded-2xl bg-[var(--oc-dark)] aspect-video w-full overflow-hidden">
      {hasVideo ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : (
        <div className="flex flex-col items-center justify-center">
          <div className="relative flex h-32 w-32 items-center justify-center rounded-full bg-[var(--oc-navy)] border-2 border-white/20 overflow-hidden">
            <span className="text-4xl font-bold text-white/30">RF</span>
            {status === "speaking" && (
              <div className="absolute inset-0 rounded-full border-2 border-white/40 animate-ping" />
            )}
          </div>
          <p className="mt-4 text-white font-medium">{PERSONA.name}</p>
          <p className="text-white/60 text-sm">{PERSONA.title}</p>
          {status === "speaking" && (
            <div className="mt-2 flex items-center gap-1.5 text-white/50 text-xs">
              <Volume2 className="h-3.5 w-3.5" />
              <span>Speaking…</span>
            </div>
          )}
        </div>
      )}

      {/* Status indicator */}
      <div className="absolute bottom-4 left-4 flex items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${
            status === "processing" || status === "speaking"
              ? "bg-amber-400 animate-pulse"
              : status === "error"
                ? "bg-red-400"
                : "bg-emerald-400"
          }`}
        />
        <span className="text-xs text-white/60">
          {STATUS_LABELS[status]}
        </span>
      </div>
    </div>
  );
}
