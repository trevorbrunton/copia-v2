"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  STAGE_IDS,
  makeStage,
  type FilterId,
  type Stage,
} from "@/src/screen/funnel";
import type { ApplyFilterResponse, SecurityDisplay, SnapshotMeta, SnapshotResponse } from "@/src/screen/types";

type Status = "idle" | "loading" | "ready" | "applying" | "error";

export type ScreenSession = {
  status: Status;
  error: string | null;
  snapshot: SnapshotMeta | null;
  /** Stages accumulated so far (oldest first). `current` is the last entry. */
  stages: Stage[];
  /** Lookup of every snapshot security by ticker, populated at start. */
  securitiesByTicker: Map<string, SecurityDisplay>;
};

interface UseScreenerReturn extends ScreenSession {
  /** Load the active snapshot and seed the universe stage. Idempotent. */
  start: () => Promise<void>;
  /**
   * Apply one filter to the current stage and append the result.
   * Returns the new stage on success, null on failure (the error is
   * also surfaced via the `error` field for UI consumption).
   */
  applyFilter: (filterId: FilterId) => Promise<Stage | null>;
  /** Reset back to the universe stage (snapshot stays). */
  reset: () => void;
  /** Convenience: SecurityDisplay rows for the current stage's tickers. */
  currentRows: SecurityDisplay[];
}

const SNAPSHOT_URL = "/api/v1/screen/snapshot";
const APPLY_FILTER_URL = "/api/v1/screen/apply-filter";

export function useScreener(): UseScreenerReturn {
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotMeta | null>(null);
  const [stages, setStages] = useState<Stage[]>([]);
  const [securitiesByTicker, setSecuritiesByTicker] = useState<Map<string, SecurityDisplay>>(
    () => new Map()
  );

  // Guard against double-fires (StrictMode dev double-mount, accidental
  // re-clicks, programmatic callers like phase-5 voice intents).
  const startInFlightRef = useRef(false);
  const applyInFlightRef = useRef(false);

  const start = useCallback(async () => {
    if (startInFlightRef.current || status === "loading" || status === "ready" || status === "applying") {
      return;
    }
    startInFlightRef.current = true;
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(SNAPSHOT_URL, { method: "GET" });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? `Snapshot fetch failed: ${res.status}`);
      }
      const data: SnapshotResponse = await res.json();
      const lookup = new Map(data.securities.map((s) => [s.ticker, s]));
      const universeStage = makeStage(
        STAGE_IDS.UNIVERSE,
        data.securities.map((s) => ({
          ticker: s.ticker,
          market_cap_snapshot: s.marketCap,
          turnover_ratio_ttm: s.turnoverRatio,
          is_profitable: s.isProfitable,
          is_cashflow_positive: s.isCashflowPositive,
          is_asx_100: s.isAsx100,
          is_unproven_or_complex_tech: s.isUnprovenOrComplexTech,
          is_single_commodity_or_single_mine: s.isSingleCommodityOrSingleMine,
        }))
      );
      setSnapshot(data.snapshot);
      setSecuritiesByTicker(lookup);
      setStages([universeStage]);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load snapshot");
      setStatus("error");
    } finally {
      startInFlightRef.current = false;
    }
  }, [status]);

  const applyFilter = useCallback(
    async (filterId: FilterId): Promise<Stage | null> => {
      if (applyInFlightRef.current || status !== "ready") return null;
      const current = stages.at(-1);
      if (!current) return null;
      applyInFlightRef.current = true;
      setStatus("applying");
      setError(null);
      try {
        const res = await fetch(APPLY_FILTER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filterId, fromTickers: current.tickers }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `apply-filter failed: ${res.status}`);
        }
        const data: ApplyFilterResponse = await res.json();
        if (data.stage?.id !== filterId) {
          throw new Error(
            `apply-filter returned stage "${data.stage?.id}" for request "${filterId}"`
          );
        }
        setStages((prev) => [...prev, data.stage]);
        setStatus("ready");
        return data.stage;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to apply filter");
        setStatus("ready"); // recover to ready so the user can retry
        return null;
      } finally {
        applyInFlightRef.current = false;
      }
    },
    [status, stages]
  );

  const reset = useCallback(() => {
    setStages((prev) => (prev.length === 0 ? prev : [prev[0]]));
    setError(null);
  }, []);

  const currentRows = useMemo<SecurityDisplay[]>(() => {
    const current = stages.at(-1);
    if (!current) return [];
    return current.tickers
      .map((t) => securitiesByTicker.get(t))
      .filter((r): r is SecurityDisplay => r !== undefined);
  }, [stages, securitiesByTicker]);

  // Surface a console message if the lookup misses any tickers — should
  // never happen if /apply-filter is consistent with /snapshot.
  useEffect(() => {
    const current = stages.at(-1);
    if (!current || securitiesByTicker.size === 0) return;
    const missing = current.tickers.filter((t) => !securitiesByTicker.has(t));
    if (missing.length > 0) {
      console.warn(
        `[useScreener] ${missing.length} ticker(s) in current stage not in snapshot lookup: ${missing.slice(0, 5).join(", ")}…`
      );
    }
  }, [stages, securitiesByTicker]);

  return {
    status,
    error,
    snapshot,
    stages,
    securitiesByTicker,
    start,
    applyFilter,
    reset,
    currentRows,
  };
}
