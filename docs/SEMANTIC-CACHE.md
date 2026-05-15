# Semantic cache layer

A proposed third layer for intent classification, sitting between the deterministic rule layer (`src/screen/intent-rules.ts`) and the Anthropic Haiku fallback (`src/screen/screen-matcher.ts`). Goal: catch paraphrases the regex layer misses without paying the Haiku round-trip every time.

**Status:** design proposal, not yet implemented.

**Companion documents:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) — code structure and data flow.
- [PROCESSING-STREAMS.md](./PROCESSING-STREAMS.md) — current concurrent streams (intent classification = stream 4).
- [INTENT-EVALS.md](./INTENT-EVALS.md) — companion eval/accuracy work; required to safely measure changes here.

---

## 1. Why this exists

The current pipeline is two layers (plan §7a):

```
utterance → intent-rules (regex)
              ├─ hit  → return Intent     (sub-1 ms)
              └─ miss → Anthropic Haiku   (300–800 ms typical, 5 s timeout)
```

The rule layer is excellent for the scripted Q1–Q8 funnel and well-known stock-fact phrasings, but it's brittle to paraphrase. Real users say things like "what's their take on tech that hasn't proven itself" — semantically Q5, but no regex catches it. Today every such utterance pays a Haiku round-trip, which is the dominant component of voice-loop latency on rule misses (the STT call has its own budget, see [PROCESSING-STREAMS.md](./PROCESSING-STREAMS.md) stream 3).

A semantic cache slots between the two and absorbs this paraphrase traffic locally:

```
utterance → intent-rules
              ├─ hit  → return                       (sub-1 ms)
              └─ miss → embed + cosine top-k
                          ├─ score > 0.85 → return            (~30–80 ms)
                          ├─ 0.70–0.85   → Haiku w/ few-shot  (300–600 ms, higher accuracy)
                          └─ < 0.70      → full Haiku         (300–800 ms, current path)
```

The thresholds (0.85 and 0.70) are starting points. Tuning depends on the embedding model and the curated corpus — see §6.

---

## 2. Curated intent corpus

A bank of canonical phrasings, one or more per `IntentKind` (and per `filterId`/`field`/`topic` where the intent carries one). Lives as a TypeScript constant alongside `intent-rules.ts`, e.g. `src/screen/intent-corpus.ts`.

Shape:

```ts
type CorpusEntry = {
  intent: Intent;          // exact Intent the entry resolves to
  phrasings: string[];     // canonical + paraphrases, hand-curated
  source?: "scripted" | "transcript" | "synthetic";
};
```

Sourcing strategy:

1. **Scripted seed.** For each of the 8 funnel filters and the 11 process topics + ~20 fund categories, hand-write 5–10 paraphrases. The pitch script and the regex patterns themselves are good seeds (the regex alternations enumerate the phrasings the team already thought of). Coverage should reach every `IntentKind` with a non-trivial argument.
2. **Transcript mining.** Once eval transcripts exist (see [INTENT-EVALS.md](./INTENT-EVALS.md) §3), promote the cleanest gold-labeled utterance per intent into the corpus. This closes the loop: real misses become tomorrow's hits.
3. **Synthetic expansion.** Optional later step — ask Haiku offline to generate N paraphrases per scripted entry, hand-review, drop the bad ones. Keeps cost off the hot path.

Corpus size target: 200–400 entries to start. Embedding 400 strings against OpenAI `text-embedding-3-small` (1536-dim, ~$0.02 / 1M tokens) is ~$0.0001 — effectively free. Stored as a flat array of `{ embedding: Float32Array, intent: Intent }`.

---

## 3. Hot-path lookup

At process start (lazy on first miss is fine), pre-embed the entire corpus and hold it in memory. On each rule miss:

1. **Embed once** — single API call, ~30–80 ms typical for `text-embedding-3-small`.
2. **Cosine top-k** — `k=5` against the in-memory matrix. With 400 entries × 1536 dims this is a ~600 KB dot-product and finishes in <1 ms in pure JS. No vector DB needed at this scale.
3. **Apply thresholds:**
   - `score[0] > 0.85` → return `corpus[topIdx].intent`. **Cache hit** — no LLM.
   - `0.70 ≤ score[0] ≤ 0.85` → call Haiku with the top 3 candidates as few-shot context (`<example>utterance: "..." → intent: {...}</example>` blocks before the user message). Same prompt budget, higher accuracy on ambiguous phrasings.
   - `score[0] < 0.70` → call Haiku with the current (no few-shot) prompt.

