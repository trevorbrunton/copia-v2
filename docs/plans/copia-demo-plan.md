# Copia / OC Mid-Cap Fund — Investor Agent Demo Plan

**Created:** 24 March 2026
**Updated:** 25 March 2026 (v4 — aligned with ARCHITECTURE.md)
**Owner:** Rosie
**Builder:** Trevor (code by Claude Code) + Trevor (manual platform setup)
**Internal review:** Friday 28 March 2026
**Client demo:** Wednesday 1 April 2026
**Hour cap:** 20–30 hrs (check in with Rosie before exceeding)

**Reference:** [ARCHITECTURE.md](../ARCHITECTURE.md) · [INFRASTRUCTURE.md](../INFRASTRUCTURE.md)

---

## Architecture Summary

Three ElevenLabs + LiveAvatar services, orchestrated by the app:

```
User types question
    │
    ▼
ElevenLabs Agent (NLU only, no audio)
    │
    ├── Known intent → pre-rendered PCM audio → LiveAvatar lip-syncs
    │
    └── Unknown intent → ElevenLabs TTS API (runtime PCM) → LiveAvatar lip-syncs
```

- **ElevenLabs Conversational AI** — intent classification + RAG (text only, no voice output)
- **ElevenLabs TTS API** — voice synthesis in PCM 24kHz format (offline for known answers, runtime for unknown)
- **LiveAvatar LITE** — avatar video with lip-sync driven by `session.repeatAudio(pcmData)`

All audio uses the same custom ElevenLabs voice. LiveAvatar's built-in TTS is bypassed for voice consistency. See [ARCHITECTURE.md](../ARCHITECTURE.md) for full process flows.

---

## Current Status (25 March 2026)

### What's Working
- ✅ ElevenLabs agent configured and responding (NLU + RAG)
- ✅ Branded demo page at `/demo` (no auth required)
- ✅ Pre-generated MP3 audio for 7 core responses (greeting + 5 questions + fallback)
- ✅ Client-side keyword classifier for instant cached responses
- ✅ Live agent fallback for unknown questions (WebRTC voice output)
- ✅ Chat transcript panel with typing indicators
- ✅ 28 extended Q&A pairs mined from fund documents (migration 003)
- ✅ Fund PDFs downloaded and text-extracted in `docs/fund-data/`

### What Needs Doing
- 🔴 **LiveAvatar credits** — Essential plan ($99/mo) requested, awaiting activation
- 🔲 Convert audio from MP3 to PCM 24kHz format (LiveAvatar requirement)
- 🔲 Regenerate audio for all 28 extended responses (currently only 7)
- 🔲 Switch ElevenLabs agent to NLU-only mode (disable WebRTC audio output)
- 🔲 Add ElevenLabs TTS API route for runtime voice synthesis (unknown questions)
- 🔲 Integrate LiveAvatar SDK — session, video stream, `repeatAudio()`
- 🔲 Update classifier to use ElevenLabs agent for intent classification
- 🔲 Pre-recorded backup video of all 5 demo questions
- 🔲 Custom voice clone (if Robert Frost audio available) or select stock voice

---

## Open Questions

| # | Question | Impact | Status |
|---|----------|--------|--------|
| 1 | 🔴 **LiveAvatar Essential plan** — Has it been activated? | Blocks avatar integration | Requested |
| 2 | 🟡 **Robert Frost audio** — Any source for voice cloning? | Voice quality | Using stock voice |
| 3 | 🟡 **Base44** — Was it investigated as an alternative? | Parallel path | Unknown |
| 4 | 🟡 **LiveAvatar secrets API** — Can we register ElevenLabs key? (Needed for ElevenLabs Agent Plugin as alternative approach) | Simpler integration path | Blocked by `user_read` permission |

---

## Deliverables

By **Friday 28 March** (internal review):

| # | Deliverable | Priority | Status |
|---|-------------|----------|--------|
| 1 | Shareable demo link — no login required | Must have | ✅ Done |
| 2 | Agent answers all 5 demo questions accurately | Must have | ✅ Done |
| 3 | Pre-generated audio for instant responses | Must have | ✅ Done (MP3, needs PCM conversion) |
| 4 | Fallback for out-of-scope questions | Must have | ✅ Done |
| 5 | OC Funds branding (navy/grey, clean) | Must have | ✅ Done |
| 6 | LiveAvatar talking avatar with lip-sync | Should have | 🔴 Blocked on credits |
| 7 | Runtime TTS for unknown questions via avatar | Should have | 🔲 Not started |
| 8 | Pre-recorded backup video | Should have | 🔲 Not started |
| 9 | Documentation | Must have | ✅ Done (ARCHITECTURE.md + INFRASTRUCTURE.md) |

