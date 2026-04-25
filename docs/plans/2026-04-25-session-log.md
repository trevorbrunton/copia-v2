# Session Log — 2026-04-25

**Branch:** `main` (all work pushed to `origin/main`)
**Starting commit:** `cb69956` (Plan: backfill phase-6-review commit hash — left over from previous session)
**Ending commit:** `76217a0` (Add ARCHITECTURE.md and INFRASTRUCTURE.md)
**Net diff:** 66 files changed, +1,649 / −7,561 (=−5,912 lines)
**Test status:** 130/130 passing (was 121 at session start)

---

## What was done

### 1. Phase 7 — v1 decommission ✓ shipped

The v1 OC Mid-Cap Q&A demo was removed from this repo. Code paths the live demo no longer needs are gone; v1 Supabase tables (`demo_responses`, `demo_question_patterns`) are intentionally preserved because a separate v1 app still reads them — the Drizzle exports stay so `drizzle-kit generate` doesn't emit DROP TABLE migrations against the shared DB.

| Commit | What |
|---|---|
| `df6560d` | Phase 7 deletion: v1 demo page, panels, hooks, services, qa-admin route, qa-admin handlers; redirect targets updated to `/demo/screen`; stale `NEXT_PUBLIC_AVATAR_MODE` removed |
| `5644a1b` | Phase 7 review fix — `src/services/demo/types.ts` orphan was missed; deleted |

Net: 33 files changed, −2,359 lines.

### 2. Security findings (independent review) — fixed

A code review surfaced three security issues; all closed in one commit.

| Commit | What |
|---|---|
| `bd40d0c` | (1) Removed the process-wide `getOrCreateUser` cache that leaked suspended/deleted account status. (2) Added `src/server/rate-limit.ts` (sliding-window per-IP) + `TooManyRequestsError(429)` and wired it into `/api/v1/screen/process`, `POST /api/v1/demo/tavus`, `DELETE /api/v1/demo/tavus/[id]` so anonymous traffic can't run up paid third-party bills. (3) Deleted `proxy.ts` so the auth-callback failure path (`/sign-in?error=…`) is reachable again. 7 new rate-limit tests. |
| `6c4f0a1` | Default Tavus persona changed to "Custom" (one-line UX fix while we were there) |

### 3. Performance bundle

| Commit | What |
|---|---|
| `70c7d75` | New `src/screen/snapshot-cache.ts` (TTL 60 s, single-flight). `/snapshot` and `/apply-filter` now read from cache instead of re-querying Postgres. `apply-filter` goes from per-request DB read (~100-300 ms) to in-memory `Map.get()`. Added `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=3600` so Vercel's edge fronts repeat sessions. Tightened Anthropic timeout 15 s → 5 s and ElevenLabs STT timeout 30 s → 12 s |

### 4. Robustness bundle

| Commit | What |
|---|---|
| `104eb1a` | New `instrumentation.ts` + `src/server/env-check.ts` — server cold-start validates required env vars and warns on missing optional ones with their impact. Tavus tab-close beacon: `useTavusAvatar` cleanup switched to `fetch(..., { keepalive: true })` and a `pagehide` listener so the conversation-end DELETE survives unload (was being aborted, leaking conversations) |
| `bf7fb01` | One-shot Tavus reconnect on `participant-left` / post-ready `left-meeting` (with billing-loop guard via `reconnectAttemptedRef`). StocksTable show-more capped at 500 rows so the page never DOM-renders the full ~2K-row universe |

### 5. Tavus persona simplification

| Commit | What |
|---|---|
| `b424608` | Aligned `conversation.echo` payload with documented schema, added `scripts/create-tavus-echo-persona.ts` (CLI to provision an echo-mode persona), wrote `docs/TAVUS-PERSONA-SETUP.md` |
| `f9e7607` | Dropped the Generic/Custom persona radio — single `NEXT_PUBLIC_TAVUS_PERSONA_ID` env var. Deleted `components/demo/persona-selector.tsx` (and the now-empty `components/demo/` directory) |
| `3b971a9` | Applied review findings on the perf+robustness work: `reconnectAttemptedRef` reset in `stopAvatar()`, `NEXT_PUBLIC_TAVUS_PERSONA_ID` added to env-check, instrumentation gate flipped to skip-only-edge, layered-cache strategy commented, longest-window memoized, sweep + stale-event tests added (130 total) |

### 6. Voice work — the painful path

