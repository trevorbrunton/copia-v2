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
│  │  • Demo page           │  │  • CSS, JS bundles        │ │
│  │  • API routes (STT,    │  │                           │ │
│  │    match, TTS, avatar) │  │                           │ │
│  │  • Middleware           │  │                           │ │
│  └──────────┬─────────────┘  └───────────────────────────┘ │
└─────────────┼───────────────────────────────────────────────┘
              │
    ┌─────────┼──────────┬────────────────┐
    │         │          │                │
    ▼         ▼          ▼                ▼
┌────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐
│Supabase│ │ElevenLabs│ │AWS Bedrock │ │ LiveAvatar   │
│  (DB)  │ │(STT+TTS) │ │(Haiku LLM) │ │ (Avatar)     │
└────────┘ └──────────┘ └────────────┘ └──────────────┘
  Active      Active       Active         Active

┌────────────────────────────────────────────────────────────┐
│                  CloudFront CDN                             │
│  • /audio/{category}.mp3  — pre-recorded audio             │
│  • /audio/{category}.pcm  — PCM for LiveAvatar lip-sync    │
│  • /video/{category}.mp4  — pre-recorded video             │
│  • /video/idle.mp4        — idle loop                      │
└────────────────────────────────────────────────────────────┘
```

---

## AWS Bedrock

**Status:** Active — question classification for local pipeline (haiku + live modes)

### Account
- **Region:** ap-southeast-2 (Sydney)
- **Credentials:** `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` in `.env.local` (server-side only)

### Configuration

| Setting | Value |
|---------|-------|
| Model | Claude Haiku 4.5 (AU inference profile) |
| Model ID | `au.anthropic.claude-haiku-4-5-20251001-v1:0` |
| Override env var | `BEDROCK_MODEL_ID` (optional) |
| Max tokens | 50 (classification output is a single category name) |
| Temperature | 0 (deterministic classification) |

**Used by:** `src/demo/bedrock-matcher.ts` via `/api/v1/demo/match`

The matcher loads all `demo_responses` + `demo_question_patterns` from the database (cached after first request), builds a system prompt listing every category with example questions, and asks Haiku to return the single best-matching category name. Zero hallucination — the model only selects from existing categories or returns "fallback".

---

## ElevenLabs

**Status:** Active — speech-to-text and text-to-speech

### Account
- **Login:** dev@mayflyventures.com
- **Dashboard:** [elevenlabs.io/app](https://elevenlabs.io/app)
- **API key:** `ELEVENLABS_API_KEY` in `.env.local` (server-side only)

### Features Used

#### 1. Speech-to-Text API (Local Pipeline)

Transcribes user speech captured by the client-side VAD. Called server-side via `/api/v1/demo/transcribe`.

| Setting | Value |
|---------|-------|
| Endpoint | `POST /v1/speech-to-text` |
| Model | `scribe_v1` |
| Language | `eng` (ISO 639-3) |
| Input format | WAV (PCM Int16 LE, wrapped with 44-byte RIFF header) |
| Max upload | 10MB |

**Flow:** Client captures PCM via AudioContext → POSTs to `/api/v1/demo/transcribe` → server wraps in WAV header → sends to ElevenLabs → returns `{ text }`.

#### 2. Conversational AI Agent (Agent Pipeline)

Used for combined STT + RAG + intent classification in video, tavus, and audio modes. The agent classifies questions via `[category_name]` tags in its responses.

| Setting | Value |
|---------|-------|
| Agent ID | `agent_6001kmextzwzevwsje75z9zphqtn` |
| Agent name | OC Mid-Cap Fund - Robert Frost |
| LLM | gemini-2.5-flash |
| Language | en |
| Max duration | 600 seconds |

**Client SDK:** `@11labs/react` — `useConversation()` hook via WebRTC.

**Knowledge base:** Fund PDFs uploaded to the agent dashboard (see `docs/fund-data/README.md`).

#### 3. Text-to-Speech API

Generates speech audio using a custom cloned voice. Used for offline pre-rendering of response audio files.

| Setting | Value |
|---------|-------|
| Endpoint | `POST /v1/text-to-speech/{voice_id}` |
| Voice ID | `ELEVENLABS_VOICE_ID` (custom cloned voice) |
| Model | eleven_flash_v2 |
| Output format | `pcm_24000` (raw PCM, 24kHz, 16-bit signed, mono) |

**Pre-rendered files** served from CloudFront CDN:
- 30 categories: `greeting.mp3/pcm`, `fund_manager.mp3/pcm`, `fees.mp3/pcm`, etc.
- See [DEMO-RESPONSES.md](./DEMO-RESPONSES.md) for full list

---

## LiveAvatar

**Status:** Active — provides lip-synced avatar video (live mode)

### Account
- **Dashboard:** [app.liveavatar.com](https://app.liveavatar.com)
- **API key:** `LIVEAVATAR_API_KEY` in `.env.local` (server-side only)

### Configuration

#### LITE Mode Streaming Avatar

A real-time animated avatar that lip-syncs to audio input. In the local pipeline, LiveAvatar receives pre-recorded PCM audio selected by the Bedrock matcher — it does not generate speech.

| Setting | Value |
|---------|-------|
| Mode | LITE |
| Avatar ID | `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID` (custom avatar) |
| API endpoint | `POST https://api.liveavatar.com/v1/sessions/token` |
| SDK | `@heygen/liveavatar-web-sdk` (v0.0.11) |
| Credit cost | 1 credit/minute |

