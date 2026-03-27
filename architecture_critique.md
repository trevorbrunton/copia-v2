# Tavus Processing Flow — Architecture Critique

## Overview

This document reviews the Tavus CVI (Conversational Video Interface) processing flow in the investor demo, evaluating simplicity, efficiency, and areas for improvement.

## Current Flow Summary

```
User speaks
  → VAD (amplitude-based, client-side)
  → POST /api/v1/demo/transcribe (PCM → WAV → ElevenLabs STT)
  → POST /api/v1/demo/match (text → Bedrock Haiku classifier → DB response)
  → tavusAvatar.echo(answerText) via Daily.co app-message
  → Tavus replica speaks with lip-sync
  → Voice listener resumes
```

The Tavus mode uses the "local pipeline" — voice capture, transcription, and question classification all happen outside Tavus. Tavus is used purely as a talking-head renderer via its echo protocol.

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

## Issues to Fix

### 1. Missing DELETE endpoint — conversations are never cleaned up server-side
**Severity:** Critical
**Files:** `src/demo/use-tavus-avatar.ts:311`, `app/api/v1/demo/tavus/route.ts`

`stopAvatar()` attempts `DELETE /api/demo/tavus/{conversationId}` but **no DELETE handler exists**. This means every Tavus conversation runs until Tavus's own idle timeout kills it. Orphaned conversations burn money.

**Fix:** Add a DELETE route at `app/api/v1/demo/tavus/[conversationId]/route.ts` that calls `DELETE https://tavusapi.com/v2/conversations/{id}` with the API key. Also fix the client-side URL (currently missing `/v1/` prefix).

### 2. Two round-trips per user utterance
**Severity:** Significant — adds 1-3 seconds of latency per question
**File:** `src/demo/use-demo.ts:109-150`

Every user question makes two sequential API calls:
1. `POST /api/v1/demo/transcribe` — STT
2. `POST /api/v1/demo/match` — classification

These are sequential because match depends on the transcribed text. The total latency is STT time + classifier time + two network round-trips.

**Fix:** Combine into a single `POST /api/v1/demo/process` endpoint that does transcribe → match server-side in one round-trip. This eliminates one full network round-trip and allows server-side optimisations (e.g., starting the classifier while STT is still streaming) in the future.

### 3. Speech-end detection is fragile
**Severity:** Significant
**File:** `src/demo/use-tavus-avatar.ts:168-181`

The code checks for speech completion by pattern-matching event type strings:

```typescript
eventType.includes("utterance_end") ||
eventType.includes("echo_end") ||
eventType.includes("response_end") ||
eventType.includes("stopped_speaking")
```

This is a shotgun approach — it tries every possible event name because the exact Tavus CVI protocol isn't pinned down. If Tavus changes their event naming, or if events fire in unexpected order, the promise resolves too early or too late. The fallback timeout (`text.length * 80 + 3000` ms) masks the problem.

**Fix:** Add temporary logging to identify which event Tavus actually sends for echo completion in production, then pin to that specific event type. Remove the catch-all patterns.

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
| Classification | Bedrock Haiku | Bedrock Haiku | **Bedrock Haiku** | ElevenLabs agent |
| Response delivery | Pre-recorded MP4/MP3 | Pre-recorded PCM → lip-sync | **Text → echo lip-sync** | Pre-recorded MP3 |
| Visual continuity | Poor (clip jumps) | Good (continuous stream) | **Good (continuous stream)** | N/A |
| SDK stability | Native `<video>` | Fragile (private WS hack) | **Stable (Daily.co public API)** | N/A |
| Data over wire per response | MP4 download | ~300KB PCM download + upload | **~200 bytes of text** | MP3 download |
| External services | ElevenLabs STT, Bedrock | ElevenLabs STT, Bedrock, HeyGen | **ElevenLabs STT, Bedrock, Tavus** | ElevenLabs |

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
4. **Reduce stream-ready timeout** to 30s with progressive feedback
5. **Deprecate Live (HeyGen) mode** — remove `useAvatar`, `/api/v1/demo/avatar`, and `@heygen/liveavatar-web-sdk` dependency
6. **Clean up remaining dead code** — ElevenLabs agent pipeline, unused hooks, video/haiku mode code (if no longer needed)

---

## Summary

The Tavus echo architecture is a deliberate and justified choice: it's the simplest way to get a continuous, visually seamless avatar stream with exact pre-approved responses. The approach is sound. The three concrete issues to fix are the missing conversation cleanup endpoint, the double API round-trip per utterance, and the fragile speech-end detection. Together these fixes would reduce cost, cut ~1-2 seconds of latency per interaction, and improve reliability.
