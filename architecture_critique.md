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

## What Works Well

### 1. Clean separation of concerns
The hook layering is sound: `useVoiceListener` → `useDemo` → `useTavusAvatar`. Each hook owns a clear responsibility. The orchestration in `useDemo` reads linearly.

### 2. Graceful degradation
If Tavus init fails, the system falls back to audio-only mode. If `echo()` fails, it falls back to cached audio. This is good resilience for a demo.

### 3. Server-side API key isolation
The `TAVUS_API_KEY` never reaches the client. The server creates the conversation and only returns the Daily.co room URL. Correct pattern.

### 4. Dynamic SDK import
`@daily-co/daily-js` is dynamically imported to avoid SSR issues. Appropriate for a Next.js app.

---

## Issues Found

### Critical

#### 1. Tavus is underutilised — the local pipeline negates its value
**Files:** `src/demo/config.ts`, `src/demo/use-demo.ts`

Tavus CVI is a **full conversational AI platform** with built-in STT, LLM, and TTS. The current architecture ignores all of that and uses Tavus purely as a lip-sync renderer via `conversation.echo`. The actual flow is:

```
Mic → VAD → ElevenLabs STT → Bedrock Haiku → pre-written text → Tavus echo
```

This means the app is paying for and maintaining:
- A custom VAD implementation (`use-voice-listener.ts`)
- ElevenLabs STT API calls (`/api/v1/demo/transcribe`)
- Bedrock Haiku classifier calls (`/api/v1/demo/match`)
- Tavus CVI subscription (but only using ~10% of its capability)

**If the pre-generated response model is essential** (which it appears to be — the demo needs exact, pre-approved answers with specific media URLs), then Tavus CVI is the wrong tool. A simpler TTS-with-lip-sync service would suffice.

**If Tavus's conversational AI is desired**, the local pipeline should be removed entirely and Tavus should handle STT → LLM → TTS → lip-sync natively, with the persona configured in Tavus's dashboard.

**Recommendation:** Decide which model you actually need. Either:
- (a) Lean into Tavus CVI fully — configure the persona/knowledge base in Tavus and let it handle the full conversation. Remove the local pipeline for tavus mode.
- (b) Drop Tavus CVI and use a simpler avatar/lip-sync service (or just video mode), since you're only using echo.

#### 2. Missing DELETE endpoint — conversations are never cleaned up server-side
**Files:** `src/demo/use-tavus-avatar.ts:311`, `app/api/v1/demo/tavus/route.ts`

`stopAvatar()` attempts `DELETE /api/demo/tavus/{conversationId}` but **no DELETE handler exists**. This means every Tavus conversation runs until Tavus's own timeout kills it. At ~$0.05–0.10/minute, orphaned conversations burn money.

**Recommendation:** Add a DELETE handler that calls `DELETE https://tavusapi.com/v2/conversations/{id}` with the API key, or use Tavus webhooks for automatic cleanup.

### Significant

#### 3. Redundant hooks always instantiated
**File:** `src/demo/use-demo.ts:72-73`

```typescript
const avatar = useAvatar();       // HeyGen LiveAvatar
const tavusAvatar = useTavusAvatar(); // Tavus CVI
```

Both hooks are always instantiated regardless of avatar mode. While necessary for React's hook ordering rules, `useAvatar()` sets up state and refs that are never used in Tavus mode (and vice versa). The `useConversation()` hook from ElevenLabs (line 187) is also always instantiated even in local pipeline modes.

**Recommendation:** Consider a single `useAvatarRenderer` hook that internally branches by mode, or restructure the component tree so different mode components render different hooks.

#### 4. Speech-end detection is fragile
**File:** `src/demo/use-tavus-avatar.ts:168-181`

The code checks for speech completion by pattern-matching event type strings:

```typescript
eventType.includes("utterance_end") ||
eventType.includes("echo_end") ||
eventType.includes("response_end") ||
eventType.includes("stopped_speaking")
```

This is a shotgun approach — it tries every possible event name because the exact Tavus CVI protocol isn't pinned. If Tavus changes their event naming, or if events fire in unexpected order, the promise resolves too early or too late. The fallback timeout (`text.length * 80 + 3000` ms) masks the problem.

**Recommendation:** Pin to the specific Tavus CVI event documented for echo completion. Remove the catch-all patterns. If the docs are ambiguous, add logging to identify the authoritative event and lock to that.

#### 5. 60-second stream-ready timeout is too long
**File:** `src/demo/use-tavus-avatar.ts:77-93`

The user stares at a spinner for up to 60 seconds waiting for the replica's video track. In practice, Tavus replicas typically connect in 5-15 seconds. A 60-second timeout means a broken connection wastes a full minute before failing.

