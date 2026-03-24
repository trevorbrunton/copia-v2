"use client";

import { User } from "lucide-react";
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
}

export function AvatarPanel({ status }: AvatarPanelProps) {
  return (
    <div className="relative flex flex-col items-center justify-center rounded-2xl bg-[var(--oc-dark)] aspect-video w-full overflow-hidden">
      {/* Placeholder — replaced with HeyGen stream when connected */}
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-[var(--oc-navy)] border-2 border-white/20">
        <User className="h-12 w-12 text-white/60" />
      </div>
      <p className="mt-4 text-white font-medium">{PERSONA.name}</p>
      <p className="text-white/60 text-sm">{PERSONA.title}</p>

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
