"use client";

import type { SnapshotMeta } from "@/src/screen/types";

/**
 * Source-of-truth badge shown alongside any value sourced from the
 * snapshot. v2 is snapshot-only (D3) so the badge always renders
 * `Snapshot {{date}}` — the component is structured so a future live
 * provider can flip the variant without touching consumers.
 */
interface SourceBadgeProps {
  snapshot: Pick<SnapshotMeta, "date" | "collectedAt">;
  variant?: "snapshot"; // future: "live" | "fallback"
  className?: string;
}

export function SourceBadge({ snapshot, variant = "snapshot", className }: SourceBadgeProps) {
  const label =
    variant === "snapshot" ? `Snapshot ${snapshot.date}` : "Live";
  return (
    <span
      title={`Collected ${snapshot.collectedAt}`}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/60 ring-1 ring-white/10"
      }
    >
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      {label}
    </span>
  );
}
