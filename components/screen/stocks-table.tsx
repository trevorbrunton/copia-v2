"use client";

import { useState } from "react";
import type { SecurityDisplay } from "@/src/screen/types";

/**
 * Stocks table for the current funnel stage.
 *
 * - Renders up to `defaultLimit` rows (default 50). A "show all" toggle
 *   reveals the rest if there are more.
 * - Numeric columns right-aligned with tabular-nums; null values render
 *   as an em-dash so missing data is visible.
 * - Sortable by ticker / mcap / net income / turnover (click headers).
 *   Lightweight client-side sort — fine for v2's row counts.
 */

type SortKey = "ticker" | "marketCap" | "netIncomeTtm" | "turnoverRatio";
type SortDir = "asc" | "desc";

function SortHeader({
  k,
  label,
  align,
  activeKey,
  activeDir,
  onToggle,
}: {
  k: SortKey;
  label: string;
  align?: "right";
  activeKey: SortKey;
  activeDir: SortDir;
  onToggle: (k: SortKey) => void;
}) {
  const arrow =
    activeKey === k ? (activeDir === "asc" ? "▲" : "▼") : null;
  return (
    <th
      onClick={() => onToggle(k)}
      className={`cursor-pointer select-none px-3 py-2 text-xs font-medium text-white/60 hover:text-white/85 ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      {label}
      {arrow ? <span className="ml-1 text-white/40">{arrow}</span> : null}
    </th>
  );
}

interface StocksTableProps {
  rows: SecurityDisplay[];
  defaultLimit?: number;
  className?: string;
}

const formatBn = (n: number | null) =>
  n === null ? "—" : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(0)}M` : `$${n.toLocaleString()}`;
const formatPct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const formatBnSigned = (n: number | null) =>
  n === null ? "—" : (n >= 0 ? "" : "−") + formatBn(Math.abs(n));

export function StocksTable({ rows, defaultLimit = 50, className }: StocksTableProps) {
  const [showAll, setShowAll] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const sorted = [...rows].sort((a, b) => {
    const av = sortKey === "ticker" ? a.ticker : (a[sortKey] ?? Number.NEGATIVE_INFINITY);
    const bv = sortKey === "ticker" ? b.ticker : (b[sortKey] ?? Number.NEGATIVE_INFINITY);
    if (av < bv) return sortDir === "asc" ? -1 : 1;
    if (av > bv) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const visible = showAll ? sorted : sorted.slice(0, defaultLimit);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir(k === "ticker" ? "asc" : "desc");
    }
  };

  if (rows.length === 0) {
    return (
      <div className={className ?? "flex h-full items-center justify-center text-sm text-white/40"}>
        No rows in the current stage.
      </div>
    );
  }

  return (
    <div className={className ?? "flex flex-col"}>
      <div className="overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="sticky top-0 bg-[var(--oc-navy)]/95 backdrop-blur">
            <tr className="border-b border-white/10">
              <SortHeader k="ticker" label="Ticker" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
              <th className="px-3 py-2 text-left text-xs font-medium text-white/60">Company</th>
              <SortHeader k="marketCap" label="Mcap" align="right" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
              <SortHeader k="turnoverRatio" label="Turnover" align="right" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
              <SortHeader k="netIncomeTtm" label="Net income (TTM)" align="right" activeKey={sortKey} activeDir={sortDir} onToggle={toggleSort} />
              <th className="px-3 py-2 text-left text-xs font-medium text-white/60">Sector</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.ticker} className="border-b border-white/5 hover:bg-white/5">
                <td className="px-3 py-2 font-mono text-xs text-white">{r.ticker}</td>
                <td className="px-3 py-2 text-white/80 max-w-[18rem] truncate" title={r.companyName}>
                  {r.companyName}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-white/80">{formatBn(r.marketCap)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">{formatPct(r.turnoverRatio)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-white/70">{formatBnSigned(r.netIncomeTtm)}</td>
                <td className="px-3 py-2 text-white/60">{r.sector ?? r.gicsIndustryGroup ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!showAll && rows.length > defaultLimit ? (
        <button
          onClick={() => setShowAll(true)}
          className="border-t border-white/10 px-3 py-2 text-xs text-white/60 hover:bg-white/5"
        >
          Show all {rows.length.toLocaleString()} rows…
        </button>
      ) : null}
    </div>
  );
}
