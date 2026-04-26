"use client";

import type { FilterId, Stage } from "@/src/screen/funnel";
import { Check, Circle, MessageSquare } from "lucide-react";

/**
 * Vertical funnel rail. Each completed `Stage` is a filled dot with
 * label + count. The optional `pending` list shows the upcoming filters
 * for the active preset as hollow dots so the user sees the runway.
 *
 * `intro` (optional) renders an Introduction step at the top of the
 * rail — a brief Pep-spoken framing of the active preset before the
 * universe stage. Distinct icon (speech bubble) so it doesn't read as
 * a filter outcome.
 *
 * `onPendingClick` makes pending items clickable so the user can run
 * filters out of sequence (e.g. skip ahead to Q4 directly). When
 * omitted, pending items are static <li>. Disabled-state guarding
 * (e.g. while a filter is in flight) is the parent's responsibility
 * via `pendingDisabled`.
 */
interface FunnelRailProps {
  stages: Stage[];
  pending?: { id: FilterId; label: string }[];
  intro?: { label: string; spoken: boolean };
  /**
   * When `intro` is supplied, the FIRST stage in `stages` is the
   * Universe baseline (the snapshot before any filter). Pass
   * `universeSpoken` so the rail can render it as pending (hollow
   * circle, dim) until Pep finishes the universe narration — then
   * checked once spoken. Defaults to `true` (legacy behavior).
   */
  universeSpoken?: boolean;
  /** Click handler for a pending filter — enables out-of-order runs. */
  onPendingClick?: (filterId: FilterId) => void;
  /** Disable pending click targets (e.g. during apply-in-flight). */
  pendingDisabled?: boolean;
  className?: string;
}

export function FunnelRail({
  stages,
  pending = [],
  intro,
  universeSpoken = true,
  onPendingClick,
  pendingDisabled = false,
  className,
}: FunnelRailProps) {
  return (
    <ol className={className ?? "flex flex-col gap-2 text-sm text-white"}>
      {intro ? (
        <li
          className={`flex items-center gap-3 ${
            intro.spoken ? "" : "text-white/40"
          }`}
        >
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              intro.spoken
                ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-400/40"
                : "ring-1 ring-white/15"
            }`}
          >
            <MessageSquare className="h-3 w-3" />
          </span>
          <span
            className={`flex-1 truncate ${intro.spoken ? "text-white/85" : ""}`}
          >
            {intro.label}
          </span>
        </li>
      ) : null}
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1] : null;
        const dropped = prev ? prev.count - s.count : 0;
        // First stage is the Universe — gate its visual state on the
        // universeSpoken flag so it doesn't read as "completed"
        // before Pep has actually spoken the line.
        const isPendingUniverse = i === 0 && intro != null && !universeSpoken;
        return (
          <li
            key={`${s.id}-${i}`}
            className={`flex items-center gap-3 ${isPendingUniverse ? "text-white/40" : ""}`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                isPendingUniverse
                  ? "ring-1 ring-white/15"
                  : "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
              }`}
            >
              {isPendingUniverse ? (
                <Circle className="h-2.5 w-2.5" />
              ) : (
                <Check className="h-3 w-3" />
              )}
            </span>
            <span className={`flex-1 truncate ${isPendingUniverse ? "" : "text-white/85"}`}>
              {s.label}
            </span>
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
      {pending.map((p) => {
        const content = (
          <>
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-white/15 group-hover:ring-white/30">
              <Circle className="h-2.5 w-2.5" />
            </span>
            <span className="flex-1 truncate text-left">{p.label}</span>
          </>
        );
        return (
          <li key={`pending-${p.id}`}>
            {onPendingClick ? (
              <button
                type="button"
                onClick={() => onPendingClick(p.id)}
                disabled={pendingDisabled}
                className="group flex w-full items-center gap-3 rounded text-white/40 transition hover:text-white/85 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-white/40"
                title="Run this filter (out of sequence)"
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-3 text-white/40">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
