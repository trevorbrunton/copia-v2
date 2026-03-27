# Tavus Processing Flow — Architecture Critique

## Overview

This document reviews the Tavus CVI (Conversational Video Interface) processing flow in the investor demo, evaluating simplicity, efficiency, and areas for improvement.

## Current Flow Summary

The processing pipeline is selected by `NEXT_PUBLIC_PROCESSING_MODE`:

**Flash pipeline** (`NEXT_PUBLIC_PROCESSING_MODE=flash`) — single external API call:
```
User speaks
  → VAD (client-side, 1000ms silence timeout)
  → POST /api/v1/demo/process (PCM → WAV → Gemini 2.5 Flash: STT + classification in one call)
  → tavusAvatar.echo(answerText)
  → Tavus replica speaks with lip-sync
```

**Default pipeline** (`NEXT_PUBLIC_PROCESSING_MODE=default`) — two external API calls:
```
User speaks
  → VAD (client-side, 1000ms silence timeout)
  → POST /api/v1/demo/process (PCM → WAV → ElevenLabs STT → Bedrock Haiku classifier)
  → tavusAvatar.echo(answerText)
  → Tavus replica speaks with lip-sync
```

Both pipelines use the same client code and return the same response shape. The branching is entirely server-side. The Tavus mode uses the "local pipeline" — voice capture happens client-side, then a single server round-trip handles transcription and question classification. Tavus is used purely as a talking-head renderer via its echo protocol.

---

## Why Tavus Echo (Not Full CVI or Pre-Recorded Video)

The demo requires **pre-approved, exact responses** for each question category — the avatar must say precisely what was written, not an LLM improvisation. This rules out Tavus's built-in conversational AI.

Pre-recorded MP4 clips were tried (the haiku/video modes) but produce visible jumps between clips — the avatar's head position, expression, and lighting don't match across segments, breaking the illusion of a continuous conversation.

Tavus echo solves both problems: it delivers a **single continuous WebRTC video stream** with **real-time lip-sync driven by exact pre-approved text**. The architecture deliberately uses only the echo subset of Tavus CVI because that's the capability that matters — seamless visual continuity over controlled content.

---

## What Works Well

### 1. Clean separation of concerns
The hook layering is sound: `useVoiceListener` → `useDemo` → `useTavusAvatar`. Each hook owns a clear responsibility. The orchestration in `useDemo` reads linearly.

### 2. Graceful degradation
If Tavus init fails, the system falls back to audio-only mode. If `echo()` fails, it falls back to cached audio. This is good resilience for a demo.

### 3. Server-side API key isolation
The `TAVUS_API_KEY` never reaches the client. The server creates the conversation and only returns the Daily.co room URL. Correct pattern.

### 4. Dynamic SDK import
`@daily-co/daily-js` is dynamically imported to avoid SSR issues. Appropriate for a Next.js app.

### 5. Continuous stream eliminates visual cuts
Unlike the video/haiku modes (which swap MP4 `src` and produce jarring transitions), the Tavus WebRTC stream is a single persistent connection. The avatar is always "live" — echo just changes what it says. No flicker, no head-position jumps, no lighting mismatches.

---

## Issues Fixed

### 1. ✅ Missing DELETE endpoint — conversations are now cleaned up server-side
**Files:** `app/api/v1/demo/tavus/[conversationId]/route.ts`, `src/demo/use-tavus-avatar.ts`

Previously, `stopAvatar()` called `DELETE /api/demo/tavus/{conversationId}` but no handler existed, so orphaned conversations ran until Tavus's idle timeout.

**What changed:** Added `DELETE /api/v1/demo/tavus/[conversationId]` route that calls `DELETE https://tavusapi.com/v2/conversations/{id}` with the API key. Also added cleanup on component unmount so conversations end even if the user closes the tab without disconnecting.

### 2. ✅ Single round-trip per user utterance
**Files:** `app/api/v1/demo/process/route.ts`, `src/demo/use-demo.ts`

Previously, every user question made two sequential API calls (`POST /transcribe` then `POST /match`), adding an extra network round-trip of ~1-2 seconds.

**What changed:** Added unified `POST /api/v1/demo/process` endpoint that does transcribe → match server-side in one call. Updated `use-demo.ts` to call the new endpoint. The old `/transcribe` and `/match` endpoints remain available for other modes.