#### Audio Input

| Setting | Value |
|---------|-------|
| Input method | `session.repeatAudio(audio)` via LiveKit data channel |
| Audio format | Raw PCM, 24kHz, 16-bit signed, mono |
| Chunking | 20ms chunks (960 bytes each) — handled automatically by SDK |
| TTS | None — LiveAvatar's built-in TTS is bypassed |

#### Connection Flow

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
    ├── session.start() → Connect to LiveKit room → video stream
    ├── session.repeatAudio(pcmData) → lip-sync to pre-recorded PCM
    └── session.stop() → disconnect and release credits
```

#### Pricing

| Plan | Credits/month | Cost | Notes |
|------|--------------|------|-------|
| Free | 10 | $0 | ~10 minutes testing |
| Essential | 1,000 | $99/month | 1,000 minutes LITE mode |
| Business | Custom | Contact sales | Higher volumes |

---

## Tavus CVI

**Status:** Active — alternative avatar via Daily.co WebRTC (tavus mode)

### Account
- **API key:** `TAVUS_API_KEY` in `.env.local` (server-side only)

### Configuration

| Setting | Value |
|---------|-------|
| Persona ID | `TAVUS_PERSONA_ID` |
| Replica ID | `TAVUS_REPLICA_ID` (optional) |
| API endpoint | `POST https://tavusapi.com/v2/conversations` |
| Client SDK | `@daily-co/daily-js` (dynamic import) |
| Integration | Echo mode — sends text via Daily `sendAppMessage()` |

---

## CloudFront CDN

**Status:** Active — serves pre-recorded media files

| Setting | Value |
|---------|-------|
| Distribution URL | `https://ds2g5gnw8epol.cloudfront.net` |
| Env var | `NEXT_PUBLIC_MEDIA_BASE_URL` |
| Content | `/audio/{category}.mp3`, `/audio/{category}.pcm`, `/video/{category}.mp4`, `/video/idle.mp4` |
| Categories | 30 (see [DEMO-RESPONSES.md](./DEMO-RESPONSES.md)) |

Leave `NEXT_PUBLIC_MEDIA_BASE_URL` empty for local development to serve from `/public`.

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
- `demo_responses` — 30 pre-scripted answers with category, label, answer text
- `demo_question_patterns` — ~170 question variants mapped to responses

These tables are **queried at runtime** by `bedrock-matcher.ts` in the local pipeline (results cached in memory after first request).

**Other tables** (from the app template):
- `users`, `user_sessions`, `user_devices`, `user_status_history`

### Auth (Not Used by Demo)