All three branches end in a normalised `Intent`. The schema validation in `screen-matcher.ts:154` continues to gate Haiku output, so a hallucinated intent still degrades to `{ kind: "fallback" }`.

### 3.1 Result cache

Independent of the corpus lookup, cache `{ embedding, finalIntent }` keyed by the lowercased+trimmed utterance string (same normalisation `matchIntentRule` already does). LRU, ~1000 entries, in-process. A repeat of the literal same utterance (very common in the demo — "next", "show me", filter-name shortcuts) pays zero embedding cost.

This sits in front of step 1 above:

```
utterance → normalize → resultCache.get?
              ├─ hit  → return Intent     (sub-1 ms)
              └─ miss → embed → top-k → ...
                              → resultCache.set(utterance, intent)
```

---

## 4. Embedding provider

Three plausible choices, all suitable. None is wired today.

| Provider | Model | Dim | Latency (p50) | Cost / 1M tok | Notes |
|---|---|---|---|---|---|
| OpenAI | `text-embedding-3-small` | 1536 | 30–80 ms | $0.02 | Most boring + fastest. New `OPENAI_API_KEY` env. |
| Voyage AI | `voyage-3-lite` | 512 | 40–100 ms | $0.02 | Smaller dim → cheaper memory + faster cosine. |
| Cohere | `embed-english-v3.0` | 1024 | 50–120 ms | $0.10 | Nice but priciest. No reason over the others here. |

Recommendation: **OpenAI `text-embedding-3-small`**. Standardises on the same API shape as Anthropic (REST + JSON), no SDK needed, and the latency is the lowest of the three on Vercel's US edge. Provider is hidden behind an `EmbeddingClient` interface so swap is mechanical.

The provider's outage budget matters: on embedding error the layer must transparently fall through to the existing Haiku path, not throw. Same posture as the existing classifier (`screen-matcher.ts:49`).

---

## 5. Storage

Two options for the pre-embedded corpus:

1. **In-memory `Map`, seeded at boot.** Corpus and embeddings live in a const module loaded once per cold start. Cold start cost is bounded by one batch embedding call (~150–300 ms for 400 entries via the batch endpoint). On Vercel each instance pays this once. Simplest possible thing.
2. **Persisted in `demoQuestionPatterns`.** The vestigial table from v1 (kept around for the separate v1 app — see CLAUDE.md "v1 demo decommission") has roughly the right shape: `{ utterance, intent_kind, filter_id, embedding bytea, ... }`. Embeddings persist across deploys, no cold-start hit.

Recommend **option 1 first** (in-memory) — the cold-start cost is invisible to a user already waiting through the Tavus avatar bring-up. Move to option 2 only if cold-start budget tightens or the corpus grows past ~5K entries.

The result cache (§3.1) stays in-memory regardless. Persisting per-utterance results buys little for a low-QPS pitch demo.

---

## 6. Threshold tuning

The two thresholds (0.85 cache hit, 0.70 few-shot trigger) are model-specific and corpus-specific. **They cannot be picked correctly without an eval set** — see [INTENT-EVALS.md](./INTENT-EVALS.md). The intended workflow:

1. Build the labeled eval set (transcripts + gold intents).
2. For each candidate threshold pair `(t_high, t_low)` in a sweep, run the eval set through the layered classifier and measure:
   - Cache hit rate
   - Top-1 accuracy on cache hits
   - Top-1 accuracy on few-shot hits
   - Latency p50 / p95
3. Pick the operating point that holds top-1 accuracy ≥ baseline (current rules+Haiku) while maximising cache hit rate.

Until that's measurable, ship the layer behind an env flag (`SEMANTIC_CACHE_ENABLED=false` default) and keep the existing path live.

---

## 7. Independent latency wins

These don't require the cache layer and can ship sooner.

### 7.1 Anthropic prompt caching

The system prompt at `src/screen/screen-matcher.ts:60` is fully static (it enumerates intent kinds, filter IDs, and field names — all build-time constants). Anthropic supports explicit prompt caching via the `cache_control: { type: "ephemeral" }` marker on a system prompt block. Add it once, save ~200–400 ms per Haiku call on the dominant cache-hit path.

