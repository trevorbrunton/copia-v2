-- 005_screen_schema: Pep avatar v2 — OC screening demo
--
-- Adds three new tables for the v2 demo (asx_snapshots, asx_securities,
-- oc_holdings). Does NOT touch the existing v1 demo tables (demo_responses,
-- demo_question_patterns) — those are read by a separate v1 app and must be
-- preserved on Supabase.

-- ─── Snapshot metadata ─────────────────────────────────────
-- One row per ingested point-in-time ASX universe snapshot.
-- The active snapshot is selected by MAX(collected_at).
CREATE TABLE asx_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_date DATE NOT NULL,
  collected_at TIMESTAMPTZ NOT NULL,
  source TEXT NOT NULL,
  stock_count INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ─── ASX securities (filterable per-snapshot rows) ─────────
CREATE TABLE asx_securities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id UUID NOT NULL REFERENCES asx_snapshots(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  company_name TEXT NOT NULL,
  sector TEXT,
  gics_industry_group TEXT,
  gics_sub_industry TEXT,

  -- Snapshot numeric values
  market_cap_snapshot NUMERIC,
  close_price_snapshot NUMERIC,
  shares_outstanding BIGINT,
  volume_latest BIGINT,
  avg_volume_252d BIGINT,
  total_volume_252d BIGINT,
  turnover_ratio_ttm NUMERIC,
  eps_ttm NUMERIC,
  net_income_ttm NUMERIC,
  free_cash_flow_ttm NUMERIC,
  long_business_summary TEXT,

  -- Derived fields (populated by ingest script)
  earnings_status_snapshot TEXT,
  is_profitable BOOLEAN,
  is_cashflow_positive BOOLEAN,
  is_asx_100 BOOLEAN,

  -- Curated flags (sourced from data/curation.json)
  is_unproven_or_complex_tech BOOLEAN NOT NULL DEFAULT false,
  is_single_commodity_or_single_mine BOOLEAN NOT NULL DEFAULT false,

  -- Provenance: { enrichment_status: "ok" | "partial" | "failed", missing_fields: string[] }
  data_quality JSONB,

  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT asx_securities_snapshot_ticker_unique UNIQUE (snapshot_id, ticker)
);

CREATE INDEX asx_securities_snapshot_mcap_idx
  ON asx_securities (snapshot_id, market_cap_snapshot DESC NULLS LAST);
CREATE INDEX asx_securities_ticker_idx ON asx_securities (ticker);

-- ─── OC holdings (sample portfolio for Q8) ─────────────────
CREATE TABLE oc_holdings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  portfolio_label TEXT NOT NULL,
  as_of_date DATE NOT NULL,
  ticker TEXT NOT NULL,
  weight_pct NUMERIC,
  market_value_aud NUMERIC,
  first_bought DATE,
  share_change_pct NUMERIC,
  one_year_return_pct NUMERIC,
  forward_pe NUMERIC,
  sector TEXT,
  is_sample BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT oc_holdings_portfolio_ticker_date_unique
    UNIQUE (portfolio_label, ticker, as_of_date)
);