---

## Phased Plan (Remaining Work)

### Phase A: Audio Pipeline (Pre-req for Avatar)

**Goal:** Convert audio to PCM format and generate all 28 responses.

| Task | Est | Who | Notes |
|------|-----|-----|-------|
| Update `generate-audio.ts` to output PCM 24kHz format | 0.5h | Claude | `output_format: "pcm_24000"` instead of `mp3_44100_128` |
| Generate PCM audio for all 28 response categories | 0.5h | Claude | Run script, output to `public/audio/*.pcm` |
| Update classifier with all 28 categories + keywords | 1h | Claude | Extend from 5 to 28 categories |
| Add `ELEVENLABS_VOICE_ID` env var | 0.25h | Claude | For TTS API calls |
| Build TTS API proxy route (`/api/v1/demo/tts`) | 1h | Claude | Server-side: receives text → calls ElevenLabs TTS → returns PCM stream |

**Exit criteria:** All 28 answers available as PCM files. TTS route works for runtime generation.

---

### Phase B: LiveAvatar Integration (Blocked on Credits)

**Goal:** Avatar video with lip-sync driven by PCM audio.

| Task | Est | Who | Depends on |
|------|-----|-----|------------|
| Install `@heygen/liveavatar-web-sdk` | 0.25h | Claude | — |
| Build `useAvatar()` hook — session lifecycle, video attach, repeatAudio | 2h | Claude | — |
| Update `/api/v1/demo/avatar` route — session token creation | 0.5h | Claude | — |
| Update `AvatarPanel` — render `<video>` element from LiveAvatar stream | 1h | Claude | — |
| Update `useDemo()` — orchestrate NLU + PCM audio + avatar | 2h | Claude | Phase A complete |
| Switch ElevenLabs agent to NLU-only (set `text_only: true`) | 0.25h | Claude | API call |
| Mute WebRTC audio output (avatar handles all audio) | 0.25h | Claude | — |
| Wire known questions: classifier → PCM file → `repeatAudio()` | 1h | Claude | Phase A |
| Wire unknown questions: agent response → TTS API → PCM → `repeatAudio()` | 1.5h | Claude | TTS route |
| Wire greeting: PCM greeting → `repeatAudio()` on session start | 0.5h | Claude | — |

**Exit criteria:** Avatar speaks all responses with lip-sync. Voice is consistent (same custom voice throughout).

---

### Phase C: Testing & Polish

**Goal:** Demo is reliable for client meeting.

| Task | Est | Who | Notes |
|------|-----|-----|-------|
| Test all 5 demo questions — verify avatar speaks correctly | 1h | Trevor | Use verification checklist |
| Test unknown questions — verify runtime TTS + avatar | 0.5h | Trevor | |
| Test fallback — out-of-scope questions | 0.5h | Trevor | |
| Test edge cases: rapid questions, silence, interruption | 0.5h | Trevor | |
| Optimise latency — target <2s for known, <5s for unknown | 0.5h | Claude | |
| Record backup video (screen capture of 5 demo questions) | 0.5h | Trevor | OBS or similar |
| Cross-browser test (Chrome, Safari) | 0.5h | Trevor | |
| Mobile hotspot test (restricted network) | 0.25h | Trevor | |
| Internal review with Rosie + Gio | 1h | Trevor | Fri 28 Mar |
| Fix review feedback | 1h | Claude | |

---

### Phase D: Voice Clone (Optional Enhancement)

**Goal:** Avatar sounds like Robert Frost, not a stock voice.

| Task | Est | Who | Notes |
|------|-----|-----|-------|
| Source Robert Frost audio (podcast, interview, conference) | 1h | Trevor | Need ~1 min clean speech |
| Create voice clone in ElevenLabs dashboard | 0.5h | Trevor | |
| Update `ELEVENLABS_VOICE_ID` env var | 0.1h | Claude | |
| Regenerate all 28 PCM audio files with cloned voice | 0.5h | Claude | Run script |
| Test voice quality | 0.5h | Trevor | |

---

## Hour Budget

| Phase | Hours | Cumulative | Status |
|-------|-------|------------|--------|
| Previous work (Phases 1–3 from v3 plan) | ~16 | 16 | ✅ Complete |
| A. Audio Pipeline | 3.25 | 19.25 | 🔲 Ready to start |
| B. LiveAvatar Integration | 8.25 | 27.5 | 🔴 Blocked on credits |
| C. Testing & Polish | 6.25 | 33.75 | 🔲 After B |
| D. Voice Clone (optional) | 2.6 | 36.35 | 🟡 If audio available |

