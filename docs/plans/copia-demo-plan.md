# Copia / OC Mid-Cap Fund — Investor Agent Demo Plan

**Created:** 24 March 2026
**Owner:** Rosie
**Builder:** Trevor
**Internal review:** Friday 28 March 2026
**Client demo:** Wednesday 1 April 2026
**Hour cap:** 20–30 hrs (check in with Rosie before exceeding)

---

## Open Questions (Blockers)

These need answers before or during Phase 1. Items marked 🔴 block progress; 🟡 can be worked around.

| # | Question | Impact | Status |
|---|----------|--------|--------|
| 1 | 🟡 **Standalone page or Next.js app?** Brief says "simple HTML page". Plan assumes standalone static site for speed. Confirm with Rosie. | Frontend approach | ❓ |
| 2 | 🔴 **Tool accounts** — Are HeyGen, ElevenLabs, Voiceflow accounts set up? Need credentials to start. | Blocks avatar + voice + RAG work | ❓ |
| 3 | 🟡 **What is agenticscale.ai?** The BetaShares demo runs on this platform. If it's a product we can use, it might replace the Voiceflow + HeyGen stack entirely. Could save 10+ hours. | Architecture decision | ❓ |
| 4 | 🟡 **ElevenLabs access from Pep** — Brief says Pep will share access to the 11Labs behind BetaShares demo. Has this happened? Could provide voice clone or existing config. | Voice setup | ❓ |
| 5 | 🟡 **PDF #5 (HSBC Global Infrastructure Equity Fund)** — Appears to be a different fund. Include or exclude from knowledge base? | RAG accuracy | ❓ |
| 6 | 🟡 **Robert Frost audio/video** — Any source available for voice cloning? If not, plan assumes a stock Australian male voice from ElevenLabs library. | Voice quality | ❓ |

---

## Deliverables

By **Friday 28 March** (internal review):

- [ ] Working demo accessible via a shareable link
- [ ] Agent answers all 5 required questions accurately
- [ ] Robert Frost avatar is live and lip-syncing
- [ ] Fallback response working for out-of-scope questions
- [ ] Notion documentation completed

---

## Architecture Overview

```
User (browser)
    │
    ▼
┌──────────────────────────┐
│   Static HTML/JS page    │  ← OC Funds branding (blue/grey)
│   (hosted on Vercel/     │
│    Netlify/S3)           │
└──────────┬───────────────┘
           │ user speaks / types question
           ▼
┌──────────────────────────┐
│   Voiceflow Agent        │  ← RAG over fund PDFs
│   (intent matching +     │     Returns text answer
│    knowledge base)       │
└──────────┬───────────────┘
           │ answer text
           ▼
┌──────────────────────────┐
│   ElevenLabs API         │  ← Text-to-speech
│   (Robert Frost voice)   │     Returns audio stream
└──────────┬───────────────┘
           │ audio
           ▼
┌──────────────────────────┐
│   HeyGen Streaming       │  ← Avatar lip-sync
│   Avatar API             │     Returns video stream
│   (Robert Frost face)    │
└──────────────────────────┘
           │ video + audio
           ▼
        User sees and hears
        Robert Frost answering
```

**Alternative (if agenticscale.ai is accessible):** The BetaShares demo may use a single platform that bundles avatar + voice + RAG. If Pep provides access, we could skip the multi-tool integration and build directly on that platform. This should be investigated in Phase 1 before committing to the Voiceflow + HeyGen + ElevenLabs stack.

---

## Phased Plan

### Phase 1: Research & Setup (Day 1 — ~4 hrs)

**Goal:** Accounts ready, tools understood, architecture confirmed.

| Task | Hours | Notes |
|------|-------|-------|
| Investigate agenticscale.ai / BetaShares demo | 1 | Determine if this is a usable platform or custom-built. If usable, this could replace the entire Voiceflow + HeyGen stack. |
| Get credentials from Rosie (HeyGen, ElevenLabs, Voiceflow) | 0.5 | Blocker — cannot proceed without accounts |
| Review BetaShares demo in detail (Marcus + Ava avatars) | 0.5 | Understand UX flow, response time, fallback behaviour |
| Download all 6 source PDFs + investment team page | 0.5 | Verify content covers all 5 questions |
| Review PDFs for data gaps | 1 | Map each of the 5 questions to specific PDF sections. Flag anything missing. |
| Confirm architecture decision with Rosie | 0.5 | agenticscale.ai vs Voiceflow+HeyGen+ElevenLabs |

