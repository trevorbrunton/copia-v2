# Processing streams

The Pep demo runs several independent processing streams concurrently. This document enumerates each stream, what triggers it, when it's active, and where it lives in the codebase. Use it as a runbook for "what's actually happening when the user does X" debugging.

**Companion documents:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) — code structure and data flow.
- [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — external services and environment.

---

## Stream overview

| # | Stream | Trigger | Active while | Cost driver |
|---|---|---|---|---|
| 1 | Tavus avatar (WebRTC) | Press *Start Screening* | Until tab closes or `DELETE /api/v1/demo/tavus/[id]` fires | Tavus per-minute |
| 2 | Voice listener (VAD + STT capture) | User clicks the unmute / mic button | Until mic toggled off | None until utterance flushes |
| 3 | Speech-to-text (per utterance) | VAD detects silence after speech | Single-shot per utterance, ~12 s max | ElevenLabs STT |
| 4 | Intent classification | Each text input (voice or chat box) | Single-shot per utterance, sub-100 ms typical | Anthropic Haiku **only on rule miss** |
| 5 | Entity resolver | `info_stock_field` intents without a ticker | Single-shot per utterance | None (in-process snapshot lookup) |
| 6 | Filter engine (`/apply-filter`) | Click in funnel rail / *Next filter →* / voice | Single-shot per click, ~50 ms | None (in-process) |
| 7 | Stock-fact lookup (`/stock-fact`) | Stock-fact intent **after** funnel complete | Single-shot, <50 ms | None |
| 8 | Portfolio overlap (`/portfolio-overlap`) | Q8 voice or click | Single-shot, <100 ms | None |
| 9 | Process Q&A lookup | `info_process_field` intent or topic-panel click | Single-shot, in-memory | None |
| 10 | Fund Q&A lookup | `info_fund_field` intent or category-panel click | Single-shot, in-memory | None |
| 11 | Snapshot cache | First `/screen/snapshot` or `/apply-filter` after cold start | Refreshes every 60 s; single-flight | None |
| 12 | Narration queue | Each `narrate(text)` call from the dispatcher | Drained serially; 1.5 s pause between echoes | Tavus persona TTS (ElevenLabs) |
| 13 | Tavus persona TTS | Each `conversation.echo` Daily app-message | Server-side at Tavus, ~100–300 ms latency | ElevenLabs (billed via Tavus) |
| 14 | Auth heartbeat | User signed in to dashboard | Every 15 min for the session lifetime | None |
| 15 | Rate limiter | Every public API request | Per-process, in-memory, sweeps at 10 K buckets | None |

---

## Stream 1 — Tavus avatar (WebRTC)

**What it is:** A continuous Daily.co room hosting Tavus's replica video + audio. The replica idles silently when no echoes are queued and lip-syncs to ElevenLabs audio when echoes fire.

**Triggered by:** `startSession()` in `components/screen/screen-page.tsx`, which itself is wired to the *Start Screening* button.

**Lifecycle:**
1. `POST /api/v1/demo/tavus` creates a Tavus conversation server-side (rate-limited 5/min, 20/hour).
2. The response carries a Daily room URL.
3. `useTavusAvatar()` dynamically imports `@daily-co/daily-js`, joins the room, captures the replica's `MediaStream`.
4. `<AvatarVideo>` paints the stream into a `<video>` element.
5. The session stays open until either:
   - The tab unloads — a `pagehide` listener fires `fetch(..., { keepalive: true })` to `DELETE /api/v1/demo/tavus/[id]` so the conversation closes server-side and stops billing.
   - `disposeAvatar()` is called explicitly (e.g. on a hard reset).
6. **One-shot reconnect** on `participant-left` or post-ready `left-meeting`. Guarded by `reconnectAttemptedRef` so a flaky connection can't loop billable session creates.

**Where it lives:** `src/demo/use-tavus-avatar.ts` (~480 lines).

**Observability:** Every Tavus app-message is forwarded to the dev console as `[tavus] event: conversation.X`. The status state (`idle | initializing | ready | speaking | error`) drives the AvatarVideo overlay.

---

## Stream 2 — Voice listener (continuous mic capture)

**What it is:** A browser-side amplitude-VAD over `AudioContext` + `ScriptProcessorNode`. Continuously samples mic input, detects when the user has been silent for `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS` (default 1 s), then emits a PCM blob.

**Triggered by:** The mic toggle button in the bottom-left rail (Mic / MicOff icon).

**Active while:** the toggle is on. Pauses while Pep is speaking (`tavusAvatar.status === "speaking"`) so the avatar's voice doesn't get re-transcribed.

**Pipeline within the stream:**
1. `getUserMedia({ audio })` → `AudioContext.createMediaStreamSource()`.
2. `ScriptProcessorNode.onaudioprocess` accumulates mono `Float32Array` chunks.
3. RMS amplitude threshold detects "speaking" vs "silent".
4. On silence-after-speech, the buffer is converted to 16-bit PCM and passed to `ask(transcribedText?)` with the multipart form upload.

**Where it lives:** `src/demo/use-voice-listener.ts`.

**Cost:** None (purely client-side). The expensive part — STT — only fires on flush (Stream 3).

---

## Stream 3 — Speech-to-text

**What it is:** ElevenLabs `scribe_v1` ASR called via `transcribePcm()`.

**Triggered by:** `POST /api/v1/screen/process` with multipart/form-data (PCM blob + sample rate).

**Active during:** A single request. 12 s upstream timeout — if ElevenLabs is slow, the route returns a fast error and the user sees a retry prompt rather than the demo freezing.

**Where it lives:** `src/screen/stt.ts`.

**Cost:** ~$0.30 / hour of audio. A typical 3 s utterance is ~$0.0003.

**Bypass:** The chat-box text input skips this stream entirely — it sends `application/json` with the text already typed.

---

## Stream 4 — Intent classification

**What it is:** A two-tier classifier that turns transcribed text into a typed `Intent` union.

**Triggered by:** `matchScreenIntent(text)` inside `/api/v1/screen/process`, after STT (or directly for chat-box input).

**Active during:** A single request. Rule layer is sub-millisecond; classifier fallback has a 5 s budget.

**Two passes:**

1. **Rule layer** (`src/screen/intent-rules.ts`) — deterministic, ordered:
   - `RULES` — navigation, the six funnel filters (each with its own pattern + an "X filter" alias), Q7 daily-monitoring, Q8 portfolio overlap.
   - `matchFundInfoRule(text)` — fires only when a fund name is detected.
   - `matchProcessInfoRule(text)` — fires on a process-topic keyword (no name gate).
   - `POST_FUND_INFO_RULES` — generic stock-fact catch-alls and output preferences. Sit last so they don't hijack the more specific intents.
2. **Anthropic Haiku fallback** (`src/screen/screen-matcher.ts`) — fires only when no rule matches. Constrained-output prompt with a Zod schema validating the response. On schema mismatch or timeout, returns `{ kind: "fallback" }`.

**Where it lives:** `src/screen/intent-rules.ts` (~340 lines), `src/screen/screen-matcher.ts` (~190 lines).

**Cost:** Rule hits are free. Classifier hits cost ~$0.001 per call (~150 input + 30 output tokens at Haiku rates). Most pitch utterances hit rules.

---

## Stream 5 — Entity resolver

**What it is:** Pure ticker / company-name resolver. Two passes against the active snapshot's ticker set + name map.

**Triggered by:** `/api/v1/screen/process` enriches the intent — if `intent.kind === "info_stock_field" && !intent.ticker`, `EntityResolver.resolve(text)` runs.

**Active during:** A single intent classification, sub-millisecond.

**Two passes:**
1. **Ticker pass** — extract all uppercase 2–5 char tokens; intersect with the snapshot ticker set. Single match wins; multiple matches → ambiguous → null.
2. **Name pass** — bigram match on ≥4-char name tokens (catches "Commonwealth Bank" → CBA), single-token fallback on ≥6-char tokens with a stop-word list filtering common words like "limited" / "holdings" / "group".

**Where it lives:** `src/screen/entity-resolver.ts`.

**Cache:** Keyed by snapshot id; refreshed automatically when the active snapshot changes.

---

## Stream 6 — Filter engine (`/apply-filter`)

**What it is:** A stateless POST that runs one filter against an optional ticker subset and returns the new stage.

**Triggered by:**
- Voice: `apply_filter` intent dispatched from any of the six per-filter rule patterns.
- Click: *Next filter →* button, or any pending step in the funnel rail (filters can run out of sequence).

**Active during:** Single request. ~50 ms typical: load rows from the snapshot cache, run the filter (pure JS), serialise the response.

**Out-of-order behaviour:** `applyFilter(filterId)` always operates on `currentStage.tickers` regardless of where `filterId` sits in the canonical sequence. The pending list in screen-page.tsx is computed by filtering the canonical sequence to exclude already-completed stages, so an out-of-order application correctly removes the just-applied filter from `pending`.

**Where it lives:** `app/api/v1/screen/apply-filter/route.ts` + `src/screen/funnel.ts` (engine) + `src/screen/use-screener.ts` (client hook with `applyInFlightRef` race guard).

---

## Stream 7 — Stock-fact lookup (`/stock-fact`)

**What it is:** Resolves a ticker → a snapshot field projection (price, market cap, earnings status).

**Triggered by:** Three entry points, all sharing the same funnel-complete gate (`isStockLookupGated = mode === "screening" && pending.length > 0`):

1. **Voice / chat `info_stock_field` intent** — classified by the rule layer or filled in by the entity resolver in the `/process` route, then handled in the dispatcher case.
2. **Bare-name fallback in `/process`** — when classification falls back to `fallback`, the route runs the entity resolver one more time; a unique hit becomes `info_stock_field` and re-enters path #1 in the dispatcher.
3. **Row click in the StocksTable** — the `selectStock` callback is wired to `onTickerClick`. Same gate, same `describeStockFactGatedByFunnel(ticker)` response when the funnel is incomplete.

When the gate is closed mid-funnel, all three paths narrate a confirmation that names the requested stock (e.g. *"Let's finish the screen first — I'll have BHP's details ready once all the filters have run"*) so the audience knows Pep heard them.

**Active during:** Single request, <50 ms. Reads from the in-process snapshot cache.

**Where it lives:** `app/api/v1/screen/stock-fact/route.ts`, `src/screen/market-data-provider.ts` (`SnapshotMarketDataProvider`), `components/screen/stock-fact-panel.tsx` (UI), `components/screen/screen-page.tsx` (`selectStock`, dispatcher case).

**Future:** A `LiveMarketDataProvider` could implement the same `MarketDataProvider` interface to swap in a real-time price feed (D3 — currently snapshot-only).

---

## Stream 8 — Portfolio overlap (`/portfolio-overlap`)

**What it is:** Single DB read against `oc_holdings` + a Set intersection against the current shortlist.

**Triggered by:** `info_portfolio_overlap` intent (Q8) — fires when the user asks "how many of my holdings still meet the criteria" or similar.

**Active during:** Single request, <100 ms.

**Returns:** `{ matching, nonMatching, totalHoldings, isSample }` so the narration can be honest about the sample-portfolio caveat.

**Where it lives:** `app/api/v1/screen/portfolio-overlap/route.ts`.

---

## Stream 9 — Process Q&A lookup

**What it is:** In-memory lookup against `data/process-qa.json` (12 topics).

**Triggered by:** Two paths:
- Voice / chat: `info_process_field` intent, dispatched from `matchProcessInfoRule` matching a process-topic keyword.
- Click: any topic button in the Process Q&A panel — bypasses `/process` (no STT, no classifier) by dispatching the intent directly.

**Active during:** Synchronous, in-memory — sub-millisecond.

**Where it lives:** `src/screen/process-qa.ts` (loader + accessors), `data/process-qa.json` (content), `components/screen/screen-page.tsx` `askAboutTopic()` (click path).

---

## Stream 10 — Fund Q&A lookup

**What it is:** In-memory lookup against `data/fund-qa.json` (3 funds × 21 categories).

**Triggered by:** Two paths:
- Voice / chat: `info_fund_field` intent, only fires from `matchFundInfoRule` when a fund name is present (so "what are the fees" mid-screening doesn't get hijacked).
- Click: any category button in the Fund Q&A panel — also dispatches the intent directly without an STT round-trip. The active fund is taken from the picker.

**Active during:** Synchronous, in-memory — sub-millisecond.

**Where it lives:** `src/screen/fund-qa.ts` (loader + accessors), `data/fund-qa.json` (content), `components/screen/screen-page.tsx` `askAboutCategory()` (click path).

---

## Stream 11 — Snapshot cache

**What it is:** A process-singleton holding the active ASX snapshot in two projections (a wide `SecurityForClient[]` for the UI and a narrow `Map<ticker, FilterableSecurity>` for filter input).

**Triggered by:** First request to `/api/v1/screen/snapshot` or `/api/v1/screen/apply-filter` after process cold-start, or after the 60 s TTL expires.

**Active during:** Permanent within a process. Single-flight — concurrent cache misses share one in-flight Promise so a thundering herd doesn't multi-load.

**Edge fronting:** `/api/v1/screen/snapshot` ships with `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=3600`, so Vercel's edge fronts repeated demo sessions across instances without further config.

**Where it lives:** `src/screen/snapshot-cache.ts`.

---

## Stream 12 — Narration queue

**What it is:** A `Promise<void>` chain that serialises Tavus echoes so a rapid second narration doesn't trample the in-flight one.

**Triggered by:** Every `narrate(text)` call from the dispatcher.

**Active during:** Drains serially. Each link awaits `tavusAvatar.echo(text)` (which itself resolves on `stopped_speaking` or a `~55ms/char + 1s` fallback) then sleeps `INTER_NARRATION_PAUSE_MS = 1500` before releasing. The pause lets the WebRTC client buffer drain past Tavus's `stopped_speaking` event on long lines.

**Behavioural rules:**
- The final filter's narration is concatenated with the follow-up prompt into a single echo, not two — Tavus's `stopped_speaking` was firing before the audio drained on long final-filter lines.
- The intro narration sets `setIntroSpoken(true)` only **after** the queue resolves so the rail's "Introduction" tick doesn't flip green before Pep finishes the line. Same pattern for the universe stage and Process Q&A intro.

**Where it lives:** `components/screen/screen-page.tsx` `narrate()` callback + `narrationQueueRef`.

---

## Stream 13 — Tavus persona TTS

**What it is:** Pep's voice. Persona is configured `pipeline_mode: "echo"` with `tts_engine: "elevenlabs"` + our cloned `external_voice_id` + a copy of our `ELEVENLABS_API_KEY`. When we send a `conversation.echo` Daily app-message, Tavus runs the text through ElevenLabs server-side and streams the audio to the replica.

**Triggered by:** Every `tavusAvatar.echo(text)` call.

**Active during:** Server-side at Tavus + ElevenLabs. Latency is ~100–300 ms before `started_speaking` fires; total speech length scales with text length.

**Where the configuration lives:** Set up via `bun scripts/create-tavus-echo-persona.ts` + the `PATCH /v2/personas/<id>` step documented in [TAVUS-PERSONA-SETUP.md](./TAVUS-PERSONA-SETUP.md). At runtime the persona id is read from `NEXT_PUBLIC_TAVUS_PERSONA_ID`.

**Cost:** ElevenLabs TTS at `eleven_turbo_v2_5` rates — ~$0.30 per 1 K chars on the Creator plan. A 30-min pitch with ~50 utterances at ~100 chars each ≈ $1.50.

---

## Stream 14 — Auth heartbeat

**What it is:** Periodic ping that keeps the user's `user_sessions` row alive.

**Triggered by:** A signed-in user on the dashboard / settings surface. Fires every 15 minutes via `setInterval`, plus once on page focus.

**Active during:** Lifetime of the dashboard tab. Not relevant to the public Pep demo (which has no auth).

**Where it lives:** `src/auth/provider.tsx` (`AuthProvider`), `app/api/v1/user/sessions/[id]/heartbeat`.

---

## Stream 15 — Rate limiter

**What it is:** An in-memory sliding-window per-key limiter. Per call, checks a list of `{limit, windowMs}` rules and throws `TooManyRequestsError` (429) on the first full window, with a `Retry-After` second hint.

**Triggered by:** Every public-demo API call.

**Active during:** The whole process lifetime. Buckets prune stale entries on each call (longest-window cutoff), and a 10 000-bucket cap triggers a `sweep()` that drops the half with the oldest `lastSeen`.

**Limits in effect:**
| Route | Per-minute | Per-hour |
|---|---|---|
| `POST /api/v1/screen/process` | 30 | 200 |
| `POST /api/v1/demo/tavus` | 5 | 20 |
| `DELETE /api/v1/demo/tavus/[id]` | 30 | 100 |
| `POST /api/v1/screen/portfolio-overlap` | 60 | 600 |

**Where it lives:** `src/server/rate-limit.ts`. Single-process by design; for horizontal scale swap the bucket store for Redis or use Vercel edge rate limiting.

---

## When each stream is active — by mode

| Mode | Streams active *idle* | Streams active *during user input* |
|---|---|---|
| **Pre-start** (landing → /demo/screen, before *Start Screening*) | None of streams 1–13 | — |
| **Screening** | 1 (Tavus), 2 (mic if toggled), 11 (snapshot cache), 15 (rate limiter) | 3 STT → 4 classifier → 5 resolver (if stock-fact) → 6 filter / 7 stock-fact / 8 overlap / 9 process Q&A / 10 fund Q&A → 12 narration queue → 13 TTS |
| **Process Q&A** | 1, 2 (if mic), 11, 15 | 3 → 4 → 9 → 12 → 13 (or click → 9 directly) |
| **Fund Q&A** | 1, 2 (if mic), 11, 15 | 3 → 4 → 10 → 12 → 13 (or click → 10 directly) |
| **Dashboard** (signed-in) | 14 (heartbeat) | Auth-shell CRUD |

---

## Failure-mode cross-reference

| Symptom | Streams to inspect | First place to look |
|---|---|---|
| Avatar appears but doesn't speak | 12 (narration queue), 13 (TTS), 1 (Tavus session) | Browser console for `[tavus] event` lines; check echoResolveRef isn't stuck |
| Voice ignored | 2 (listener), 3 (STT), 15 (rate limit) | Mic permission; `/screen/process` 429s |
| "I'm not sure which stock that is" mid-funnel | 4 (intent miss), 5 (resolver miss), 7 (gate) | Likely a rule-layer miss routing to `info_stock_field`; check `intent-rules.ts` patterns |
| Stale stock prices | 11 (snapshot cache), 7 (stock-fact) | Snapshot date in `SourceBadge`; re-ingest if needed |
| Out-of-order filter clicks behave weirdly | 6 (filter engine) | `pending` computation in screen-page.tsx — should filter by completedStageIds |
| Pep speaks the wrong voice | 13 (TTS) | Persona's `layers.tts.tts_engine` reverted — re-PATCH per TAVUS-PERSONA-SETUP.md |
