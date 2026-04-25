import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  bigint,
  numeric,
  boolean,
  date,
  jsonb,
  unique,
  index,
} from "drizzle-orm/pg-core";

// ─── ASX snapshot metadata ──────────────────────────────────
// One row per ingested point-in-time snapshot of the ASX universe.
// `MAX(collected_at)` selects the active snapshot at runtime.
export const asxSnapshots = pgTable("asx_snapshots", {
  id: uuid("id").defaultRandom().primaryKey(),
  snapshotDate: date("snapshot_date").notNull(),
  collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
  source: text("source").notNull(),
  stockCount: integer("stock_count").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ─── ASX securities ─────────────────────────────────────────
// Per-ticker rows for a given snapshot. Filters operate on these.
export const asxSecurities = pgTable(
  "asx_securities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => asxSnapshots.id, { onDelete: "cascade" }),
    ticker: text("ticker").notNull(),
    companyName: text("company_name").notNull(),
    sector: text("sector"),
    gicsIndustryGroup: text("gics_industry_group"),
    gicsSubIndustry: text("gics_sub_industry"),

    // Numeric snapshot values
    marketCapSnapshot: numeric("market_cap_snapshot"),
    closePriceSnapshot: numeric("close_price_snapshot"),
    sharesOutstanding: bigint("shares_outstanding", { mode: "number" }),
    volumeLatest: bigint("volume_latest", { mode: "number" }),
    avgVolume252d: bigint("avg_volume_252d", { mode: "number" }),
    totalVolume252d: bigint("total_volume_252d", { mode: "number" }),
    turnoverRatioTtm: numeric("turnover_ratio_ttm"),
    epsTtm: numeric("eps_ttm"),
    netIncomeTtm: numeric("net_income_ttm"),
    freeCashFlowTtm: numeric("free_cash_flow_ttm"),
    longBusinessSummary: text("long_business_summary"),

    // Derived fields (populated by the ingest script)
    earningsStatusSnapshot: text("earnings_status_snapshot"),
    isProfitable: boolean("is_profitable"),
    isCashflowPositive: boolean("is_cashflow_positive"),
    isAsx100: boolean("is_asx_100"),

    // Curated flags (from data/curation.json)
    isUnprovenOrComplexTech: boolean("is_unproven_or_complex_tech")
      .notNull()
      .default(false),
    isSingleCommodityOrSingleMine: boolean("is_single_commodity_or_single_mine")
      .notNull()
      .default(false),

    // Provenance: { enrichment_status: "ok" | "partial" | "failed", missing_fields: string[] }
    dataQuality: jsonb("data_quality"),

    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    snapshotTicker: unique("asx_securities_snapshot_ticker_unique").on(
      t.snapshotId,
      t.ticker
    ),
    snapshotMcap: index("asx_securities_snapshot_mcap_idx").on(
      t.snapshotId,
      t.marketCapSnapshot
    ),
    tickerIdx: index("asx_securities_ticker_idx").on(t.ticker),
  })
);

// ─── OC holdings (sample portfolio for Q8) ─────────────────
export const ocHoldings = pgTable(
  "oc_holdings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    portfolioLabel: text("portfolio_label").notNull(),
    asOfDate: date("as_of_date").notNull(),
    ticker: text("ticker").notNull(),
    weightPct: numeric("weight_pct"),
    marketValueAud: numeric("market_value_aud"),
    firstBought: date("first_bought"),
    shareChangePct: numeric("share_change_pct"),
    oneYearReturnPct: numeric("one_year_return_pct"),
    forwardPe: numeric("forward_pe"),
    sector: text("sector"),
    isSample: boolean("is_sample").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    portfolioTickerDate: unique(
      "oc_holdings_portfolio_ticker_date_unique"
    ).on(t.portfolioLabel, t.ticker, t.asOfDate),
  })
);

// ─── Inferred types ─────────────────────────────────────────
export type AsxSnapshot = typeof asxSnapshots.$inferSelect;
export type NewAsxSnapshot = typeof asxSnapshots.$inferInsert;
export type AsxSecurity = typeof asxSecurities.$inferSelect;
export type NewAsxSecurity = typeof asxSecurities.$inferInsert;
export type OcHolding = typeof ocHoldings.$inferSelect;
export type NewOcHolding = typeof ocHoldings.$inferInsert;