### 3. ✅ Speech-end detection pinned to documented events
**File:** `src/demo/use-tavus-avatar.ts`

Previously, speech completion was detected by shotgun pattern-matching four different event type strings (`utterance_end`, `echo_end`, `response_end`, `stopped_speaking`).

**What changed:** Pinned to the two documented Tavus CVI events: `conversation.echo_end` and `conversation.utterance_end`. The fallback timeout remains as a safety net.

---

## Improvements Worth Considering

### 4. 60-second stream-ready timeout is too long
**File:** `src/demo/use-tavus-avatar.ts:77-93`

The user stares at a spinner for up to 60 seconds waiting for the replica's video track. Tavus replicas typically connect in 5-15 seconds. A 60-second timeout wastes a full minute on a broken connection before failing.

**Suggestion:** Reduce to 30 seconds. Add intermediate feedback (e.g., "Still connecting..." at 10s, "This is taking longer than usual..." at 20s).

### 5. Redundant hooks always instantiated
**File:** `src/demo/use-demo.ts:72-73`

```typescript
const avatar = useAvatar();       // HeyGen LiveAvatar — unused in tavus mode
const tavusAvatar = useTavusAvatar(); // Tavus CVI — unused in live mode
```

Both hooks plus the ElevenLabs `useConversation()` hook (line 187) are always instantiated regardless of mode, due to React's hook ordering rules. They set up state and refs that go unused.

**Suggestion:** Restructure the component tree so different mode components mount different hooks, or create a single `useAvatarRenderer` facade that branches internally.

### 6. `console.log` used extensively in production code
**Files:** `use-tavus-avatar.ts`, `use-demo.ts`

The codebase has a proper structured logger (`src/lib/logger.ts`) but the demo hooks use raw `console.log` / `console.warn` throughout. These will appear in production browser consoles.

**Suggestion:** Gate behind a `DEBUG` flag or remove once the Tavus integration is stable.

### 7. `ScriptProcessorNode` is deprecated
**File:** `src/demo/use-voice-listener.ts`

The voice listener uses `ScriptProcessorNode` for real-time audio processing, which is deprecated in the Web Audio API. It works today but will eventually be removed.

**Suggestion:** Migrate to `AudioWorkletNode` when time permits. Not urgent.

### 8. The 200ms `setTimeout` yield is a code smell
**File:** `src/demo/use-demo.ts:431-432`

```typescript
await new Promise((r) => setTimeout(r, 200));
```

This waits for React to flush state so the `<video>` element is wired up before the greeting plays. Fragile — dependent on React batching timing.

**Suggestion:** Use a ref callback or `useEffect` that resolves a promise when the video element is ready.

---

## Architecture Comparison: Modes at a Glance

| Concern | Video/Haiku | Live (HeyGen) | **Tavus** | Audio |
|---|---|---|---|---|
| Voice capture | VAD + STT | VAD + STT | **VAD + STT** | ElevenLabs agent |
| Classification | Bedrock Haiku | Bedrock Haiku | **Bedrock Haiku or Gemini Flash** | ElevenLabs agent |
| Response delivery | Pre-recorded MP4/MP3 | Pre-recorded PCM → lip-sync | **Text → echo lip-sync** | Pre-recorded MP3 |
| Visual continuity | Poor (clip jumps) | Good (continuous stream) | **Good (continuous stream)** | N/A |
| SDK stability | Native `<video>` | Fragile (private WS hack) | **Stable (Daily.co public API)** | N/A |
| Data over wire per response | MP4 download | ~300KB PCM download + upload | **~200 bytes of text** | MP3 download |
| External API calls per utterance | 2 | 2 | **1 (flash) or 2 (default)** | 0 |
| External services | ElevenLabs STT, Bedrock | ElevenLabs STT, Bedrock, HeyGen | **Gemini + Tavus (flash) or ElevenLabs STT + Bedrock + Tavus (default)** | ElevenLabs |

---

## Case for Deprecating Live (HeyGen) Mode

Tavus and Live both solve the visual continuity problem, but Tavus is the better fit for this use case on every axis that matters:

### 1. Bandwidth — text vs audio round-trip

Tavus echo sends a short text string (~200 bytes) and generates TTS + lip-sync internally. HeyGen LiveAvatar LITE requires the client to **download** pre-recorded PCM from CloudFront (~300KB per response), then **upload** it over WebSocket to HeyGen. That's two large transfers per response vs near-zero.

