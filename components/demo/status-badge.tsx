"use client";

import { Mic, Loader2, CircleDot } from "lucide-react";
import type { DemoStatus } from "@/src/demo/types";

interface StatusBadgeProps {
  status: DemoStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  if (status === "initialising") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1.5 text-xs font-medium text-violet-400 animate-pulse">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Initialising
      </span>
    );
  }

  if (status === "ready") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-white/20 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/60">
        <CircleDot className="h-3.5 w-3.5" />
        Ready
      </span>
    );
  }

  if (status === "listening") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-medium text-emerald-400 animate-pulse">
        <Mic className="h-3.5 w-3.5" />
        Listening
      </span>
    );
  }

  if (status === "processing") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-xs font-medium text-amber-400 animate-pulse">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Thinking
      </span>
    );
  }

  if (status === "speaking") {
    return (
      <span className="flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-400/10 px-3 py-1.5 text-xs font-medium text-sky-400">
        <span className="flex items-center gap-0.5">
          <span className="h-3 w-0.5 rounded-full bg-sky-400 animate-[pulse_0.8s_ease-in-out_infinite]" />
          <span className="h-4 w-0.5 rounded-full bg-sky-400 animate-[pulse_0.8s_ease-in-out_infinite_0.15s]" />
          <span className="h-2.5 w-0.5 rounded-full bg-sky-400 animate-[pulse_0.8s_ease-in-out_infinite_0.3s]" />
          <span className="h-3.5 w-0.5 rounded-full bg-sky-400 animate-[pulse_0.8s_ease-in-out_infinite_0.45s]" />
        </span>
        Speaking
      </span>
    );
  }

  return null;
}
