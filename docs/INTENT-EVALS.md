# Intent classifier evals

A proposed evaluation harness, labeled corpus, and confidence/disambiguation path for the intent classifier (`src/screen/screen-matcher.ts` + `src/screen/intent-rules.ts`). Goal: make every change to the classifier — regex tweak, prompt edit, embedding threshold ([SEMANTIC-CACHE.md](./SEMANTIC-CACHE.md)) — measurable instead of vibes-based.

**Status:** design proposal, not yet implemented.

**Companion documents:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) — code structure and data flow.
- [SEMANTIC-CACHE.md](./SEMANTIC-CACHE.md) — the latency-side companion to this work; sharing thresholds and corpus.
- [PROCESSING-STREAMS.md](./PROCESSING-STREAMS.md) — current streams (intent classification = stream 4).

---

## 1. Why this exists

Today there is no automated way to know whether a regex tweak in `intent-rules.ts` regresses an intent that used to work. The unit tests in `tests/screen/` cover individual rules but use synthetic phrasings written by the same person who wrote the rule. Real users phrase questions in ways the test author didn't anticipate — that's the entire point of having a Haiku fallback in the first place.

Two consequences of having no eval signal:

1. **Silent regressions.** Tightening a regex to fix one false positive can quietly break three previously-correct phrasings. The change passes CI; the regression shows up mid-pitch.
2. **No threshold floor.** The semantic cache layer in [SEMANTIC-CACHE.md](./SEMANTIC-CACHE.md) needs an accuracy baseline to tune against. Without that baseline, "did this change make things better?" is unanswerable.

The risk profile is specifically about classification, not factual answers. Stock facts and holdings overlap are snapshot-grounded (`src/screen/market-data-provider.ts`, `app/api/v1/screen/portfolio-overlap/route.ts`) — the data is correct by construction. The way the demo gets things wrong is by routing a user's question to the wrong intent (Q3 instead of Q4, `info_stock_field` instead of `info_fund_field`). That's exactly what an eval set measures.

---

## 2. Current testing posture

What exists today:

- Unit tests in `tests/screen/intent-rules.test.ts` — per-regex test cases, written alongside the rule.
- Unit tests in `tests/screen/screen-matcher.test.ts` — verifies the rule→classifier→fallback flow with a stub classifier.
- Snapshot tests in `tests/screen/funnel.test.ts` — covers filter mechanics, not intent.

What's missing:

- A held-out set of utterances (especially paraphrases the rule author didn't think of) with gold intents.
- A harness that runs the full `matchScreenIntent` flow over that set and reports per-intent precision/recall.
- A confusion matrix so "intent X gets misrouted to intent Y" is visible at a glance.
- A baseline-vs-PR diff so review knows whether a change is net positive.

---

## 3. The labeled eval set

A flat JSONL file — one example per line — checked into the repo at `tests/screen/eval/intent.jsonl`. Loaded by the harness in §4.

Schema:

```ts
type EvalExample = {
  id: string;                  // stable, e.g. "fund-001", auto-incremented per source
  utterance: string;           // the literal text (or transcript) the user spoke
  goldIntent: Intent;          // exact expected output of matchScreenIntent
  source: "scripted" | "transcript" | "synthetic";
  notes?: string;              // why this example exists, edge case, etc.
};
```

`goldIntent` reuses the existing `Intent` discriminated union from `src/screen/intent.ts` — no new type to maintain. A change to `Intent` (new field, renamed `filterId`) breaks the eval file at typecheck time, not at runtime.

### 3.1 Sourcing

Three sources, in priority order:

1. **Real session transcripts.** The highest-value examples. Today's pipeline writes intent decisions to `logger.info` with the raw utterance (verify in `screen-matcher.ts` and add if missing). Capture a sample of these from preview-deploy traffic, hand-label, commit. Target: 200 examples to start.
2. **Pitch script paraphrases.** For each scripted phrase in `docs/pep-avatar-v2-pitch-script.md`, write 3–5 paraphrases a real user might say. Hand-label. Target: 100 examples.
3. **Synthetic paraphrases (low priority).** If transcripts are sparse, generate paraphrases offline with Claude, hand-review, drop the ones that aren't realistic. Mark `source: "synthetic"` so the harness can filter them out of headline metrics.

The corpus from [SEMANTIC-CACHE.md](./SEMANTIC-CACHE.md) §2 and the eval set serve different purposes and **must not overlap**. The corpus is the reference set the cache matches *against*; the eval set is the held-out set we measure *with*. Bleeding one into the other inflates apparent accuracy. Guard with a check in the harness: `assert(intersection(corpus.phrasings, evalSet.utterances) === ∅)`.

### 3.2 Curation workflow

Lightweight by design:

1. Engineer pulls the last week of `intent-decision` log lines from preview deploys.
2. Filters out anything already present in the eval set (by normalised utterance).
3. Opens a PR with new lines appended to `intent.jsonl`. Reviewer eyeballs the gold labels.
4. CI runs the harness; merge if accuracy doesn't drop on existing examples.

No tooling needed beyond a one-shot `bun scripts/eval/import-from-logs.ts` script when this scales.

---

## 4. The eval harness

A new script: `bun scripts/eval/run-intent-eval.ts`. Single file, ~150 lines.

Behaviour:

1. Load `tests/screen/eval/intent.jsonl`.
2. For each example, call `matchScreenIntent(utterance, classifier)`.
3. Compare the returned `Intent` to `goldIntent` with a deep-equality check that ignores extraneous fields (e.g. an undefined `topic` matches an absent `topic`).
4. Emit:
   - Per-intent precision and recall (rows = gold intent, columns = predicted intent).
   - Overall accuracy.
   - Confusion matrix (markdown table, sorted by error count).
   - List of every miss with `id`, `utterance`, `gold`, `predicted` — sorted by source so transcript misses surface first.
   - Latency stats (p50, p95) per layer (`rule | cache | haiku-fewshot | haiku`) — see §6.

Output: stdout for human review, plus `tests/screen/eval/last-run.json` for CI diffing.

CI integration: a `bun run eval:intent` script in `package.json`, run as part of `bun run lint`-equivalent on PRs that touch `src/screen/intent-rules.ts`, `src/screen/screen-matcher.ts`, `src/screen/intent-corpus.ts` (when it exists), or the eval set itself. CI compares `last-run.json` from the PR against `main` and fails if accuracy drops by more than a configured tolerance (e.g. 1%) without an explicit override.

### 4.1 Determinism

The Haiku call is non-deterministic at `temperature=0` only in the absence of caching — small variations still happen. The harness should:

- Run the rule layer and (future) cache layer **without** the LLM stub by default — those are deterministic.
- For the LLM-bound subset, either:
  - (a) Stub out the classifier with a recorded fixture per utterance (deterministic, but stale once Haiku changes), or
  - (b) Run live against the real Haiku endpoint, run 3 trials, take the majority.

Recommend **(a) for CI** (cheap, deterministic, catches rule+cache regressions which are most of the surface) and **(b) on demand** (a `--live` flag for periodic verification). Drift between (a) and (b) is its own signal worth tracking.

---

## 5. Confidence thresholds + disambiguation

A second use of the eval set: pick confidence operating points where the classifier should *ask* rather than guess.

Today the classifier always commits. `screen-matcher.ts` returns one `Intent`, the dispatcher acts on it. There's no "I'm not sure, did you mean…" path. With confidence scores from the cache layer (cosine similarity) and from Haiku (token logprobs, if exposed), the dispatcher can branch:

| Confidence | Action |
|---|---|
| High (cache `> 0.85`, Haiku top-1 logprob `> 0.8`) | Commit. Current behaviour. |
| Medium (cache `0.70–0.85`, Haiku top-1 `0.5–0.8`) | Commit, but log for offline review. Current behaviour today is already this. |
| Low (cache `< 0.70` and Haiku top-1 `< 0.5`, or Haiku returns `fallback`) | Ask — Pep says: *"I caught something about <topic>, did you mean <option A> or <option B>?"* |

The disambiguation path needs a new narration template (`src/screen/narration.ts`) and a new state in `src/screen/state.ts` to hold the pending choice (so the next utterance is interpreted as a yes/no/A/B against the held question rather than as a fresh intent). Mechanically it looks like the existing funnel-pending state.

This is preferable to the current low-confidence behaviour, which is to silently route to `{ kind: "fallback" }` and have Pep say a generic "I didn't catch that". Confused users restate their question; the system gets a second chance to classify, but the user doesn't know what to clarify. Disambiguation tells them.

Threshold values come from §4 — same eval set, sweep the threshold, pick the operating point that minimises (false-commits + false-asks) weighted by how annoying each is in the demo.

---

## 6. Production hooks

Two production-side changes that the eval work needs:

1. **Decision logging.** `screen-matcher.ts` should log every decision with: `{ utterance, intent, source: "rule"|"cache"|"haiku-fewshot"|"haiku"|"fallback", latencyMs, confidence? }`. Cheap (existing `logger`), high-signal. Today it logs only on classifier failure (`screen-matcher.ts:50`). Expand to log every call.
2. **Latency breakdown.** Each layer logs its own elapsed time. Lets §4 report p50/p95 per layer, so a regression in Haiku latency is distinguishable from a regression in cache latency.

Both are additive — no behaviour change. Get them in early so by the time the cache layer or new regex changes ship, there's a backlog of real utterances to mine for the eval set.

---

## 7. What this work doesn't do

- **It doesn't measure factual correctness.** Whether `info_stock_field` returns the right share price for the right ticker is a different test (and is mostly handled by the snapshot being the source of truth). The eval set measures intent routing only.
- **It doesn't replace unit tests.** Per-rule unit tests in `tests/screen/intent-rules.test.ts` stay — they're cheap, focused, and useful for regex authoring. The eval set is the integration check.
- **It doesn't generalise to Tavus narration quality.** Whether Pep's spoken response is *good* is a separate (subjective, harder) eval. Out of scope here.

---

## 8. Tradeoffs

**Pro:**
- Every classifier change gets a number. PR descriptions stop saying "should be better, tested manually".
- Threshold tuning for the cache layer becomes a sweep instead of a guess.
- Disambiguation gives confused users a second turn instead of a dead-end.

**Con:**
- Curating the labeled set is grunt work. Without engineering discipline it goes stale.
- Live Haiku eval runs cost money — cap them and lean on stubbed runs in CI.
- Disambiguation adds a turn — bad UX if the threshold is too aggressive. The eval set's job is to keep this honest.

---

## 9. Recommended order of work

If both this doc and [SEMANTIC-CACHE.md](./SEMANTIC-CACHE.md) get green-lit, the dependency order is:

1. **Decision logging + latency breakdown** (§6). Tiny, additive.
2. **Eval harness skeleton** (§4) reading an empty file. Lands the script + CI plumbing.
3. **Initial eval set** (§3) — 100 examples from the pitch script. Establishes a baseline.
4. **Anthropic prompt caching** ([SEMANTIC-CACHE.md](./SEMANTIC-CACHE.md) §7.1) — pure latency win, measurable against the harness.
5. **Disambiguation path** (§5). Requires the eval set to pick thresholds.
6. **Semantic cache layer** ([SEMANTIC-CACHE.md](./SEMANTIC-CACHE.md) §2–§5). Requires the eval set to pick thresholds.
7. **Transcript-mined eval examples** (§3.1 source 1). Ongoing.

Steps 1–3 are a few days of work each and unlock everything else. They're the foundation; the cache layer is the payoff.

---

## 10. Open questions

1. Where do production transcripts live for mining? Today they go to `logger` → stdout → Vercel logs (24-hour retention). Does the eval workflow need a longer-lived sink?
2. Privacy: real transcripts may include user names, account hints, etc. Should the import script PII-scrub before commit?
3. Eval-set size: at what point do we need to split into train / eval / held-out, vs. just keep one set? At <500 examples, one set is fine.
4. Does the disambiguation path need its own intent (`disambiguation_response`) so the rule layer can recognise "the second one" / "yes, A"? Probably yes; small addition to `intent.ts`.