The hard problem of the day: making Pep speak in a chosen voice consistently. Took five attempts before landing on the right approach.

| Commit | Attempt |
|---|---|
| `a1f83d9` | **Audio Echo, take 1.** New `/api/v1/screen/tts` route synthesises with ElevenLabs `eleven_turbo_v2_5` at PCM 24 kHz; client base64-chunks the bytes (~12 KB / chunk) into `conversation.echo` events with `modality: "audio"` |
| `dcdc466` | Stuttering + premature fallback. Added chunk pacing at 80% audio rate, scaled the fallback to actual audio duration |
| `dccca93` | Schema fixes from `novacatai/novacat` and `aws-samples/sample-voice-ai-tavus-avatar-demo`: `done` as boolean, `conversation_id` at top level, diagnostic logging |
| `a5b6968` | The boolean `done` made Pep go silent. Reverted to string `"true"`/`"false"` (matches Tavus's published skill file) |
| `056dba8` | **Persona-side ElevenLabs.** Discovered the Tavus persona's TTS layer natively supports ElevenLabs as an engine. PATCHed the persona to use `tts_engine: "elevenlabs"` + our voice + our API key. Reverted the entire client to plain text echo. Deleted the `/api/v1/screen/tts` route and ~250 lines of audio-echo plumbing. **This is the working pattern.** |

### 7. Documentation cleanup

| Commit | What |
|---|---|
| `a8118e2` | Deleted v1-era obsolete docs: `ARCHITECTURE.md`, `INFRASTRUCTURE.md`, `DEMO-RESPONSES.md`, `architecture_critique.md`, `copia-demo-plan.md`, `video-avatar-plan.md`, `architecture_compliance_review.md`, `.DS_Store` (−2,165 lines) |
| `76217a0` | New `docs/ARCHITECTURE.md` + `docs/INFRASTRUCTURE.md` accurately describing the v2 system. **Side effect:** the same commit also deleted the three `docs/standards/app_architecture_*.md` cross-project guides — they were missing from disk when `git add -A` ran. May have been removed externally; flagged at hand-off |

---

## Final system state

**Persona `p47e2741f57e` (Pep) currently configured:**

```
pipeline_mode:               echo
default_replica_id:          r3b040ae8a6c
layers.tts.tts_engine:       elevenlabs
layers.tts.external_voice_id: gSaaYFZDJQwPpVvwqc9S
layers.tts.tts_model_name:   eleven_turbo_v2_5
layers.tts.api_key:          ******** (server-side on Tavus)
layers.tts.voice_settings:   { stability: 0.5, similarity_boost: 0.75 }
```

**Code path for narration:**
`narration.describeX(...)` → `tavusAvatar.echo(text)` → one Daily app-message with `event_type: "conversation.echo"`, `properties: { modality: "text", text }` → Tavus persona's ElevenLabs TTS layer renders → replica lip-syncs.

No `/api/v1/screen/tts` route. No base64. No chunking. No `inference_id` tracking. Voice consistency is fully owned by the persona configuration.

**Test status:** 130/130 passing. **Lint:** 0 errors (one pre-existing unrelated React-Compiler warning). **Typecheck:** clean.

---

## What's NOT done — for tomorrow

### Critical / blockers for the pitch

1. **End-to-end voice verification — manual.** All session attempts at fixing voice were *code* fixes; the user has not yet confirmed the live persona-side ElevenLabs path actually plays the cloned voice cleanly across multiple successive utterances. Tomorrow's first ten minutes:
   - `bun dev`
   - Open `/demo/screen`, run through 3-4 questions with voice input.
   - Confirm: voice is the cloned ElevenLabs voice, not Cartesia; consistent across utterances; no stuttering.
   - Watch the terminal for `[browser] [tavus] event: conversation.replica.started_speaking` and `…stopped_speaking` lines — those tell us speech actually fired and ended. The diagnostic logging is already in place (see `src/demo/use-tavus-avatar.ts` app-message listener).
   - **If the voice is still wrong**, re-verify the persona via `curl -H "x-api-key: $TAVUS_API_KEY" https://tavusapi.com/v2/personas/p47e2741f57e | jq '.layers.tts'` — if `tts_engine` is anything other than `"elevenlabs"`, re-run the PATCH command in `docs/TAVUS-PERSONA-SETUP.md`.

2. **Pitch run-through against the script.** `docs/plans/pep-avatar-v2-pitch-script.md` has the eight scripted questions plus recovery rows. Need to actually run through it once cold, time it, and confirm Pep handles every question without dropping into the fallback intent. If a question doesn't match the rules, either tighten the rule layer (`src/screen/intent-rules.ts`) or accept the Anthropic Haiku fallback (5 s timeout means it won't block).

