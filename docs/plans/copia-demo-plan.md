# Copia / OC Mid-Cap Fund — Investor Agent Demo Plan

**Created:** 24 March 2026
**Updated:** 24 March 2026 (v3 — realistic build plan)
**Owner:** Rosie
**Builder:** Trevor (code by Claude Code) + Trevor (manual platform setup)
**Internal review:** Friday 28 March 2026
**Client demo:** Wednesday 1 April 2026
**Hour cap:** 20–30 hrs (check in with Rosie before exceeding)

---

## How This Build Works

**Two parallel tracks:**

| Track | Who | What |
|-------|-----|------|
| **Track A: Code** | Claude Code | Frontend, API integration, HeyGen streaming, deployment |
| **Track B: Platform setup** | Trevor (manual) | ElevenLabs dashboard (agent, KB, voice, prompt), HeyGen dashboard (avatar creation), Base44 investigation, testing/QA |
| **Track C: Base44** | Trevor (parallel) | Investigate and build on Base44 as alternative path to BetaShares-quality demo |

Claude Code cannot create accounts, upload PDFs, select voices, test audio/video quality, or see the demo output. Every integration touchpoint requires Trevor to provide IDs, test results, and feedback.

**The feedback loop:** Claude writes code → Trevor runs it → Trevor reports what happened → Claude adjusts. Budget for this — it's slower than solo coding.

---

## Strategy: Two Horses

We're running two approaches in parallel:

1. **ElevenLabs + HeyGen custom build** (this plan) — Claude codes the frontend and integration, Trevor sets up the platforms
2. **Base44 no-code build** (Track C) — Trevor builds directly on Base44, the same platform the BetaShares demo uses

**Why both:** The BetaShares demo was built on Base44 in likely a few hours. If Base44 can replicate that quality quickly, it's the faster path. But if Base44 has limitations (customisation, branding, avatar quality), the custom build gives us full control.

**Decision gate — end of Day 1:** Compare progress on both tracks. Ship whichever is better by Friday.

---

## Open Questions

| # | Question | Impact | Status |
|---|----------|--------|--------|
| 1 | 🔴 **Tool accounts** — Need HeyGen API key + ElevenLabs API key to start coding. | Blocks all code work | ❓ |
| 2 | 🟡 **Base44 account** — Can Trevor sign up and build on Base44 in parallel? | Track C viability | ❓ |
| 3 | 🟡 **ElevenLabs access from Pep** — Existing 11Labs environment behind BetaShares demo. | Could shortcut voice + agent setup | ❓ |
| 4 | 🟡 **Robert Frost audio/video** — Needed for voice cloning. Stock voice if unavailable. | Voice quality | ❓ |
| 5 | Resolved: **PDF #5 (HSBC fund)** — Excluded. Different fund. | | Exclude |

---

## Deliverables

By **Friday 28 March** (internal review):

**Target (Outcome B — talking avatar):**
- [ ] Shareable demo link — no login required
- [ ] Robert Frost avatar (HeyGen) speaks answers with lip-sync
- [ ] ElevenLabs agent answers all 5 questions accurately
- [ ] Fallback for out-of-scope questions
- [ ] OC Funds branding (navy/grey, clean, minimal)
- [ ] Pre-recorded backup video of all 5 questions
- [ ] Documentation (Notion or markdown)

**Guaranteed floor (Outcome A — audio-only):**
- [ ] Shareable demo link
- [ ] ElevenLabs Conversational AI widget embedded on branded page
- [ ] Robert Frost's photo (static) with voice conversation
- [ ] All 5 questions answered accurately
- [ ] This ships no matter what — it's the safety net

---

## Architecture

### Outcome B (target): Talking avatar

```
User (browser)
    │
    ▼
┌──────────────────────────────────┐
│   Frontend (demo/)               │  OC Funds branded page
│   Deployed to Vercel             │  Hosted in this repo
└──────────┬───────────────────────┘
           │
     ┌─────┴──────┐
     │ Voice in   │  Browser captures mic audio
     └─────┬──────┘
           │ audio stream
           ▼
┌──────────────────────────────────┐
│   ElevenLabs Conversational AI   │  Agent + RAG + TTS
│   • Knowledge base (fund PDFs)   │  Processes question
│   • System prompt (Robert Frost) │  Returns audio response
│   • Voice (cloned or stock)      │
└──────────┬───────────────────────┘
           │ response audio chunks
           ▼
┌──────────────────────────────────┐
│   HeyGen Interactive Avatar      │  WebSocket session
│   • Robert Frost photo avatar    │  Receives audio
│   • Lip-sync + head movement     │  Returns video stream
└──────────┬───────────────────────┘
           │ video stream (WebRTC)
           ▼
        Browser renders video
        User sees Robert Frost
        speaking the answer
```

