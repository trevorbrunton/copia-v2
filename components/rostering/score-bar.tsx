"use client";

import { cn } from "@/src/lib/utils";

export function ScoreBar({
  score,
  className,
}: {
  score: number;
  className?: string;
}) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? "bg-green-500" :
    pct >= 60 ? "bg-yellow-500" :
    pct >= 40 ? "bg-orange-500" :
    "bg-red-500";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-muted-foreground w-8 text-right">{pct}%</span>
    </div>
  );
}
