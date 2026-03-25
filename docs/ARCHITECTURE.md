# Architecture

System architecture for the Copia OC Mid-Cap Fund investor demo — an AI voice agent that answers investor questions as Robert Frost, Head of Investments at OC Funds Management.

**Related document:** [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — external services, accounts, and deployment.

---

## System Overview

The system supports two processing pipelines, selected by `NEXT_PUBLIC_AVATAR_MODE`:

### Local Pipeline (haiku + live modes)

Uses client-side voice activity detection, ElevenLabs STT, and AWS Bedrock Haiku for zero-hallucination response matching against the database.

- **Voice capture** — `useVoiceListener` (AudioContext + ScriptProcessorNode, amplitude-based VAD)
- **Speech-to-text** — ElevenLabs Scribe API (`scribe_v1`, via `/api/v1/demo/transcribe`)
- **Response matching** — AWS Bedrock Claude Haiku classifies question → best DB category (via `/api/v1/demo/match`)
- **Response playback** — Pre-recorded video/audio (haiku mode) or PCM sent to LiveAvatar (live mode)

### Agent Pipeline (video, tavus, audio modes)

Uses the ElevenLabs Conversational AI agent for combined STT + RAG + response generation.

- **ElevenLabs Conversational AI** — WebRTC connection for real-time STT, intent classification via category tags
- **Category tag extraction** — Agent returns `[category_name]` tags, matched to `PREGENERATED` response map
- **Response playback** — Pre-recorded video (video mode), Tavus CVI echo (tavus mode), or MP3 audio (audio mode)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                          │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     useDemo() hook                        │   │
│  │                                                          │   │
│  │  Local Pipeline (haiku/live):    Agent Pipeline (other):  │   │
│  │  useVoiceListener (VAD)          useConversation          │   │
│  │    → /api/v1/demo/transcribe       (ElevenLabs WebRTC)   │   │
│  │    → /api/v1/demo/match            → category tag parse   │   │
│  │    → playResponse()                → playResponse()       │   │
│  └──────────────────────────────────────────────────────────┘   │
│                           │                                     │
│  ┌─────────────┐  ┌──────┴───────┐  ┌────────────────────────┐ │
│  │  DemoPage    │  │ AvatarPanel  │  │  ChatPanel + StatusBadge│ │
│  │  (layout)    │  │ (dual-layer  │  │  (messages + status)    │ │
│  │              │  │  video)      │  │                        │ │
│  └──────────────┘  └─────────────┘  └────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
    ┌────┘          ┌────────┘          ┌─────────┘
    ▼               ▼                   ▼
┌──────────┐ ┌──────────────┐ ┌──────────────────┐
│ ElevenLabs│ │ AWS Bedrock  │ │ LiveAvatar /     │
│ STT API   │ │ Claude Haiku │ │ Tavus CVI       │
│ (scribe)  │ │ (classifier) │ │ (lip-sync)      │
└──────────┘ └──────────────┘ └──────────────────┘
```

---

## Avatar Modes

| Mode | Env Value | Input Pipeline | Output Rendering |
|------|-----------|---------------|------------------|
| **Haiku** | `haiku` | Local (VAD → STT → Bedrock) | Pre-recorded MP4 video + embedded audio |
| **Live** | `live` | Local (VAD → STT → Bedrock) | LiveAvatar lip-sync from PCM |
| **Video** | `video` | Agent (ElevenLabs Conv. AI) | Pre-recorded MP4 video + embedded audio |
| **Tavus** | `tavus` | Agent (ElevenLabs Conv. AI) | Tavus CVI echo (Daily.co WebRTC) |
| **Audio** | `audio` | Agent (ElevenLabs Conv. AI) | MP3 audio playback (no avatar) |

The `USE_LOCAL_PIPELINE` flag (`config.ts`) controls which pipeline is active. It is `true` for `haiku` and `live` modes.

---

## Process Flows

### Flow 1: Start Conversation (All Modes)

```
User visits /demo → "Start Conversation" button shown
    │
    ▼
User clicks button (user gesture — unlocks browser audio)
    │
    ├──▶ Init avatar (live: LiveAvatar session, tavus: Daily.co room)
    │
    ├──▶ Play greeting video/audio (routed by avatar mode)
    │
    └──▶ Start input pipeline:
         Local pipeline → voiceListener.start() (continuous VAD)
         Agent pipeline → conversation.startSession() (ElevenLabs WebRTC)
```

### Flow 2: Local Pipeline — Question → Response (haiku + live)

```
User speaks → VAD detects speech above threshold (0.015 RMS)
    │
    ▼
User pauses → silence timeout (1.5s) → utterance captured as PCM Int16
    │
    ▼
Listener paused (prevents feedback loop)
    │
    ▼
POST /api/v1/demo/transcribe
    │  PCM → WAV header → ElevenLabs STT (scribe_v1, lang: eng)
    │  Returns: { text: "What are the fees?" }
    │
    ▼
POST /api/v1/demo/match
    │  User text → Bedrock Haiku classifier
    │  Loads demo_responses + demo_question_patterns from DB (cached)
    │  Returns: { category: "fees", answerText: "...", audioUrl, pcmUrl, videoUrl }
    │
    ▼
Show answer text in chat panel
    │
    ├── Haiku mode: play MP4 video (with embedded audio)
    │   └── Fallback: play MP3 if no video exists
    │
    └── Live mode: fetch PCM → avatar.speakAudio(base64)
        └── Wait estimated duration before resuming
        └── Fallback: play MP3 if avatar not ready
    │
    ▼
Listener resumed → ready for next question
```

### Flow 3: Agent Pipeline — Question → Response (video, tavus, audio)

```
User speaks → ElevenLabs agent transcribes (WebRTC STT)
    │
    ▼
Agent processes via RAG → returns text with [category_name] tag
    │
    ▼
App extracts category → looks up PREGENERATED[category]
    │
    ├── Match found: play pre-recorded response (video/tavus/audio)
    └── No match: show agent's generated text in chat
```

---

## Component Architecture

### Page Structure

```
app/demo/page.tsx                 Server component (metadata)
    │
    ▼
components/demo/demo-page.tsx     Client component (useDemo hook)
    ├── AvatarPanel               Dual-layer video (idle loop + response overlay)
    ├── StatusBadge               Ready / Listening / Thinking / Speaking
    ├── ErrorBanner               Dismissible error display
    └── ChatPanel                 Message list with auto-scroll
```

### Hook Architecture

```
useDemo()
    │
    ├── useVoiceListener()        Continuous VAD + PCM capture
    │     speechThreshold, silenceTimeoutMs, minSpeechDurationMs (configurable)
    │     onUtterance callback → handleUtterance
    │     pause()/resume() — suspended during response playback
    │
    ├── useConversation()         ElevenLabs agent (non-local-pipeline modes)
    │     onMessage → category tag extraction → playResponse
    │
    ├── useAvatar()               HeyGen LiveAvatar SDK (live mode)
    │     initAvatar() → speakAudio(base64) → stopAvatar()
    │
    └── useTavusAvatar()          Tavus CVI via Daily.co (tavus mode)
          initAvatar() → echo(text) → stopAvatar()
```

---

## Audio Architecture

### Formats

| Context | Format | Notes |
|---|---|---|
| Voice capture (VAD) | PCM Int16 LE, browser sample rate (~48kHz) | AudioContext + ScriptProcessorNode |
| Transcribe API | WAV (PCM Int16 + 44-byte RIFF header) | Server wraps PCM before sending to ElevenLabs |
| Pre-recorded audio | MP3 (`/audio/{category}.mp3`) | CloudFront CDN |
| Pre-recorded PCM | PCM 24kHz 16-bit mono (`/audio/{category}.pcm`) | For LiveAvatar `speakAudio()` |
| Pre-recorded video | MP4 (`/video/{category}.mp4`) | With embedded audio track |

### Voice Consistency

All pre-recorded audio/video uses the same ElevenLabs custom cloned voice (`ELEVENLABS_VOICE_ID`). In live mode, LiveAvatar's built-in TTS is bypassed — `session.repeatAudio()` plays pre-rendered PCM directly.

---

## Data Architecture

### Database Tables (Supabase PostgreSQL)

```
demo_responses
    ├── id (uuid, PK)
    ├── category (text, unique)    e.g. "fund_manager"
    ├── label (text)               e.g. "Who manages the fund?"
    ├── answer_text (text)         Full scripted answer
    ├── audio_url (text, nullable) URL to pre-generated audio
    ├── sort_order (integer)
    └── timestamps

demo_question_patterns
    ├── id (uuid, PK)
    ├── response_id (uuid, FK → demo_responses)
    ├── pattern (text)             e.g. "Who runs the fund?"
    ├── is_canonical (integer)     1 = primary phrasing
    └── created_at
```

In the **local pipeline**, these tables are queried at runtime by `bedrock-matcher.ts` to build the classification prompt. Results are cached in memory after the first request (static seed data).

In the **agent pipeline**, responses are hardcoded in `classifier.ts` (`PREGENERATED` map). The database is not queried.

### Response Categories

30 categories covering fund overview, performance, team, fees, investment process, ESG, contact, and more. See [DEMO-RESPONSES.md](./DEMO-RESPONSES.md) for the complete list.

---

## Security Model

### API Key Protection

| Variable | Scope | Purpose |
|---|---|---|
| `ELEVENLABS_API_KEY` | Server only | ElevenLabs STT + TTS API calls |
| `ELEVENLABS_VOICE_ID` | Server only | Custom cloned voice for TTS |
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Client | ElevenLabs Conversational AI agent (not a secret) |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Server only | Bedrock Haiku API calls |
| `LIVEAVATAR_API_KEY` | Server only | LiveAvatar session creation |
| `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID` | Client + Server | Custom avatar ID |
| `TAVUS_API_KEY` | Server only | Tavus conversation creation |

### Input Validation

- `/api/v1/demo/match` — text max 1000 characters
- `/api/v1/demo/transcribe` — audio max 10MB
- All demo routes are intentionally unauthenticated (public demo page)

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| ElevenLabs STT fails | Error shown in banner, listener resumes |
| Bedrock Haiku fails | Error shown in banner, listener resumes |
| LiveAvatar session fails | Falls back to MP3 audio playback |
| Pre-recorded video missing | Falls back to MP3 audio playback |
| ElevenLabs agent fails to connect | Error shown, text responses still work |
| Network error during processing | Error banner, busy state cleared, listener resumes |

The system degrades gracefully — text responses always display regardless of audio or avatar failures.