**Recommendation:** Reduce to 30 seconds. Add intermediate feedback (e.g., "Still connecting..." at 10s, "This is taking longer than usual..." at 20s).

#### 6. Two round-trips per user utterance
**File:** `src/demo/use-demo.ts:109-150`

Every user question makes two sequential API calls:
1. `POST /api/v1/demo/transcribe` — STT
2. `POST /api/v1/demo/match` — classification

These are sequential because match depends on the transcribed text. But the total latency is STT time + classifier time + network overhead × 2, adding 1-3 seconds before the avatar even starts speaking.

**Recommendation:** Combine into a single `POST /api/v1/demo/process` endpoint that does transcribe → match server-side in one round-trip. This saves one full network round-trip and allows server-side streaming of partial results if needed later.

### Minor

#### 7. `console.log` used extensively in production code
**Files:** `use-tavus-avatar.ts`, `use-demo.ts`

The codebase has a proper structured logger (`src/lib/logger.ts`) but the demo hooks use raw `console.log` / `console.warn` throughout. These will appear in production browser consoles.

**Recommendation:** Either remove debug logging or gate it behind a `DEBUG` flag.

#### 8. `ScriptProcessorNode` is deprecated
**File:** `src/demo/use-voice-listener.ts`

The voice listener uses `ScriptProcessorNode` for real-time audio processing, which is deprecated in the Web Audio API. It works today but will eventually be removed from browsers.

**Recommendation:** Migrate to `AudioWorkletNode` when time permits. Not urgent — ScriptProcessorNode still works in all major browsers.

#### 9. The 200ms `setTimeout` yield is a code smell
**File:** `src/demo/use-demo.ts:431-432`

```typescript
await new Promise((r) => setTimeout(r, 200));
```

This waits for React to flush state so the `<video>` element is wired up before the greeting plays. It's fragile — if React batching changes or the component tree grows, 200ms may not be enough (or may be wastefully long).

**Recommendation:** Use a ref callback or `useEffect` that resolves a promise when the video element is ready, rather than a blind timeout.

---

## Architecture Comparison: Modes at a Glance

| Concern | Video | Haiku | Live | **Tavus** | Audio |
|---|---|---|---|---|---|
| Voice capture | ElevenLabs agent | VAD + STT | VAD + STT | **VAD + STT** | ElevenLabs agent |
| Classification | ElevenLabs agent | Bedrock Haiku | Bedrock Haiku | **Bedrock Haiku** | ElevenLabs agent |
| TTS | Pre-recorded | Pre-recorded | Pre-recorded PCM | **Tavus echo** | Pre-recorded |
| Visual | MP4 swap | MP4 swap | HeyGen lip-sync | **Tavus lip-sync** | None |
| Services used | ElevenLabs | ElevenLabs STT, AWS Bedrock | ElevenLabs STT, AWS Bedrock, HeyGen | **ElevenLabs STT, AWS Bedrock, Tavus** | ElevenLabs |

Tavus mode is the most expensive in terms of external service dependencies (3 paid APIs) while delivering similar functionality to Live mode. The key question is whether Tavus's video quality justifies the cost and complexity over HeyGen, or whether Tavus should be used end-to-end.

---

## Recommended Simplification (If Keeping Pre-Generated Responses)

If the demo must use pre-approved, pre-generated responses (the current model), the simplest efficient architecture would be:

1. **Drop Tavus CVI** — replace with a lightweight lip-sync service or stay with video mode
2. **Merge transcribe + match** into a single API endpoint
3. **Remove the ElevenLabs agent code path** if unused (it's dead code when `USE_LOCAL_PIPELINE` is true)
4. **Add the missing conversation cleanup** endpoint

This would reduce external dependencies from 3 to 2 (STT + classifier) and eliminate the complexity of managing a WebRTC session for what amounts to a text-to-speech call.

## Recommended Simplification (If Tavus's Full AI Is Desired)

If the goal is a truly conversational avatar:

1. **Configure Tavus persona** with the fund knowledge base
2. **Remove the local pipeline** entirely for tavus mode — let Tavus handle STT → LLM → TTS → lip-sync
3. **Use Tavus callbacks/webhooks** to get the response text for the chat panel
4. **Keep video/audio modes** as fallback for demos where Tavus is unavailable

This would reduce the client code to: connect to Tavus → render stream → display transcript. Dramatically simpler.

---

## Summary

The Tavus flow works but sits in an architectural uncanny valley — it uses a full conversational AI platform as a dumb lip-sync renderer. The most impactful change would be deciding which direction to commit to: either use Tavus end-to-end, or replace it with something simpler. The missing DELETE endpoint is the most urgent tactical fix. Merging the two API calls into one would give the quickest latency win.
