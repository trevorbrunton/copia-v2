/**
 * Fund Q&A bank loader.
 *
 * The pre-scripted answers live in `data/fund-qa.json` (one row per
 * `{ fundId, category }` pair) so they can be reviewed and edited as
 * data, not code. This module bundles the JSON via Next's import
 * resolver, narrows the types, and exposes typed accessors for the
 * intent layer + narration template + UI.
 *
 * The `FundId` and `CategoryId` unions below are the contract — the
 * runtime check at module load asserts that the JSON shape matches.
 * Adding a new fund / category means: (1) add to the JSON, (2) add to
 * the union here, (3) restart. TypeScript will then flag every site
 * that needs to handle the new value.
 */
import bank from "@/data/fund-qa.json";

export const FUND_IDS = ["mid_cap", "micro_cap", "premium_small"] as const;
export type FundId = (typeof FUND_IDS)[number];

export const CATEGORY_IDS = [
  "fund_overview",
  "investment_objective",
  "investment_strategy",
  "investment_universe",
  "asset_allocation",
  "investment_timeframe",
  "risk_level",
  "target_market",
  "management_fees",
  "performance_fees",
  "transaction_costs",
  "minimum_investment",
  "distributions",
  "withdrawals",
  "cooling_off",
  "about_oc",
  "about_copia",
  "how_to_apply",
  "tax",
  "esg",
  "performance",
] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];

interface FundEntry {
  displayName: string;
  shortName: string;
  apirCode: string;
  arsn: string | null;
  sourceDoc: string;
  answers: Record<CategoryId, string>;
}

interface FundQaBank {
  lastUpdated: string;
  categoryLabels: Record<CategoryId, string>;
  funds: Record<FundId, FundEntry>;
}

const TYPED_BANK = bank as unknown as FundQaBank;

// Module-load assertion — bidirectional. Fails loud at boot if either
// side drifts: a TS-declared fund/category missing from the JSON, OR a
// JSON-declared fund/category not reflected in the unions here. Both
// directions matter because either silently breaks lookups: a missing
// JSON entry would throw at narration time; an unknown JSON entry
// would be unreachable from the matcher and never spoken.
for (const fundId of FUND_IDS) {
  const fund = TYPED_BANK.funds[fundId];
  if (!fund) {
    throw new Error(`fund-qa.json: missing fund "${fundId}"`);
  }
  for (const cat of CATEGORY_IDS) {
    if (!fund.answers[cat]) {
      throw new Error(`fund-qa.json: ${fundId} missing answer for "${cat}"`);
    }
  }
}
for (const cat of CATEGORY_IDS) {
  if (!TYPED_BANK.categoryLabels[cat]) {
    throw new Error(`fund-qa.json: missing categoryLabel for "${cat}"`);
  }
}
for (const fundId of Object.keys(TYPED_BANK.funds)) {
  if (!isFundId(fundId)) {
    throw new Error(
      `fund-qa.json: unknown fund "${fundId}" — add it to FUND_IDS in src/screen/fund-qa.ts`
    );
  }
  for (const cat of Object.keys(TYPED_BANK.funds[fundId as FundId].answers)) {
    if (!isCategoryId(cat)) {
      throw new Error(
        `fund-qa.json: ${fundId} has unknown category "${cat}" — add it to CATEGORY_IDS in src/screen/fund-qa.ts`
      );
    }
  }
}
for (const cat of Object.keys(TYPED_BANK.categoryLabels)) {
  if (!isCategoryId(cat)) {
    throw new Error(
      `fund-qa.json: unknown categoryLabel "${cat}" — add it to CATEGORY_IDS in src/screen/fund-qa.ts`
    );
  }
}

export function isFundId(s: string): s is FundId {
  return (FUND_IDS as readonly string[]).includes(s);
}

export function isCategoryId(s: string): s is CategoryId {
  return (CATEGORY_IDS as readonly string[]).includes(s);
}

export function getFundAnswer(fundId: FundId, category: CategoryId): string {
  return TYPED_BANK.funds[fundId].answers[category];
}

export function getFundDisplayName(fundId: FundId): string {
  return TYPED_BANK.funds[fundId].displayName;
}

export function getCategoryLabel(category: CategoryId): string {
  return TYPED_BANK.categoryLabels[category];
}

export function listFunds(): Array<{ id: FundId; displayName: string; shortName: string }> {
  return FUND_IDS.map((id) => ({
    id,
    displayName: TYPED_BANK.funds[id].displayName,
    shortName: TYPED_BANK.funds[id].shortName,
  }));
}