Concretely:

```ts
// in anthropicClassifier
body: JSON.stringify({
  model: MODEL_ID,
  max_tokens: 100,
  temperature: 0,
  system: [
    { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
  ],
  messages: [{ role: "user", content: text }],
}),
```

Independent of everything else in this doc. Pure latency win on the existing fallback path.

### 7.2 Parallel STT + embedding lookup

Today the pipeline is sequential: STT completes, then intent classification runs over the final transcript. Some STT providers (ElevenLabs included for some flows) can stream partial transcripts. If we expose partial transcripts, we can:

- Kick off a speculative embedding lookup as soon as a partial is "stable enough" (e.g. last partial unchanged for 200 ms).
- If the partial yields a high-confidence cache hit (`score > 0.90`, deliberately tighter than the production threshold), pre-warm the dispatcher with the predicted intent.
- On final transcript, re-run; if the prediction matches, the dispatch is already half-done.

This is genuinely complex and worth deferring until the simpler wins (prompt caching, the cache layer itself) are landed and measured. Mentioned here so it's not forgotten.

---

## 8. Failure modes and rollout

| Failure | Today | With cache layer |
|---|---|---|
| Embedding API down | n/a | Fall through to existing Haiku path. No user-visible change. |
| Embedding API slow (>500 ms) | n/a | `AbortSignal.timeout(500)` on the embedding call → fall through to Haiku. Net latency ~= today's latency. |
| Cache returns wrong intent | n/a | Same impact as a Haiku misclassification today: dispatcher renders the wrong response. Mitigated by tighter `t_high`. |
| Cold start | First Haiku call pays full latency | First miss after cold start pays embedding + Haiku (the corpus pre-embed is on `import`, deferred to first miss is also fine). |
| Corpus drift (snapshot of intents in code rotates) | n/a | The corpus is a TS const checked into the repo — typechecked against `Intent` so a renamed `filterId` breaks the build, not runtime. |

Rollout staging:

1. Land the layer behind `SEMANTIC_CACHE_ENABLED=false`. Wire it through `screen-matcher.ts` so the same `matchScreenIntent` signature is used; the layer is invisible to callers.
2. Build the eval set ([INTENT-EVALS.md](./INTENT-EVALS.md) §3). Establish baseline accuracy + latency.
3. Tune thresholds against the eval set.
4. Enable in preview deployments first; compare classifier-decision logs (`logger.info({ source: "rule"|"cache"|"haiku-fewshot"|"haiku" }, ...)`) against the eval set on real traffic.
5. Promote to prod with the eval-set numbers attached to the PR.

Kill switch is the env flag. No data migration to undo.

---

## 9. Tradeoffs

**Pro:**
- Catches paraphrases without an LLM round-trip.
- Cost reduction proportional to cache hit rate. At 50% hit rate on the Haiku-bound portion of traffic, ~halves the Anthropic bill.
- The corpus is human-readable and reviewable in PRs — easier to reason about than a fine-tuned classifier.

**Con:**
- Adds an embedding API dependency (new provider, new key, new outage surface).
- Adds 30–80 ms per query even on cache hits — for utterances the rule layer would have caught had we written one more regex, the cache costs latency net.
- Requires the eval set to tune; without it, threshold-picking is guesswork.
- Two more knobs (`t_high`, `t_low`) to keep in sync with corpus changes.

**Cheaper alternative if latency is tight:** prompt caching (§7.1) + a hand-curated paraphrase list folded into the existing regex rules. Gets ~half the wins of the full cache layer with none of the new dependencies. Reasonable interim step.

---

## 10. Open questions

1. Embedding provider lock-in — is there a strategic reason to prefer Voyage (smaller dims, cheaper) over OpenAI for a long-running product?
2. Should the result cache be per-process or shared (Redis)? At demo QPS, per-process is fine; at prod scale (`docs/plans/production-modernization-plan.md` phase 7), shared makes sense.
3. Few-shot construction: do we send the literal corpus phrasings, or paraphrases of the user's utterance? Literal is simpler and probably enough.
4. Does the cache layer need to be aware of conversation context (previous intent, funnel stage)? Current `matchScreenIntent` is stateless. Adding state would also benefit the rule layer — orthogonal feature.
