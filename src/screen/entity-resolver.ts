/**
 * Deterministic entity resolution for `info_stock_field` intents.
 *
 * Pure function over `{ tickers, nameByTicker }` for unit-testability.
 * The class-based loader (below) handles populating that data from the
 * active snapshot via Drizzle, with a small in-memory cache.
 *
 * Resolution pipeline (each pass requires exactly one ticker hit;
 * ambiguity → null and we fall through to the next pass):
 *   1. Ticker token — alphanumeric tokens of length 2–5 (uppercased)
 *      matched against the snapshot ticker set.
 *   2. Strict name match — bigram of adjacent ≥4-char name tokens, then
 *      single-token ≥6-char fallback with word boundaries.
 *   3. Joined-tokens pass — concatenate adjacent text tokens before
 *      single-token matching ("common wealth bank" → "commonwealth"
 *      → CBA). Catches STT splits.
 *   4. Fuzzy single-token pass — Levenshtein distance ≤ 2 against
 *      ≥6-char name tokens. Catches typos and mispronunciations
 *      ("telestra" → TLS, "wesfarmer" → WES).
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
/** Max edit distance for the fuzzy single-token pass. */
const FUZZY_MAX_DISTANCE = 2;

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
 * Lowercased alphanumeric tokens from arbitrary input text. Used by
 * the joined-tokens and fuzzy passes so they share the same notion of
 * "what counts as a word" — `\W+` split on the lowercase form.
 */
function textTokens(text: string, minLen: number): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= minLen);
}

/**
 * Bounded Levenshtein with early termination. Returns the distance
 * if it's ≤ `max`, otherwise `max + 1`. Two-row DP, O(min(|a|,|b|)).
 *
 * The early bound (`Math.min(...row) > max`) is what keeps this cheap
 * — most candidate pairs fail the length-difference filter or bail
 * out partway through.
 */
function levenshtein(a: string, b: string, max: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > max) return max + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
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
 * Joined-tokens pass — concatenates each consecutive pair of text
 * tokens and tries them as exact single-token matches. Catches STT
 * splits like "common wealth" → "commonwealth" → CBA, or
 * "next dc" → "nextdc" → NXT.
 */
function joinedTokenPass(text: string, nameByTicker: Map<string, string>): string | null {
  const toks = textTokens(text, 1);
  if (toks.length < 2) return null;
  const joined: string[] = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const j = toks[i] + toks[i + 1];
    if (j.length >= SINGLE_TOKEN_MIN_LEN) joined.push(j);
  }
  if (joined.length === 0) return null;
  const joinedSet = new Set(joined);
  const hits = new Set<string>();
  for (const [ticker, name] of nameByTicker) {
    const tokens = nameTokens(name, SINGLE_TOKEN_MIN_LEN);
    for (const t of tokens) {
      if (joinedSet.has(t)) {
        hits.add(ticker);
        break;
      }
    }
  }
  return hits.size === 1 ? Array.from(hits)[0] : null;
}

/**
 * Fuzzy single-token pass — for each ≥6-char name token, checks whether
 * any ≥6-char text token is within Levenshtein distance ≤ 2. Catches
 * typos and mispronunciations: "telestra" → TLS, "wesfarmer" → WES,
 * "westpack" → WBC.
 *
 * Length-difference pre-filter and bounded Levenshtein keep the cost
 * down — pathological case is O(|tickers| * |textTokens| * 6 * max),
 * which for ~2000 ASX names + a 5-word utterance is well under 1 ms.
 */
function fuzzyTokenPass(text: string, nameByTicker: Map<string, string>): string | null {
  const candidates = textTokens(text, SINGLE_TOKEN_MIN_LEN);
  if (candidates.length === 0) return null;
  const hits = new Set<string>();
  for (const [ticker, name] of nameByTicker) {
    const nameToks = nameTokens(name, SINGLE_TOKEN_MIN_LEN);
    let matched = false;
    for (const nt of nameToks) {
      for (const ct of candidates) {
        if (Math.abs(nt.length - ct.length) > FUZZY_MAX_DISTANCE) continue;
        if (levenshtein(nt, ct, FUZZY_MAX_DISTANCE) <= FUZZY_MAX_DISTANCE) {
          matched = true;
          break;
        }
      }
      if (matched) break;
    }
    if (matched) hits.add(ticker);
  }
  return hits.size === 1 ? Array.from(hits)[0] : null;
}

/**
 * Resolve an utterance to a `{ ticker, companyName }` pair from the
 * supplied data. Returns null when no unique match is found across
 * all four passes (ticker, strict name, joined-tokens, fuzzy).
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

  const joinedHit = joinedTokenPass(text, data.nameByTicker);
  if (joinedHit) {
    return { ticker: joinedHit, companyName: data.nameByTicker.get(joinedHit) ?? joinedHit };
  }

  const fuzzyHit = fuzzyTokenPass(text, data.nameByTicker);
  if (fuzzyHit) {
    return { ticker: fuzzyHit, companyName: data.nameByTicker.get(fuzzyHit) ?? fuzzyHit };
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