Supabase Auth is configured but the demo bypasses it. Middleware redirects auth pages to `/demo`.

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
| `NEXT_PUBLIC_AVATAR_MODE` | Client | Avatar mode: `haiku`, `live`, `video`, `tavus`, `audio` |
| `NEXT_PUBLIC_MEDIA_BASE_URL` | Client | CloudFront CDN URL (empty for local dev) |
| `ELEVENLABS_API_KEY` | Server only | ElevenLabs STT + TTS API |
| `ELEVENLABS_VOICE_ID` | Server only | Custom cloned voice for TTS |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Client | ElevenLabs agent (agent pipeline only) |
| `AWS_REGION` | Server only | AWS region for Bedrock (default: ap-southeast-2) |
| `AWS_ACCESS_KEY_ID` | Server only | AWS credentials for Bedrock |
| `AWS_SECRET_ACCESS_KEY` | Server only | AWS credentials for Bedrock |
| `BEDROCK_MODEL_ID` | Server only | Bedrock model override (optional) |
| `LIVEAVATAR_API_KEY` | Server only | LiveAvatar session creation |
| `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID` | Client + Server | Custom avatar ID |
| `TAVUS_API_KEY` | Server only | Tavus conversation creation |
| `TAVUS_PERSONA_ID` | Server only | Tavus persona |
| `TAVUS_REPLICA_ID` | Server only | Tavus replica (optional) |
| `NEXT_PUBLIC_SUPABASE_URL` | Client + Server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Client + Server | Supabase public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Supabase admin operations |
| `DATABASE_URL` | Server only | PostgreSQL pooled connection |
| `DIRECT_URL` | Server only | PostgreSQL direct connection (migrations) |

---

## Package Dependencies (Demo-Specific)

| Package | Version | Purpose |
|---------|---------|---------|
| `@11labs/react` | 0.2.0 | ElevenLabs Conversational AI React hook |
| `@elevenlabs/client` | 0.15.2 | ElevenLabs SDK |
| `@aws-sdk/client-bedrock-runtime` | 3.x | AWS Bedrock API (Haiku classifier) |
| `@heygen/liveavatar-web-sdk` | 0.0.11 | LiveAvatar streaming avatar SDK |
| `@daily-co/daily-js` | dynamic | Tavus CVI (Daily.co WebRTC) |

---

## Service Costs

| Service | Plan | Monthly Cost | Usage |
|---------|------|-------------|-------|
| ElevenLabs | Creator | ~$22/month | STT (Scribe) + Conversational AI agent + TTS API |
| AWS Bedrock | Pay-per-use | ~$1–5/month | Haiku classification (~50 tokens/request) |
| LiveAvatar | Essential | $99/month | Avatar streaming (LITE mode) |
| CloudFront | Pay-per-use | ~$1/month | Media file serving |
| Supabase | Free | $0 | Database + Auth |
| Vercel | Free/Pro | $0–$20/month | Hosting |
| **Total** | | **~$125–150/month** | |

---

## Monitoring & Debugging

### Server Logs
- `demo:transcribe request` — ElevenLabs STT call (audio size, sample rate)
- `demo:transcribe response` — STT result (text length)
- `demo:match request` — Bedrock matcher call (text length)
- `demo:match response` — matched category
- `demo:transcribe ElevenLabs STT failed` — STT error with response body
- `demo:avatar session request` — LiveAvatar session creation
- Structured JSON in production, readable format in development

### Browser Console
- `"Tavus avatar failed to connect"` — Tavus mode fallback to audio
- `"Avatar failed to connect"` — LiveAvatar mode fallback to audio
- `"Agent connection failed"` — ElevenLabs agent mode fallback
- `"Response video play blocked"` — browser autoplay policy issue

### ElevenLabs Dashboard
- [elevenlabs.io/app/conversational-ai](https://elevenlabs.io/app/conversational-ai) — agent conversation history
- [elevenlabs.io/app/speech-to-text](https://elevenlabs.io/app/speech-to-text) — STT usage and transcription logs