**Latency stack (honest estimate):**
- User finishes speaking → ElevenLabs processes: 1–3s
- ElevenLabs generates audio → pipe to HeyGen: 0.5–1s
- HeyGen generates lip-sync video: 1–2s
- **Total: 3–6 seconds** before avatar starts speaking

This is acceptable for a demo. Not instant, but natural enough.

### Outcome A (floor): Audio-only

```
User (browser)
    │
    ▼
┌──────────────────────────────────┐
│   Frontend (demo/)               │  OC Funds branded page
│   Robert Frost photo (static)    │  ElevenLabs widget embedded
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│   ElevenLabs Conversational AI   │  Handles everything:
│   Built-in widget                │  mic capture, RAG, voice response
└──────────────────────────────────┘
```

Much simpler. Widget handles all the audio plumbing. Claude codes a branded page around it.

---

## Phased Plan

### Phase 1: Setup & Outcome A (Day 1 — Tue 25 Mar)

**Goal:** Audio-only demo working by end of Day 1. This is the safety net.

#### Track A — Claude Code (code)

| Task | Est | Depends on |
|------|-----|------------|
| Create `demo/` directory with project structure | 0.5h | Nothing |
| Build branded frontend page — OC Funds colours, Robert Frost photo, clean layout | 2h | Nothing |
| Integrate ElevenLabs Conversational AI widget embed | 1h | Trevor provides: agent ID or widget embed code |
| Add text input fallback for when mic is denied | 0.5h | Widget working |
| Deploy to Vercel, get shareable URL | 0.5h | Frontend built |

#### Track B — Trevor (manual platform setup)