Pre-encoding the PCM as base64 on S3 would only save the trivial `btoa()` CPU cost — the client still has to download the inflated file (base64 is ~33% larger than raw PCM) and re-upload it over WebSocket.

### 2. No server-to-server shortcut exists

The obvious optimisation — send audio directly from CDN to HeyGen, bypassing the browser — is impossible. HeyGen LITE's only audio ingest path is the client's WebSocket session. There is no server-to-server API to say "play this URL against session X". The data path is locked to:

```
CDN → client browser → WebSocket → HeyGen LiveAvatar
```

Tavus echo avoids this entirely. The "heavy lifting" (TTS) happens inside Tavus's infrastructure:

```
Client sends text → Tavus generates speech + lip-sync internally
```

### 3. SDK stability

The HeyGen LITE SDK has a bug in `repeatAudio()` (incorrect base64 chunking), forcing the code to access the private `_sessionEventSocket` WebSocket directly (`use-avatar.ts:177`). Any SDK update could break this. Tavus uses Daily.co's public `sendAppMessage()` API — no private internals.

### 4. Recommendation

Deprecate Live (HeyGen) mode. Tavus echo is strictly better for this use case:
- Lower bandwidth per response (~200B vs ~600KB round-trip)
- No architectural bottleneck (text in vs audio shuttle through the browser)
- Stable public API (Daily.co vs private WebSocket hack)
- Same visual continuity (continuous WebRTC stream)

The `useAvatar` hook, the `/api/v1/demo/avatar` endpoint, and the HeyGen SDK dependency (`@heygen/liveavatar-web-sdk`) can be removed once Tavus is confirmed stable in production.

---

## Recommended Action Plan

In priority order:

1. ~~**Add the missing DELETE handler**~~ ✅ Done — `DELETE /api/v1/demo/tavus/[conversationId]`
2. ~~**Merge transcribe + match**~~ ✅ Done — `POST /api/v1/demo/process`
3. ~~**Pin the speech-end event**~~ ✅ Done — locked to `conversation.echo_end` and `conversation.utterance_end`
4. ~~**Add Gemini Flash pipeline**~~ ✅ Done — `NEXT_PUBLIC_PROCESSING_MODE=flash` uses Gemini 2.5 Flash for STT + classification in one call
5. ~~**Reduce VAD silence timeout**~~ ✅ Done — reduced from 1500ms to 1000ms, configurable via `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS`
6. **Reduce stream-ready timeout** to 30s with progressive feedback
7. **Deprecate Live (HeyGen) mode** — remove `useAvatar`, `/api/v1/demo/avatar`, and `@heygen/liveavatar-web-sdk` dependency
8. **Clean up remaining dead code** — ElevenLabs agent pipeline, unused hooks, video/haiku mode code (if no longer needed)

---

## Processing Pipeline Comparison

| | Default (ElevenLabs + Bedrock) | Flash (Gemini) |
|---|---|---|
| External API calls | 2 (STT then classifier) | 1 (single multimodal call) |
| Services | ElevenLabs, AWS Bedrock | Google Gemini |
| Latency | STT + classifier sequentially | Single inference |
| Env vars needed | `ELEVENLABS_API_KEY`, `AWS_*`, `BEDROCK_MODEL_ID` | `GEMINI_API_KEY` |
| Configuration | `NEXT_PUBLIC_PROCESSING_MODE=default` (or unset) | `NEXT_PUBLIC_PROCESSING_MODE=flash` |
| STT quality | ElevenLabs Scribe (very good) | Gemini native (good) |
| Classification | Claude Haiku (temperature 0) | Gemini Flash (temperature 0, JSON mode) |

The Flash pipeline reduces external dependencies from 2 services to 1 and eliminates the sequential latency of two separate API calls. The client code is unchanged — both pipelines return the same response shape from `POST /api/v1/demo/process`.

---

## Latency Budget

Estimated end-to-end latency from user finishing speech to avatar starting to speak:

| Phase | Before | After | Saving |
|---|---|---|---|
| VAD silence timeout | 1500ms | 1000ms | **500ms** |
| Network: client → server | ~50ms | ~50ms | — |
| STT (ElevenLabs) | ~800-1500ms | ~800-1500ms (default) or 0ms (flash) | — |
| Network: server → Bedrock | ~100ms | ~100ms (default) or 0ms (flash) | — |
| Classification (Bedrock Haiku) | ~300-500ms | ~300-500ms (default) or 0ms (flash) | — |
| Gemini Flash (STT + classify) | N/A | ~1000-2000ms (flash only) | — |
| Network: server → client | ~50ms | ~50ms | — |
| Network: second round-trip | ~200ms | 0ms | **200ms** |
| **Total (default pipeline)** | **~3000-3900ms** | **~2300-3200ms** | **~700ms** |
| **Total (flash pipeline)** | — | **~2100-3100ms** | **~900ms** |

The biggest single win is the VAD silence timeout reduction (500ms on every utterance). The merged endpoint saves ~200ms by eliminating a network round-trip. The Flash pipeline saves an additional ~200ms by running STT + classification in a single inference instead of sequentially.

The silence timeout is configurable via `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS`. Lower values feel snappier but risk cutting off mid-sentence pauses. 1000ms is a reasonable starting point — tune based on real user testing.

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `NEXT_PUBLIC_AVATAR_MODE` | No | `"audio"` | Avatar renderer: `"tavus"`, `"live"`, `"video"`, `"haiku"`, `"audio"` |
| `NEXT_PUBLIC_PROCESSING_MODE` | No | `"default"` | Processing pipeline: `"flash"` (Gemini) or `"default"` (ElevenLabs + Bedrock) |
| `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS` | No | `1000` | Milliseconds of silence before ending an utterance |
| `TAVUS_API_KEY` | For tavus mode | — | Tavus API key (server-side only) |
| `TAVUS_PERSONA_ID` | For tavus mode | — | Tavus persona ID |
| `TAVUS_REPLICA_ID` | No | `""` | Optional Tavus replica ID |
| `GEMINI_API_KEY` | For flash mode | — | Google Gemini API key |
| `GEMINI_MODEL` | No | `"gemini-2.5-flash"` | Gemini model ID |
| `ELEVENLABS_API_KEY` | For default mode | — | ElevenLabs API key |
| `AWS_REGION` | For default mode | `"ap-southeast-2"` | AWS region for Bedrock |
| `AWS_ACCESS_KEY_ID` | For default mode | — | AWS credentials |
| `AWS_SECRET_ACCESS_KEY` | For default mode | — | AWS credentials |
| `BEDROCK_MODEL_ID` | No | `"au.anthropic.claude-haiku-4-5-20251001-v1:0"` | Bedrock model ID |

---

## Avatar Platform Pricing Comparison

Pricing as of early 2025 — verify with vendors for current rates.

| Platform | Monthly Fee | Included Minutes | Overage/min | Text Input | WebRTC | Notes |
|---|---|---|---|---|---|---|
| **Tavus CVI** (current) | $59 Starter / $397 Growth | 100 / 1,250 | $0.37 / $0.32 | Yes (echo) | Yes (Daily.co) | 30s min charge, 6s increments. Echo and conversational bill the same. |
| **HeyGen Interactive Avatar** | ~$59-99/mo | Varies by plan | ~$0.04-0.10 | Yes | Yes | Different SDK from LITE. Pricing often negotiated. |
| **HeyGen LiveAvatar LITE** (current) | ~$72/mo (Business) | Credit-based | ~$0.50-1.00 | No (audio only) | Yes (LiveKit) | Contact sales for LITE rates. |
| **D-ID Agents** | $5.90 Lite / $49 Pro | Varies | ~$0.05-0.10 | Yes | Yes | Most transparent public pricing. Multiple TTS providers. |
| **Simli** | Pay-as-you-go | Trial minutes | ~$0.02-0.04 | Audio in (BYOTTS) | Yes | Cheapest per-minute. Bring your own TTS. |
| **Synthesia** | $22-67/mo | 10-30 min | N/A | Limited beta | Unclear | Focused on async video, not real-time interactive. |
| **NVIDIA Tokkio** | Enterprise only | Custom | Custom | Yes | Yes | No public pricing. |

### Cost Analysis for This Demo

A typical investor demo conversation runs ~5 minutes. At current Tavus Starter pricing:

| Scenario | Monthly Cost |
|---|---|
| 10 demos/month (within 100 min included) | $59 (plan fee only) |
| 20 demos/month (100 min included + ~0 overage) | $59 |
| 50 demos/month (~250 min, 150 min overage) | $59 + 150 × $0.37 = **$114.50** |
| 100 demos/month (~500 min, 400 min overage) | $59 + 400 × $0.37 = **$207** |

At Growth tier ($397/mo, 1,250 included min), you'd need 250+ demos/month before overages kick in.

### Concurrent Stream Limits (Production Capacity)

Most platforms treat concurrency as a sales negotiation, not a published spec. This is critical for production — if multiple users access the demo simultaneously, you hit a hard wall.

| Platform | Starter/Mid Tier | Enterprise |
|---|---|---|
| **Tavus CVI** | Not published (likely 1-5) | Negotiated |
| **HeyGen Interactive** | 1-3 | 10-50+ |
| **HeyGen LiveAvatar LITE** | Not published | Not published |
| **D-ID** | 5 (Pro) | 50-100 |
| **Simli** | 1-5 (estimated) | Negotiated |

**D-ID is the most transparent** — they document a `max_concurrent_streams` property on accounts and return a clean 429 when exceeded. Tavus and HeyGen treat concurrency as opaque account-level limits.

**Production readiness checklist:**
1. **Determine your Tavus concurrent session cap** — try creating 3-4 simultaneous conversations to find the wall, or ask Tavus sales directly
2. **Decide what happens when the limit is hit** — does the API return a 429? Queue? Silently fail? Test this before users encounter it.
3. **Consider server-side session tracking** — maintain a count of active Tavus sessions so you can show "Demo busy, please wait" instead of letting users hit opaque platform errors
4. **If concurrency matters at scale**, D-ID's documented limits and predictable 429 behaviour make it the most production-friendly option

### If Scaling Becomes a Concern

The architecture is designed so the avatar platform is swappable. The `useTavusAvatar` hook is the only integration point — replacing it with a D-ID or Simli equivalent would require:

1. A new `useXxxAvatar` hook that exposes `initAvatar()`, `echo(text)`, `interrupt()`, `stopAvatar()`, and a `mediaStream`
2. A new server-side route to create sessions (equivalent to `POST /api/v1/demo/tavus`)
3. A cleanup route (equivalent to `DELETE /api/v1/demo/tavus/[conversationId]`)

The processing pipeline (`POST /api/v1/demo/process`), voice listener, demo orchestration, and UI components would remain unchanged.

**D-ID** (~$0.05-0.10/min, 5-100 concurrent streams) would be the most direct replacement — same architecture (text in, WebRTC video out), ~3-7x cheaper per minute than Tavus, and the best-documented concurrency model. **Simli** (~$0.02-0.04/min) is cheapest but requires bringing your own TTS, adding a service dependency.

### Why Tavus Echo Over Tavus Full CVI

Even though echo and conversational mode bill at the same per-minute rate, the echo architecture is preferred for this demo because:

- **Deterministic responses** — pre-approved text is delivered verbatim, critical for regulated fund disclosures
- **No RAG hallucination risk** — the avatar never improvises; worst case is a safe fallback response
- **Independent component control** — the STT, classification, and avatar layers can each be swapped or upgraded independently
- **Auditable** — every response maps to a known category in the database; full traceability from question to answer

---

## Summary

The Tavus echo architecture is a deliberate and justified choice: it's the simplest way to get a continuous, visually seamless avatar stream with exact pre-approved responses. The approach is sound.

Five improvements have been implemented: conversation cleanup (DELETE endpoint + unmount cleanup), unified processing endpoint (single round-trip replacing two sequential calls), pinned speech-end detection, the Gemini Flash pipeline (single API call for STT + classification), and reduced VAD silence timeout (1500ms → 1000ms, configurable). Together these reduce perceived latency by ~700-900ms per utterance.

Tavus pricing is reasonable for demo-scale usage (~$59/mo for up to 20 five-minute demos). Concurrent stream limits are not published and should be tested before production deployment — this is the main scaling risk. If concurrency or cost becomes a constraint, D-ID offers the best combination of transparent pricing (~$0.05-0.10/min), documented concurrency limits (5-100 streams), and the same text-in/WebRTC-out architecture. The hook-based design makes the avatar layer swappable without touching the rest of the stack.

The remaining work is reducing the stream-ready timeout, deprecating the HeyGen Live mode, and cleaning up dead code paths from unused avatar modes.