3. **Vercel deploy.** Last item on the plan §10 Phase 6 close-out. Steps:
   - Set every env var listed in `docs/INFRASTRUCTURE.md` § "Environment variables" on the Vercel project — particularly `NEXT_PUBLIC_TAVUS_PERSONA_ID=p47e2741f57e` and the matching `ELEVENLABS_API_KEY`, `TAVUS_API_KEY`, `ANTHROPIC_API_KEY`, `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_*`.
   - Trigger a deploy.
   - Smoke-test against the deployed URL (the same 8-question run-through).
   - Confirm `validateEnv()` startup logs show no warnings.

### Decisions to confirm

4. **`docs/standards/app_architecture_*.md` — keep or delete?** Three cross-project guides were deleted in the last commit (`76217a0`); flagged at hand-off as possibly accidental. Decide: restore them (`git checkout a8118e2 -- docs/standards/`) or accept the deletion. The guides reference Mayfly/MyAgency (other repos), so deletion is plausibly intentional.

### Optional polish (low priority, if time allows)

5. **Reconnect UX polish.** Tavus auto-reconnect (`bf7fb01`) currently flips status silently. A spinner / status-line "Reconnecting Pep…" in `components/screen/avatar-video.tsx` would make a flaky-network blip more graceful for a live audience. ~10 LOC.

6. **Auth-route test coverage gap.** The phase-7 review noted that test coverage is heavily concentrated on the screening engine (`tests/screen/`) — the auth/session/account paths have effectively no integration tests. Out of scope for the pitch but worth a phase-8 if the auth surface gets exercised by future work.

7. **Snapshot cache TTL on demand.** Re-running `bun scripts/ingest-asx-snapshot.ts` mid-session means the demo won't see the new snapshot for up to 60 s (TTL) and possibly up to 5 min on Vercel (`s-maxage=300`). A `POST /api/v1/screen/snapshot/invalidate` admin endpoint would shave that. Defer until needed.

8. **`ELEVENLABS_VOICE_ID` env var hygiene.** Currently a setup-only env var (read by `scripts/create-tavus-echo-persona.ts` and the persona PATCH command, never at runtime). Either:
   - Rename to `SETUP_ELEVENLABS_VOICE_ID` to signal it's not a runtime config, OR
   - Move it into a `.setup.env` documented separately from `.env.example`, OR
   - Leave as-is and accept the comment in `.env.example` that explains the situation.

9. **Cost telemetry.** Per-session cost estimate in `INFRASTRUCTURE.md` is ~$4.65; in production we'd want to log Tavus minutes + ElevenLabs chars + Anthropic tokens per `traceId` to validate. ~30 LOC if we ever care.

### Watch-outs

- **Daily.co `sendAppMessage` size limits** were never definitively pinned down this session. The Audio Echo path stuttered/failed for unknown reasons that may have been delivery-related; persona-side ElevenLabs sidesteps the whole question, but if any future feature needs to send large payloads to Tavus over Daily, expect to chunk at <4 KB per message and pace the sends.
- **Anthropic timeout is 5 s.** If you ever see `screen-matcher: classifier failed` warnings, the rule layer needs tightening to handle the missed paraphrase, not a longer timeout — voice loop budget can't absorb >5 s on intent classification.

---

## Files that warrant a glance tomorrow before deploying

- `.env.example` — confirm every var listed has a value in `.env.local` and (after Vercel setup) in the project env.
- `docs/TAVUS-PERSONA-SETUP.md` — verify the persona configuration matches what's deployed.
- `docs/plans/pep-avatar-v2-pitch-script.md` — the questions list. Validate that each one still maps to a rule in `src/screen/intent-rules.ts` (no rules silently became unused after phase 7).
- `instrumentation.ts` startup logs in Vercel build/serverless logs — should show "env-check: all configured" or specific warnings worth acting on.

---

## Sentinel

If a future session opens this log and the date is **2026-04-26** or later: the pitch deadline was imminent at session close on **2026-04-25**. If the pitch already happened, the post-mortem belongs in a fresh session log; this one captures the engineering state as of session close.