| Task | Est | Notes |
|------|-----|-------|
| Create/access ElevenLabs account, get API key | 0.5h | Share API key + agent ID with Claude |
| Create Conversational AI agent in ElevenLabs dashboard | 0.5h | |
| Upload PDFs to knowledge base (exclude PDF #5) | 0.5h | Main fund page + Latest Fund Report first, then remaining 3 |
| Configure system prompt (use guidance from this doc) | 0.5h | |
| Select or clone voice | 0.5h | Clone if audio available, stock Australian male otherwise |
| Test all 5 questions in ElevenLabs dashboard — verify accuracy | 1h | Use verification checklist below |
| Create/access HeyGen account, get API key | 0.5h | Share API key with Claude |
| Upload Robert Frost photo, create avatar in HeyGen dashboard | 1h | Try multiple photos if first is poor quality |

#### Track C — Trevor (Base44 parallel)

| Task | Est | Notes |
|------|-----|-------|
| Sign up for Base44, explore platform | 1h | This is what BetaShares demo uses |
| Attempt to build equivalent demo on Base44 | 2h | If viable, could be the primary deliverable |

**Day 1 exit criteria:**
- Outcome A (audio-only) is live on a shareable URL
- ElevenLabs agent passes verification checklist
- HeyGen avatar created and API key available
- Base44 viability assessed
- **Decision: which track is ahead? Adjust Day 2 accordingly.**

---

### Phase 2: Avatar Integration — Outcome B (Day 2 — Wed 26 Mar)

**Goal:** HeyGen avatar speaking ElevenLabs responses in the browser.

This is the hardest day. The integration between ElevenLabs audio output and HeyGen avatar input is the crux of the build.

#### Track A — Claude Code

| Task | Est | Depends on |
|------|-----|------------|
| Write HeyGen Interactive Avatar SDK integration — session creation, WebSocket setup | 2h | Trevor provides: API key, avatar ID |
| Write audio pipeline — capture ElevenLabs response audio, pipe to HeyGen | 3h | ElevenLabs agent working (from Day 1) |
| Render HeyGen video stream in frontend (WebRTC) | 1.5h | HeyGen session working |
| Handle session lifecycle — start, stop, reconnect, error states | 1h | |
| Loading states — show "thinking..." while avatar processes | 0.5h | |

#### Track B — Trevor (testing + feedback)

| Task | Est | Notes |
|------|-----|-------|
| Run the page locally after each Claude Code change | Ongoing | Report: does the avatar appear? Does it speak? What's the latency? Any errors in console? |
| Test avatar quality — does it look like Robert Frost? | 0.5h | If poor, try different HeyGen avatar settings |
| Test voice + lip-sync quality | 0.5h | Report any mismatch or uncanny valley issues |
| Test latency — time from question end to avatar speaking | 0.5h | Target: <6 seconds |

**Day 2 exit criteria:**
- Avatar appears in the browser and lip-syncs to ElevenLabs audio
- End-to-end flow works: speak question → hear + see Robert Frost answer
- Latency is acceptable (<6 seconds)
- OR: clear understanding of what's blocking and whether it's fixable in Day 3

**If avatar integration is not working by end of Day 2:** Ship Outcome A. Spend Day 3 on polish instead of debugging. The audio-only demo is still a strong demo.

---

### Phase 3: Polish, QA & Backup (Day 3 — Thu 27 Mar)

**Goal:** Demo is reliable, polished, and has a backup plan.

#### Track A — Claude Code

| Task | Est | Depends on |
|------|-----|------------|
| Fix any issues from Day 2 avatar integration | 2h | Trevor's feedback from testing |
| Polish frontend — loading states, error recovery, reconnect button | 1h | |
| Add connection status indicator (connected / reconnecting / error) | 0.5h | |
| Handle mic permission denied gracefully — show text input prominently | 0.5h | |
| Final cross-browser CSS fixes | 0.5h | Trevor tests Chrome + Safari |
| Prepare production deployment on Vercel | 0.5h | |

#### Track B — Trevor (QA + backup)

| Task | Est | Notes |
|------|-----|-------|
| Run verification checklist 3x — check answer consistency | 1h | All 5 questions, 3 runs each |
| Test trick questions (see checklist below) | 0.5h | Must not hallucinate |
| Test off-topic questions | 0.5h | "What's the weather?" etc |
| Test on mobile hotspot (simulates corporate network) | 0.5h | WebSocket connections may be blocked |
| Test with mic permission denied — verify text fallback works | 0.5h | |
| **Record backup video** — screen capture all 5 questions | 0.5h | OBS or similar. Safety net for demo day. |
| Share backup video with Rosie | 0.25h | |

**Day 3 exit criteria:**
- Demo is stable — no crashes across 3 full test runs
- Verification checklist passes 3/3
- Backup video recorded and shared
- Production URL is live and shareable

---

### Day 4: Internal Review (Fri 28 Mar)

| Task | Est | Who |
|------|-----|-----|
| Live walkthrough with Rosie and Gio | 1h | Trevor presents |
| Fix any issues flagged in review | 1–2h | Claude Code |
| Final deployment | 0.5h | Claude Code |

### Day 5: Buffer (Mon 31 Mar)

Reserved for anything that comes out of Friday's review.

---

## Verification Checklist

Run after every knowledge base change. All must pass.

| # | Question | Expected Key Facts | Pass? |
|---|----------|-------------------|-------|
| 1 | Who is the manager of the fund? | Robert Frost (Head of Investments) and/or Nga Lucas (Portfolio Manager, Mid-Cap) | |
| 2 | What is the investment strategy? | Long-only, benchmark unaware, Australian equity, 20–50 mid-cap stocks, bottom-up | |
| 3 | Rate of return since inception? | +9.4% (inception November 2023, to Feb 2026) | |
| 4 | Year-to-date / recent performance? | -2.5% (1 month), -4.4% (3 months), +1.8% (1 year) | |
| 5 | How does performance compare to benchmark? | S&P/ASX MidCap 50 Index. Fund is -6.9% vs benchmark since inception. Should contextualise (young fund, short track record). | |

**Trick questions (must not hallucinate):**

| Question | Expected Behaviour |
|----------|-------------------|
| "What's the fund's 5-year return?" | Decline — fund is only ~2 years old |
| "Is this fund better than Vanguard?" | Decline — cannot compare to funds outside knowledge base |
| "What's the current share price?" | Decline — not in the documents, suggest contacting IR team |
| "What will the fund return next year?" | Decline — never forecast or speculate |

---

## System Prompt

For ElevenLabs Conversational AI agent configuration:

```
You are Robert Frost, Head of Investments at OC Funds Management.
You are speaking with investors about the OC Mid-Cap Fund.
Answer questions using only the provided fund documents.
Be professional, measured, and confident.
If a question asks about performance, always cite the specific time period.
When comparing to the benchmark (S&P/ASX MidCap 50 Index), acknowledge
underperformance factually and contextualise it: the fund is young
(inception November 2023) with a short track record.
Never invent or estimate numbers. If the data is not in your documents,
say so and suggest contacting the investor relations team.
Keep answers concise — 2-3 sentences for simple questions, up to 5 for
benchmark comparison. You are speaking aloud, not writing an essay.
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **ElevenLabs → HeyGen audio piping doesn't work** | Medium | High | This is the core technical risk. Fallback: ship Outcome A (audio-only). Day 2 is the make-or-break day. |
| **Latency >10 seconds** (unacceptable for demo) | Medium | High | Reduce avatar quality settings. Try chunked audio streaming. Fallback: Outcome A. |
| **HeyGen avatar looks uncanny / low quality** | Medium | Medium | Try multiple photos. Try HeyGen stock avatar. Fallback: Outcome A (static photo). |
| **Voice cloning fails** | Medium | Low | Use stock Australian male voice. Still sounds professional. |
| **PDF tables don't parse** | Medium | High | Manually add key numbers as structured text in knowledge base. |
| **RAG hallucinates numbers** | Low | Critical | System prompt explicitly forbids it. Verification checklist after every KB change. |
| **Demo fails on demo day** | Low | Critical | Pre-recorded backup video. Tested on mobile hotspot to simulate restricted network. |
| **Mic blocked in meeting room** | Medium | Medium | Text input always visible. Backup video available. |
| **Base44 turns out to be better** | Medium | Positive | Ship the Base44 version instead. This is a good outcome. |

---

## Key Decisions

| Decision | Chosen | Rationale |
|----------|--------|-----------|
| **Source code** | `demo/` in this repo | Single repo. Deployed separately. |
| **Primary platform** | ElevenLabs Conversational AI + HeyGen | ElevenLabs handles agent + RAG + voice. HeyGen handles avatar. |
| **Parallel track** | Base44 (Trevor builds manually) | BetaShares demo was built on Base44. Faster path if it works. |
| **Guaranteed deliverable** | Outcome A (audio-only) by end of Day 1 | Safety net. Ships no matter what. |
| **Target deliverable** | Outcome B (talking avatar) by end of Day 3 | The "wow factor" demo. Stretch but achievable. |
| **Frontend** | Static HTML/JS in `demo/` | No framework overhead. |
| **Hosting** | Vercel | Clean URL. Free tier. |
| **PDF #5** | Excluded | Different fund. |

---

## Daily Summary

| Day | Date | Goal | Ship? |
|-----|------|------|-------|
| 1 | Tue 25 Mar | Outcome A live (audio-only). ElevenLabs agent accurate. HeyGen avatar created. Base44 assessed. | Outcome A shippable |
| 2 | Wed 26 Mar | Outcome B integration (ElevenLabs → HeyGen). Avatar speaking in browser. | Outcome B functional or decision to ship A |
| 3 | Thu 27 Mar | Polish, QA, backup video. Production-ready. | Outcome B polished or Outcome A polished |
| 4 | Fri 28 Mar | Internal review with Rosie + Gio. Fix feedback. | Final version deployed |
| 5 | Mon 31 Mar | Buffer for review fixes. | |

---

## Reference Links

- [BetaShares demo (quality bar)](https://betashares.agenticscale.ai/) — built on Base44
- [Base44 platform](https://base44.com/) — no-code AI app builder (Track C)
- [OC Mid-Cap Fund page](https://www.ocfunds.com.au/mid-cap-fund)
- [OC Funds Investment Team (Robert Frost)](https://www.ocfunds.com.au/investment-team)
- [ElevenLabs Conversational AI](https://elevenlabs.io/conversational-ai)
- [ElevenLabs docs](https://elevenlabs.io/docs)
- [HeyGen Interactive Avatar](https://docs.heygen.com/docs/interactive-avatar)
- [HeyGen API docs](https://docs.heygen.com/reference)

## Source PDFs (Knowledge Base)

| # | Description | Include? |
|---|-------------|----------|
| 1 | [OC Mid-Cap Fund — main page](https://www.ocfunds.com.au/mid-cap-fund) | Yes — primary |
| 2 | [Latest Fund Report (PDF)](https://53c897c7-871d-4f9d-9e90-e9f932223643.filesusr.com/ugd/01bd19_f9fc80a9c1654b91992bf48455c25d2a.pdf) | Yes — primary |
| 3 | [Fund document (PDF)](https://0cad8d21-755e-4cdf-99b0-0239b5c718dd.filesusr.com/ugd/01bd19_80d3587044c04174b3a30d36f256b024.pdf) | Yes |
| 4 | [Fund document (PDF)](https://fd6f9eba-65e5-4bbe-9393-f177bfb63817.filesusr.com/ugd/01bd19_1c3d0fa3bef1427a91c011c5c5eda9bc.pdf) | Yes |
| 5 | [HSBC Global Infrastructure Equity Fund](https://www.copiapartners.com.au/hsbc-global-infrastructure-equity-fund) | **No — different fund** |
| 6 | [Fund document (PDF)](https://a8f0a524-aaf4-4339-bc22-9119eeaaf093.filesusr.com/ugd/01bd19_ec42d3d9ce4b484e8a6b5978e1ba2c03.pdf) | Yes |
| + | [Investment team page (Robert Frost bio)](https://www.ocfunds.com.au/investment-team) | Yes |
