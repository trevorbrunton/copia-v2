"use client";

import type { Stage } from "@/src/screen/funnel";
import { Check, Circle } from "lucide-react";

/**
 * Vertical funnel rail. Each completed `Stage` is a filled dot with
 * label + count. The optional `pending` list shows the upcoming filters
 * for the active preset as hollow dots so the user sees the runway.
 */
interface FunnelRailProps {
  stages: Stage[];
  pending?: { id: string; label: string }[];
  className?: string;
}

export function FunnelRail({ stages, pending = [], className }: FunnelRailProps) {
  return (
    <ol className={className ?? "flex flex-col gap-2 text-sm text-white"}>
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1] : null;
        const dropped = prev ? prev.count - s.count : 0;
        return (
          <li key={`${s.id}-${i}`} className="flex items-center gap-3">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40">
              <Check className="h-3 w-3" />
            </span>
            <span className="flex-1 truncate text-white/85">{s.label}</span>
            <span className="text-xs tabular-nums text-white/60">
              {s.count.toLocaleString()}
              {dropped > 0 ? (
                <span className="ml-1.5 text-white/40">
                  (−{dropped.toLocaleString()})
                </span>
              ) : null}
            </span>
          </li>
        );
      })}
      {pending.map((p) => (
        <li
          key={`pending-${p.id}`}
          className="flex items-center gap-3 text-white/40"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-white/15">
            <Circle className="h-2.5 w-2.5" />
          </span>
          <span className="flex-1 truncate">{p.label}</span>
        </li>
      ))}
    </ol>
  );
}
