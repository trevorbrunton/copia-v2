"use client";

import type { SnapshotMeta } from "@/src/screen/types";

/**
 * Snapshot-staleness banner per plan §8a:
 *   ≤ 7 days  → no banner
 *   8–30 days → yellow banner
 *   > 30 days → red banner
 *
 * `now` is overridable for deterministic tests / dev-stub scenarios.
 */
interface StalenessBannerProps {
  snapshot: Pick<SnapshotMeta, "collectedAt">;
  now?: Date;
}

const MS_PER_DAY = 86_400_000;

export function StalenessBanner({ snapshot, now = new Date() }: StalenessBannerProps) {
  const collectedMs = new Date(snapshot.collectedAt).getTime();
  // If collectedAt is invalid (NaN) we can't reason about age — render
  // nothing rather than emit "Snapshot is NaN days old".
  if (!Number.isFinite(collectedMs)) return null;

  const ageDays = Math.max(0, Math.floor((now.getTime() - collectedMs) / MS_PER_DAY));
  if (ageDays <= 7) return null;

  const isRed = ageDays > 30;
  return (
    <div
      role="status"
      className={
        isRed
          ? "border-b border-red-400/30 bg-red-500/10 px-4 py-2 text-xs text-red-200"
          : "border-b border-amber-400/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-100"
      }
    >
      Snapshot is {ageDays} days old
      {isRed ? " — values may be significantly stale." : "."}
    </div>
  );
}
