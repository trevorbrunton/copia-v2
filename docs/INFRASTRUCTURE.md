# Infrastructure

External services, accounts, and deployment configuration for the Copia OC Mid-Cap Fund investor demo.

**Related document:** [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, process flows, and component structure.

---

## Service Map

```
┌─────────────────────────────────────────────────────────────┐
│                    Vercel (Hosting)                          │
│                                                             │
│  ┌────────────────────────┐  ┌───────────────────────────┐ │
│  │  Next.js 16 App        │  │  Static Assets            │ │
│  │  • Demo page           │  │  • /audio/*.pcm (cached)  │ │
│  │  • API routes (TTS,    │  │  • CSS, JS bundles        │ │
│  │    avatar session)     │  │                           │ │
│  │  • Middleware           │  │                           │ │
│  └──────────┬─────────────┘  └───────────────────────────┘ │
└─────────────┼───────────────────────────────────────────────┘
              │
    ┌─────────┼──────────────────┐
    │         │                  │
    ▼         ▼                  ▼
┌────────┐ ┌────────────┐ ┌──────────────┐
│Supabase│ │ ElevenLabs │ │  LiveAvatar  │
│  (DB)  │ │(NLU + TTS) │ │  (Avatar)    │
└────────┘ └────────────┘ └──────────────┘
  Active      Active         Active
```

---

## ElevenLabs

**Status:** Active — primary voice AI service

### Account
- **Login:** dev@mayflyventures.com
- **Dashboard:** [elevenlabs.io/app](https://elevenlabs.io/app)
- **API key:** `ELEVENLABS_API_KEY` in `.env.local` (server-side only)

### Features Used

#### 1. Conversational AI Agent (NLU + Intent Classification)

Used for intent classification and response generation. The agent determines whether a user question matches a known category (returning an intent label) or generates a novel response using RAG. The agent does **not** produce audio — it returns text only.

| Setting | Value |
|---------|-------|
| Agent ID | `agent_6001kmextzwzevwsje75z9zphqtn` |
| Agent name | OC Mid-Cap Fund - Robert Frost |
| LLM | gemini-2.5-flash |
| Language | en |
| First message | (empty — greeting handled by pre-rendered audio) |
| Max duration | 600 seconds |

**Agent output format:**
- Known intent: `{ "intent": "recent_performance", "confidence": 0.92 }`
- Unknown intent: `{ "intent": "unknown", "generatedResponse": "The fund's distribution policy is..." }`

**Knowledge base:** Fund PDFs uploaded to the agent dashboard:
- OC Mid-Cap Fund main page
- Latest Fund Report
- Fund PDS documents
- Investment team page
(See `docs/fund-data/README.md` for the full list of source documents)

**System prompt:**
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

**API permissions required on the API key:**
- `convai_read` — read agent configuration
- `convai_write` — update agent configuration
- `user_read` — account access
- `voices_read` — voice access

**Client SDK:** `@11labs/react` (v0.2.0) + `@elevenlabs/client` (v0.15.2)
- Agent ID exposed via `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` (safe — not a secret)

#### 2. Text-to-Speech API (Voice Synthesis)

Generates speech audio using a custom cloned voice. Used in two contexts:

**Offline (pre-rendering):** Called by `scripts/generate-audio.ts` to pre-render PCM audio files for known answer categories. Run once when answer text changes.

**Runtime:** Called server-side via `/api/v1/demo/tts` when the agent generates a novel response to an unknown question. The PCM audio is returned to the client and piped to LiveAvatar for lip-sync.

| Setting | Value |
|---------|-------|
| Endpoint (batch) | `POST /v1/text-to-speech/{voice_id}` |
| Endpoint (streaming) | `POST /v1/text-to-speech/{voice_id}/stream` |
| Voice ID | `ELEVENLABS_VOICE_ID` (custom cloned voice) |
| Model | eleven_flash_v2 |
| Output format | `pcm_24000` (raw PCM, 24kHz, 16-bit signed, mono) |

The same voice ID and output format are used for both offline and runtime generation, guaranteeing voice consistency.

**Pre-rendered files** stored in `public/audio/`:
- `greeting.pcm`
- `fund_manager.pcm`
- `investment_strategy.pcm`
- `since_inception_return.pcm`
- `recent_performance.pcm`
- `benchmark_comparison.pcm`
- `fallback.pcm`

**To regenerate audio** (e.g. after updating answer text):
```bash
bun scripts/generate-audio.ts
```

#### How ElevenLabs connects to the app

See [ARCHITECTURE.md — Process Flows](./ARCHITECTURE.md#process-flows) for the full process flows.

**Agent (NLU):**
```
Browser                              ElevenLabs Agent
───────                              ────────────────
Send user question (text)
    │
    ▼
Agent classifies intent via RAG + LLM
    │
    ▼
Returns intent label or generated text
    │  (no audio — text only)
    ▼
App routes to pre-generated answer or runtime TTS
```

**TTS API (runtime, for unknown questions):**
```
App Server                           ElevenLabs TTS API
──────────                           ──────────────────
POST /v1/text-to-speech/{voice_id}/stream
    body: { text, model_id, output_format: "pcm_24000" }
    │
    ▼
PCM audio stream returned
    │
    ▼
Forwarded to client → session.repeatAudio(pcmData)
```

---

## LiveAvatar

**Status:** Active — provides lip-synced avatar video

### Account
- **Dashboard:** [app.liveavatar.com](https://app.liveavatar.com)
- **API key:** `LIVEAVATAR_API_KEY` in `.env.local` (server-side only)

### Configuration

#### LITE Mode Streaming Avatar

A real-time animated avatar that lip-syncs to audio input. LiveAvatar operates in LITE mode — the app controls all NLU, TTS, and orchestration; LiveAvatar only handles avatar rendering and lip-sync.

| Setting | Value |
|---------|-------|
| Mode | LITE |
| Avatar ID | `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID` (custom avatar) |
| API endpoint | `POST https://api.liveavatar.com/v1/sessions/token` |
| SDK | `@heygen/liveavatar-web-sdk` (v0.0.11) |
| Credit cost | 1 credit/minute |

#### Audio Input (Primary Integration)

The avatar receives PCM audio via `session.repeatAudio(pcmData)` and lip-syncs to it. This method is used instead of `session.message(text)` to maintain voice consistency — all audio is generated by ElevenLabs with the custom cloned voice.

| Setting | Value |
|---------|-------|
| Input method | `session.repeatAudio(audio)` via LiveKit data channel |
| Audio format | Raw PCM, 24kHz, 16-bit signed, mono |
| Chunking | 20ms chunks (960 bytes each) — handled automatically by SDK |
| TTS | None — LiveAvatar's built-in TTS is bypassed |

**SDK methods used:**
- `session.start()` — connects to LiveKit room, receives video stream
- `session.attach(videoElement)` — renders avatar in a `<video>` element
- `session.repeatAudio(pcmData)` — sends PCM audio for lip-sync
- `session.interrupt()` — stops current speech
- `session.stop()` — disconnects and releases credits

**SDK events used:**
- `avatar.speak_started` — avatar begins speaking
- `avatar.speak_ended` — avatar finishes speaking
- `session.state_changed` — connection state changes
- `session.disconnected` — session ended

#### Alternative Methods (Not Used)

The SDK also exposes these methods, which are **not used** in the current architecture:

- `session.message(text)` — sends text for LiveAvatar's built-in TTS (bypassed for voice consistency)
- `session.repeat(text)` — similar to message (bypassed)
- `session.startListening()` / `session.stopListening()` — microphone input (not needed; questions are typed)

#### How LiveAvatar connects to the app

See [ARCHITECTURE.md — Process Flows](./ARCHITECTURE.md#process-flows) for the full process flows.

```
Browser                    Our Server               LiveAvatar
───────                    ──────────               ──────────
                     POST /api/v1/demo/avatar
                           │
                           ├── POST /v1/sessions/token
                           │     (x-api-key header)
                           │     body: { mode: "LITE", avatar_id: "..." }
                           │                              │
                           │◀─── session_token ───────────┘
                           │
        ◀── { sessionToken } ──┘

LiveAvatarSession(token)
    │
    ├── session.start()
    │       → Connects to LiveKit room
    │       → Receives video stream
    │       → session.attach(videoElement)
    │
    ├── session.repeatAudio(pcmData)
    │       → PCM audio sent via LiveKit data channel
    │       → Avatar lip-syncs to audio
    │       → Voice is ElevenLabs custom voice (not LiveAvatar TTS)
    │
    └── session.stop()
            → Disconnects and releases credits
```

#### Custom Avatar Setup

- Create or configure a custom avatar in the LiveAvatar dashboard
- Set the avatar ID via `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID` environment variable
- The avatar receives audio only — it does not generate speech; it lip-syncs to whatever PCM audio is sent via `repeatAudio()`

#### Pricing

| Plan | Credits/month | Cost | Notes |
|------|--------------|------|-------|
| Free | 10 | $0 | Enough for ~10 minutes of testing |
| Essential | 1,000 | $99/month | 1,000 minutes LITE mode |
| Business | Custom | Contact sales | Higher volumes |

---

## HeyGen (Legacy)

**Status:** Deprecated — the Streaming Avatar API was sunset at end of March 2026

The original plan used HeyGen's Streaming Avatar API directly. This was abandoned due to:
1. API deprecation (end of March 2026)
2. Zero streaming avatar quota on the Business plan
3. HeyGen migrated all users to LiveAvatar

**API key:** `HEYGEN_API_KEY` in `.env.local` (kept for reference, not used)

---

## Supabase

**Status:** Active — database and auth infrastructure

### PostgreSQL Database

| Setting | Value |
|---------|-------|
| Project URL | `pcrdkfypuylhjumybvgn.supabase.co` |
| Pooled connection (port 6543) | `DATABASE_URL` |
| Direct connection (port 5432) | `DIRECT_URL` (migrations) |

**Demo-specific tables:**
- `demo_responses` — 28 pre-scripted answers (6 original + 22 extended)
- `demo_question_patterns` — ~45 question variants mapped to responses

**Other tables** (from the original app template):
- `users`, `user_sessions`, `user_devices`, `user_status_history`

### Auth (Not Used by Demo)

Supabase Auth is configured (AuthProvider wraps the app) but the demo bypasses it entirely. Middleware redirects auth pages to `/demo`.

---

## Deployment

### Vercel

| Setting | Value |
|---------|-------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Runtime | Node.js |
| Build command | `bun run build` |
| Dev command | `bun dev` |

### Environment Variables Required

| Variable | Where | Purpose |
|----------|-------|---------|
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Client | ElevenLabs agent identifier (not a secret) |
| `ELEVENLABS_API_KEY` | Server only | ElevenLabs TTS API (offline + runtime) |
| `ELEVENLABS_VOICE_ID` | Server only | Custom cloned voice for TTS |
| `LIVEAVATAR_API_KEY` | Server only | LiveAvatar session creation |
| `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID` | Client + Server | Custom avatar ID |
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client + Server | Supabase public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase admin operations |
| `DATABASE_URL` | Server only | PostgreSQL pooled connection |
| `DIRECT_URL` | Server only | PostgreSQL direct connection (migrations) |

### Static Assets

Pre-rendered PCM audio files in `public/audio/` are served as static assets by Vercel's CDN. These are generated offline using the ElevenLabs TTS API with the custom cloned voice. Runtime TTS is only needed for unknown questions.

---

## Package Dependencies (Demo-Specific)

| Package | Version | Purpose |
|---------|---------|---------|
| `@11labs/react` | 0.2.0 | ElevenLabs Conversational AI React hook (NLU) |
| `@elevenlabs/client` | 0.15.2 | ElevenLabs SDK (TTS API calls) |
| `@heygen/liveavatar-web-sdk` | 0.0.11 | LiveAvatar streaming avatar SDK |

---

## Service Costs

| Service | Plan | Monthly Cost | Usage |
|---------|------|-------------|-------|
| ElevenLabs | Creator | ~$22/month | Conversational AI agent (NLU) + TTS API |
| LiveAvatar | Essential | $99/month | Avatar streaming (LITE mode) |
| Supabase | Free | $0 | Database + Auth |
| Vercel | Free/Pro | $0–$20/month | Hosting |
| **Total** | | **~$121/month** | |

---

## Monitoring & Debugging

### ElevenLabs Agent Logs
- Dashboard: [elevenlabs.io/app/conversational-ai](https://elevenlabs.io/app/conversational-ai)
- View conversation history, agent responses, and usage

### Browser Console
Key log messages to watch for:
- `"websocket closed"` — LiveKit initial connection retry (normal)
- `"Initial connection failed: v1 RTC path not found"` — LiveKit retry (normal, resolves on second attempt)
- `"Session start failed"` — LiveAvatar credit/quota issue
- `"sending message command event"` — Avatar speak command (when avatar active)

### Server Logs
- `demo:avatar session request` — LiveAvatar session creation
- Structured JSON logs in production, readable format in development