**Phase 1 exit criteria:**
- All accounts accessible
- Architecture confirmed (single platform vs multi-tool)
- PDF content verified against 5 questions
- Any data gaps flagged to Rosie

---

### Phase 2: Knowledge Base & Agent (Days 1–2 — ~6 hrs)

**Goal:** Agent answers all 5 questions accurately via text.

| Task | Hours | Notes |
|------|-------|-------|
| Ingest PDFs into Voiceflow knowledge base | 1 | Start with main fund page + Latest Fund Report. Add remaining PDFs. |
| Configure agent system prompt | 1.5 | Persona: Robert Frost, Head of Investments. Tone: professional, measured, confident. Must not hallucinate numbers. |
| Build question intents for the 5 required questions | 1.5 | Each question should have 3–5 phrasing variants for robustness. |
| Configure fallback response | 0.5 | "That's a great question — I'd suggest speaking directly with our investor relations team for more detail on that." |
| Test all 5 questions — verify answers against reference data | 1.5 | Cross-check against the answer table in the brief. Benchmark comparison question is highest priority. |

**System prompt guidance:**
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
```

**Phase 2 exit criteria:**
- Agent correctly answers all 5 questions via text
- Fallback works for out-of-scope questions
- No hallucinated numbers
- Benchmark comparison answer is factual and contextualised

---

### Phase 3: Avatar & Voice (Days 2–3 — ~6 hrs)

**Goal:** Robert Frost avatar speaks with a professional Australian voice.

| Task | Hours | Notes |
|------|-------|-------|
| Source Robert Frost photo from OC Funds website | 0.5 | High-res, front-facing preferred for HeyGen |
| Create HeyGen avatar from photo | 1 | Test different avatar styles. May need to try multiple photos. |
| Search for Robert Frost audio/video for voice cloning | 1 | Podcasts, conference talks, interviews. If nothing found, use stock voice. |
| Set up ElevenLabs voice (clone or stock selection) | 1 | If cloning: need ~1 min of clean speech. If stock: select most professional Australian male voice. |
| Integrate ElevenLabs with HeyGen streaming | 1.5 | Connect TTS output to avatar lip-sync. Test latency. |
| Test end-to-end: question → text answer → voice → avatar | 1 | Verify lip-sync quality, response lag, audio clarity |

**Phase 3 exit criteria:**
- Avatar looks like Robert Frost
- Voice sounds professional and appropriate (cloned or stock)
- Lip-sync is working
- End-to-end latency is acceptable (< 5 seconds response start)

---

### Phase 4: Frontend & Integration (Days 3–4 — ~6 hrs)

**Goal:** Polished, shareable demo page.

| Task | Hours | Notes |
|------|-------|-------|
| Build static HTML page with OC Funds branding | 2 | Blue/grey colour scheme. Clean, minimal. Logo if available from their site. |
| Integrate Voiceflow widget or custom chat interface | 1.5 | Voice input preferred (microphone button). Text input as fallback. |
| Connect avatar stream to frontend | 1.5 | HeyGen streaming embed or API integration |
| Deploy to shareable URL | 0.5 | Vercel, Netlify, or similar. Must work on any browser without login. |
| Cross-browser testing (Chrome, Safari, mobile) | 0.5 | Demo will likely be shown on a laptop in a meeting room |

**Frontend design principles:**
- Hero: avatar video takes centre stage
- Minimal chrome — no visible "chatbot" UI. This should feel like a video call with Robert Frost.
- Microphone button prominent — voice-first interaction
- Text input available but secondary
- OC Funds branding: navy blue (#1a365d or similar), white, light grey
- No Mayfly branding visible

**Phase 4 exit criteria:**
- Demo accessible via shareable link (no login required)
- Works on Chrome and Safari
- Avatar is prominent, interface is clean
- Voice and text input both functional

---

### Phase 5: QA & Polish (Day 4–5 — ~4 hrs)

**Goal:** Demo is reliable enough for a client meeting.

| Task | Hours | Notes |
|------|-------|-------|
| Run all 5 questions 3x each — verify consistency | 1 | Answers should be consistent, not identical (natural variation is good) |
| Test edge cases: rapid questions, interruptions, silence | 0.5 | Should handle gracefully |
| Test fallback: ask off-topic questions | 0.5 | "What's the weather?" / "Tell me about BetaShares" / technical jargon |
| Optimise response latency | 0.5 | Target: <5s from question end to avatar speaking |
| Final polish: loading states, error handling | 0.5 | If connection drops, show a clean error, not a blank screen |
| Internal review with Rosie and Gio | 1 | Friday 28 March. Run through all 5 questions live. |

**Phase 5 exit criteria:**
- All 5 questions answered correctly and consistently
- Fallback works cleanly
- Response time < 5 seconds
- No crashes or blank screens
- Rosie and Gio sign off

---

### Phase 6: Documentation (Ongoing — ~2 hrs)

**Goal:** Someone else can replicate this for the next fund in a day.

| Task | Hours | Notes |
|------|-------|-------|
| Architecture diagram in Notion | 0.5 | What talks to what |
| Service inventory (tools, plans, costs) | 0.5 | HeyGen, ElevenLabs, Voiceflow — plan tiers, monthly cost |
| Credentials in 1Password, linked from Notion | 0.5 | API keys, account logins |
| Key IDs: avatar ID, voice ID, agent URL, demo link | 0.25 | Quick reference for maintenance |
| Known limitations and out-of-scope items | 0.25 | What it can't do, what was deliberately excluded |

---

## Hour Budget Summary

| Phase | Hours | Cumulative |
|-------|-------|------------|
| 1. Research & Setup | 4 | 4 |
| 2. Knowledge Base & Agent | 6 | 10 |
| 3. Avatar & Voice | 6 | 16 |
| 4. Frontend & Integration | 6 | 22 |
| 5. QA & Polish | 4 | 26 |
| 6. Documentation | 2 | 28 |
| **Total** | **28** | |

This is within the 20–30 hour cap. Buffer of 2 hours for unexpected issues.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **HeyGen avatar quality poor** from single photo | Medium | High | Try multiple photos, angles. Fallback: use a HeyGen stock avatar with custom voice (less impressive but functional) |
| **Voice cloning fails** (no Robert Frost audio available) | Medium | Medium | Use best available stock Australian male voice from ElevenLabs |
| **PDF parsing issues** — tables/charts not extracted correctly | Medium | High | Manually extract key data points (performance numbers, fund facts) and add as structured text to knowledge base |
| **Response latency too high** (>10 seconds) | Medium | High | Pre-cache common questions. Reduce avatar quality. Consider pre-recorded responses for the 5 known questions as absolute fallback. |
| **Voiceflow RAG hallucination** on numbers | Low | Critical | Explicit system prompt instructions to never invent numbers. Test extensively. Add verification step in prompt chain. |
| **agenticscale.ai not accessible** | Medium | Low | Proceed with Voiceflow+HeyGen+ElevenLabs stack as planned |
| **Accounts/credentials delayed** | Medium | High | Flag to Rosie immediately. Cannot start Phases 2–4 without them. |

---

## Key Decisions Log

| Decision | Options | Chosen | Rationale |
|----------|---------|--------|-----------|
| Frontend approach | Next.js app vs standalone HTML | Standalone HTML (pending confirmation) | Faster to build, easier to share, no auth needed |
| Hosting | Vercel / Netlify / S3 | TBD | Whatever is fastest to deploy with a clean URL |
| Voice approach | Clone vs stock | TBD — depends on available audio | Clone is better but requires source material |
| Platform | agenticscale.ai vs multi-tool | TBD — investigate in Phase 1 | If agenticscale.ai is available and good, it could save 10+ hours |

---

## Daily Schedule (Suggested)

| Day | Date | Focus | Target |
|-----|------|-------|--------|
| 1 | Tue 25 Mar | Phase 1 + start Phase 2 | Accounts ready, PDFs ingested, agent answering questions |
| 2 | Wed 26 Mar | Finish Phase 2 + Phase 3 | All 5 questions accurate, avatar + voice working |
| 3 | Thu 27 Mar | Phase 4 | Frontend built, everything integrated, shareable link live |
| 4 | Fri 28 Mar | Phase 5 + Phase 6 | QA complete, documentation done, internal review with Rosie + Gio |
| 5 | Mon 31 Mar | Buffer | Fix any issues from internal review |

---

## Reference Links

- [BetaShares demo (quality bar)](https://betashares.agenticscale.ai/)
- [OC Mid-Cap Fund page](https://www.ocfunds.com.au/mid-cap-fund)
- [OC Funds Investment Team (Robert Frost)](https://www.ocfunds.com.au/investment-team)
- [HeyGen](https://www.heygen.com/)
- [ElevenLabs](https://elevenlabs.io/)
- [Voiceflow](https://www.voiceflow.com/)