**Note:** Budget exceeds the original 20–30 hour cap. Phase D is optional. Check in with Rosie before proceeding beyond 30 hours.

---

## Verification Checklist

Run after avatar integration. All must pass.

| # | Question | Expected Key Facts | Pass? |
|---|----------|-------------------|-------|
| 1 | Who is the manager of the fund? | Robert Frost (Head of Investments) and/or Nga Lucas (Portfolio Manager, Mid-Cap) | |
| 2 | What is the investment strategy? | Long-only, benchmark unaware, Australian equity, 20–50 mid-cap stocks, bottom-up | |
| 3 | Rate of return since inception? | +9.4% (inception November 2023, to Feb 2026) | |
| 4 | Year-to-date / recent performance? | -2.5% (1 month), -4.4% (3 months), +1.8% (1 year) | |
| 5 | How does performance compare to benchmark? | S&P/ASX MidCap 50 Index. Fund is -6.9% vs benchmark since inception. Contextualise. | |

**Trick questions (must not hallucinate):**

| Question | Expected Behaviour |
|----------|-------------------|
| "What's the fund's 5-year return?" | Decline — fund is only ~2 years old |
| "Is this fund better than Vanguard?" | Decline — cannot compare |
| "What will the fund return next year?" | Decline — never forecast |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **LiveAvatar credits not activated in time** | Medium | High | Ship audio-only Outcome A (working today). Avatar is additive. |
| **PCM audio format issues with LiveAvatar** | Low | High | Test with a single file first before generating all 28. |
| **Runtime TTS latency >5 seconds** | Medium | Medium | Pre-generate more answers to cover common questions. Expand from 7 to 28. |
| **Voice clone quality poor** | Medium | Low | Use stock voice — still professional. |
| **Demo fails on demo day** | Low | Critical | Pre-recorded backup video. Text chat always works. |
| **LiveAvatar session drops mid-demo** | Low | High | Audio-only fallback. Reconnect button. |
| **Budget exceeds 30 hours** | High | Medium | Phase D is optional. Check in with Rosie at 30 hours. |

---

## Key Decisions

| Decision | Chosen | Rationale |
|----------|--------|-----------|
| **Audio format** | PCM 24kHz | LiveAvatar `repeatAudio()` requires PCM. Consistent throughout pipeline. |
| **Intent classification** | ElevenLabs agent (NLU only) | Agent handles RAG for unknown questions. No local keyword classifier needed for final version. |
| **Voice output** | All audio through LiveAvatar | Single visual+audio output. No competing browser audio. Voice consistency guaranteed. |
| **Voice source** | ElevenLabs TTS (custom voice) | Bypass LiveAvatar's built-in TTS. Same voice for pre-generated and runtime. |
| **Fallback (no avatar)** | Audio-only with cached MP3s | Current working state. Ships if LiveAvatar credits unavailable. |

---

## Daily Schedule (Remaining)

| Day | Date | Focus | Target |
|-----|------|-------|--------|
| Today | Tue 25 Mar | Phase A (audio pipeline) | PCM files generated, TTS route built, classifier expanded |
| Wed | Wed 26 Mar | Phase B (avatar integration) | LiveAvatar SDK wired, avatar speaking pre-generated answers |
| Thu | Thu 27 Mar | Phase B continued + Phase C | Runtime TTS wired, testing, backup video |
| Fri | Fri 28 Mar | Phase C (review) | Internal review with Rosie + Gio, fix feedback |
| Mon | Mon 31 Mar | Buffer + Phase D | Fix review issues, voice clone if audio available |

---

## Reference

- [ARCHITECTURE.md](../ARCHITECTURE.md) — system design, process flows, component structure
- [INFRASTRUCTURE.md](../INFRASTRUCTURE.md) — external services, accounts, deployment
- [OC Mid-Cap Fund page](https://www.ocfunds.com.au/mid-cap-fund)
- [OC Funds Investment Team](https://www.ocfunds.com.au/investment-team)
- [ElevenLabs Conversational AI](https://elevenlabs.io/conversational-ai)
- [LiveAvatar docs](https://docs.liveavatar.com)
- [LiveAvatar ElevenLabs Agent Plugin](https://docs.liveavatar.com/docs/elevenlabs-agent-plugin)
