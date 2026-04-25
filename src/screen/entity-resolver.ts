/**
 * Deterministic entity resolution for `info_stock_field` intents.
 *
 * Pure function over `{ tickers, nameByTicker }` for unit-testability.
 * The class-based loader (below) handles populating that data from the
 * active snapshot via Drizzle, with a small in-memory cache.
 *
 * Two-pass per plan §4c:
 *   1. Ticker token: extract any alphanumeric tokens of length 2–5
 *      (uppercased), keep those that match a known ticker. Single
 *      match → resolve; multiple → ambiguous → null.
 *   2. Company-name fallback: scan the text for distinctive name
 *      tokens (length ≥ 6 to skip common stop-words like "limited"
 *      that appear in many ASX names). Single match → resolve.
 *
 * The function never invokes an LLM and never throws on bad input.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/src/db";
import { asxSnapshots, asxSecurities } from "@/src/db/screen-schema";

export type EntityData = {
  tickers: Set<string>;
  /** Map of ticker → official company name (e.g. "COMMONWEALTH BANK OF AUSTRALIA"). */
  nameByTicker: Map<string, string>;
};

export type ResolvedEntity = {
  ticker: string;
  companyName: string;
};

/**
 * Single-token probe length. Anything shorter risks matching common
 * filler ("group", "limited") that appears in many ASX names.
 */
const SINGLE_TOKEN_MIN_LEN = 6;
/** Bigram-eligible token length — looser, since the bigram pair is the discriminator. */
const BIGRAM_TOKEN_MIN_LEN = 4;

const NAME_STOPWORDS = new Set([
  "limited",
  "company",
  "australia",
  "australian",
  "holdings",
  "group",
  "corporation",
  "international",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTickerCandidates(text: string): string[] {
  const upper = text.toUpperCase();
  return Array.from(upper.matchAll(/\b[A-Z0-9]{2,5}\b/g)).map((m) => m[0]);
}

function tickerPass(text: string, tickers: Set<string>): string | null {
  const candidates = extractTickerCandidates(text).filter((c) => tickers.has(c));
  const unique = Array.from(new Set(candidates));
  return unique.length === 1 ? unique[0] : null;
}

/** Tokenise a company name → cleaned, stopword-free, lowercased tokens. */
function nameTokens(name: string, minLen: number): string[] {
  return name
    .toLowerCase()
    .split(/[\s,.&-]+/)
    .filter((t) => t.length >= minLen && !NAME_STOPWORDS.has(t));
}

/**
 * Two-stage name match:
 *   2a. Bigram pass — two adjacent name tokens both appear (in order)
 *       in the text. Catches "Commonwealth Bank" and disambiguates
 *       from "Australian Commonwealth Government Loans".
 *   2b. Single-token fallback — only if no bigram hit anywhere. Uses
 *       word-boundary matching so "wealth" doesn't match "commonwealth".
 *
 * Either pass returns the matched ticker if exactly one company hits;
 * null on no hit or ambiguity.
 */
function namePass(text: string, nameByTicker: Map<string, string>): string | null {
  const lower = text.toLowerCase();

  // 2a — bigram pass.
  const bigramHits = new Set<string>();
  for (const [ticker, name] of nameByTicker) {
    const tokens = nameTokens(name, BIGRAM_TOKEN_MIN_LEN);
    for (let i = 0; i < tokens.length - 1; i++) {
      const phrase = `${tokens[i]} ${tokens[i + 1]}`;
      if (lower.includes(phrase)) {
        bigramHits.add(ticker);
        break;
      }
    }
  }
  if (bigramHits.size === 1) return Array.from(bigramHits)[0];
  if (bigramHits.size > 1) return null;

  // 2b — single-token pass with word boundaries.
  const singleHits = new Set<string>();
  for (const [ticker, name] of nameByTicker) {
    const tokens = nameTokens(name, SINGLE_TOKEN_MIN_LEN);
    for (const tok of tokens) {
      if (new RegExp(`\\b${escapeRegExp(tok)}\\b`).test(lower)) {
        singleHits.add(ticker);
        break;
      }
    }
  }
  return singleHits.size === 1 ? Array.from(singleHits)[0] : null;
}

/**
 * Resolve an utterance to a `{ ticker, companyName }` pair from the
 * supplied data. Returns null when no unique match is found.
 *
 * Pure — same input always produces the same output.
 */
export function resolveEntity(text: string, data: EntityData): ResolvedEntity | null {
  if (text.trim().length === 0) return null;

  const tickerHit = tickerPass(text, data.tickers);
  if (tickerHit) {
    return { ticker: tickerHit, companyName: data.nameByTicker.get(tickerHit) ?? tickerHit };
  }

  const nameHit = namePass(text, data.nameByTicker);
  if (nameHit) {
    return { ticker: nameHit, companyName: data.nameByTicker.get(nameHit) ?? nameHit };
  }

  return null;
}

/**
 * Loads + caches the entity data for the active snapshot. The cache
 * keys on `snapshotId`, so a new snapshot invalidates the cache
 * automatically on the next call.
 */
export class EntityResolver {
  private cache: { snapshotId: string; data: EntityData } | null = null;

  /** Resolve an utterance against the active-snapshot entity data. */
  async resolve(text: string): Promise<ResolvedEntity | null> {
    if (text.trim().length === 0) return null;
    const data = await this.loadActive();
    if (!data) return null;
    return resolveEntity(text, data);
  }

  /** Force a refresh on the next call. Useful after re-ingesting. */
  invalidate(): void {
    this.cache = null;
  }

  private async loadActive(): Promise<EntityData | null> {
    const [active] = await db
      .select({ id: asxSnapshots.id })
      .from(asxSnapshots)
      .orderBy(desc(asxSnapshots.collectedAt), desc(asxSnapshots.id))
      .limit(1);
    if (!active) return null;
    if (this.cache && this.cache.snapshotId === active.id) return this.cache.data;

    const rows = await db
      .select({ ticker: asxSecurities.ticker, companyName: asxSecurities.companyName })
      .from(asxSecurities)
      .where(eq(asxSecurities.snapshotId, active.id));

    const data: EntityData = {
      tickers: new Set(rows.map((r) => r.ticker)),
      nameByTicker: new Map(rows.map((r) => [r.ticker, r.companyName])),
    };
    this.cache = { snapshotId: active.id, data };
    return data;
  }
}
