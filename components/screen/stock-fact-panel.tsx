"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { SourceBadge } from "./source-badge";
import type { StockFact } from "@/src/screen/market-data-provider";

interface StockFactPanelProps {
  ticker: string;
  onClose: () => void;
}

const formatBn = (n: number | undefined) =>
  n === undefined ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : `$${(n / 1e6).toFixed(0)}M`;
const formatPrice = (n: number | undefined) =>
  n === undefined ? "—" : n >= 100 ? `$${n.toFixed(2)}` : `$${n.toFixed(2)}`;

/**
 * Component is intentionally stateless about which ticker is being shown:
 * the parent supplies `key={ticker}` so a new ticker re-mounts the panel
 * with fresh state. This keeps the fetch effect free of leading
 * setState calls (caught by React Compiler).
 */
export function StockFactPanel({ ticker, onClose }: StockFactPanelProps) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ok"; fact: StockFact | null }
    | { kind: "error"; message: string }
  >({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/v1/screen/stock-fact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `stock-fact failed: ${res.status}`);
        }
        return res.json() as Promise<{ fact: StockFact | null }>;
      })
      .then((body) => {
        if (cancelled) return;
        setState({ kind: "ok", fact: body.fact });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setState({ kind: "error", message: e instanceof Error ? e.message : "Failed to load" });
      });

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  const isLoading = state.kind === "loading";
  const error = state.kind === "error" ? state.message : null;
  const fact = state.kind === "ok" ? state.fact : null;

  return (
    <div className="border-t border-white/10 bg-[var(--oc-navy)]/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {isLoading ? (
            <p className="text-sm text-white/50">Loading {ticker}…</p>
          ) : error ? (
            <p className="text-sm text-red-300">{error}</p>
          ) : fact === null ? (
            <p className="text-sm text-white/60">
              <span className="font-mono text-white">{ticker}</span> isn&apos;t in the snapshot.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-base font-semibold text-white">{fact.ticker}</span>
                <span className="truncate text-sm text-white/70" title={fact.companyName}>
                  {fact.companyName}
                </span>
              </div>
              {/* Sector + sub-industry badges. Both pulled from the
                  enriched top-500 projection — stocks outside that
                  projection won't have them, so render conditionally. */}
              {(fact.sector || fact.gicsSubIndustry) ? (
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {fact.sector ? (
                    <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-200 ring-1 ring-sky-400/25">
                      {fact.sector}
                    </span>
                  ) : null}
                  {fact.gicsSubIndustry ? (
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] text-white/70 ring-1 ring-white/10">
                      {fact.gicsSubIndustry}
                    </span>
                  ) : null}
                </div>
              ) : null}
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-white/40">Share price</dt>
                  <dd className="tabular-nums text-white/85">{formatPrice(fact.sharePrice)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Market cap</dt>
                  <dd className="tabular-nums text-white/85">{formatBn(fact.marketCap)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-white/40">Earnings status</dt>
                  <dd className="text-white/85">{fact.earningsStatus ?? "—"}</dd>
                </div>
              </dl>
              {/* Plain-English company description from the enriched
                  feed. Capped at ~4 lines via line-clamp so the panel
                  doesn't push the rest of the page off-screen — full
                  text remains in the title attribute on hover for the
                  curious. */}
              {fact.longBusinessSummary ? (
                <p
                  title={fact.longBusinessSummary}
                  className="mt-2 line-clamp-4 text-xs leading-relaxed text-white/65"
                >
                  {fact.longBusinessSummary}
                </p>
              ) : null}
              <div className="mt-3 flex items-center gap-2">
                <SourceBadge
                  snapshot={{ date: fact.snapshotDate, collectedAt: fact.fetchedAt }}
                />
                <span className="text-[11px] text-white/40">
                  as of {new Date(fact.fetchedAt).toLocaleString()}
                </span>
              </div>
            </>
          )}
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-md p-1 text-white/40 hover:bg-white/5 hover:text-white/80"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
