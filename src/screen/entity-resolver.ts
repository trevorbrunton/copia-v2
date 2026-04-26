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

/**
 * Fuzzy edit-distance allowance scales with the longer of the two
 * tokens being compared. Stricter for short names where 2 edits would
 * match too much; more permissive for long names where mispronunciations
 * commonly drop or insert syllables. Calibrated so Levenshtein still
 * stays sub-millisecond against the full ~2000-name snapshot.
 */
function fuzzyAllowance(longerLen: number): number {
  if (longerLen <= 5) return 1;
  if (longerLen <= 9) return 2;
  return 3;
}
/** Min token length entering the fuzzy pass at all (text and name sides). */
const FUZZY_MIN_TOKEN_LEN = 5;

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
  const candidates = Array.from(upper.matchAll(/\b[A-Z0-9]{2,5}\b/g)).map((m) => m[0]);
  // Initialism handling — STT often transcribes spelled-out tickers as
  // "B H P" (single letters / digits separated by spaces or dots)
  // rather than "BHP". Find runs of consecutive single-character
  // tokens and emit every consecutive sub-run of length 2-5 as a
  // candidate. We can't rely on a single regex with `matchAll` here:
  // it's non-overlapping and greedy, so e.g. "what'S B H P" would
  // match "S B H P" → "SBHP" and skip the embedded "BHP".
  const tokens = upper.split(/[^A-Z0-9]+/).filter((t) => t.length > 0);
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i].length !== 1) {
      i++;
      continue;
    }
    let j = i;
    while (j < tokens.length && tokens[j].length === 1) j++;
    const runLen = j - i;
    for (let len = 2; len <= Math.min(5, runLen); len++) {
      for (let start = i; start <= j - len; start++) {
        candidates.push(tokens.slice(start, start + len).join(""));
      }
    }
    i = j;
  }
  return candidates;
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
  // Explicit `.fill(0)` (rather than `new Array(...)`) so the row is a
  // packed numeric array from allocation. The first iteration writes
  // every cell, but explicit init avoids any V8 hole-array fallback if
  // this code is ever copied without the fill loop.
  let curr: number[] = Array(b.length + 1).fill(0);
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
 *
 * Stop-word filter applied symmetrically: pairs starting OR ending
 * with a stop-word are skipped so e.g. "the holdings" can't form a
 * joined token that incidentally collides with a real name fragment.
 * (The name side already filters stop-words via `nameTokens`.)
 */
function joinedTokenPass(text: string, nameByTicker: Map<string, string>): string | null {
  const toks = textTokens(text, 1);
  if (toks.length < 2) return null;
  const joined: string[] = [];
  for (let i = 0; i < toks.length - 1; i++) {
    const a = toks[i];
    const b = toks[i + 1];
    if (NAME_STOPWORDS.has(a) || NAME_STOPWORDS.has(b)) continue;
    const j = a + b;
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
 * Fuzzy single-token pass — Levenshtein-bounded match between text
 * tokens and name tokens. Per-pair distance allowance scales with the
 * longer of the two via `fuzzyAllowance` (stricter for short names,
 * more permissive for long ones where mispronunciations commonly drop
 * or insert syllables). Catches "telestra" → TLS, "wesfarmer" → WES,
 * "westpack" → WBC, "macquarie" mistranscribed as "macquaree" → MQG,
 * "fortescue" mistranscribed as "fortesque" → FMG.
 *
 * Both sides require ≥ FUZZY_MIN_TOKEN_LEN chars (5 today). Per-pair
 * length-difference pre-filter + bounded Levenshtein with early row-
 * minimum termination keeps it sub-millisecond against ~2000 names.
 */
function fuzzyTokenPass(text: string, nameByTicker: Map<string, string>): string | null {
  const candidates = textTokens(text, FUZZY_MIN_TOKEN_LEN);
  if (candidates.length === 0) return null;
  const hits = new Set<string>();
  for (const [ticker, name] of nameByTicker) {
    const nameToks = nameTokens(name, FUZZY_MIN_TOKEN_LEN);
    let matched = false;
    for (const nt of nameToks) {
      for (const ct of candidates) {
        const allowance = fuzzyAllowance(Math.max(nt.length, ct.length));
        if (Math.abs(nt.length - ct.length) > allowance) continue;
        if (levenshtein(nt, ct, allowance) <= allowance) {
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
