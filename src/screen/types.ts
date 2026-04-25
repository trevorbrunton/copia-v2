/**
 * Shared client-side types for the v2 screen demo.
 */
import type { Stage } from "@/src/screen/funnel";

/** Display row for a single ASX security in the stocks table. */
export type SecurityDisplay = {
  ticker: string;
  companyName: string;
  sector: string | null;
  gicsIndustryGroup: string | null;
  marketCap: number | null;
  closePrice: number | null;
  turnoverRatio: number | null;
  netIncomeTtm: number | null;
  freeCashFlowTtm: number | null;
  epsTtm: number | null;
  earningsStatus: string | null;
  isProfitable: boolean | null;
  isCashflowPositive: boolean | null;
  isAsx100: boolean;
  isUnprovenOrComplexTech: boolean;
  isSingleCommodityOrSingleMine: boolean;
  dataQuality: { enrichment_status: "ok" | "partial" | "failed"; missing_fields: string[] } | null;
};

export type SnapshotMeta = {
  id: string;
  date: string;
  collectedAt: string;
  stockCount: number;
};

export type SnapshotResponse = {
  snapshot: SnapshotMeta;
  securities: SecurityDisplay[];
};

export type ApplyFilterResponse = {
  stage: Stage;
  snapshot: { id: string; date: string; collectedAt: string };
};
