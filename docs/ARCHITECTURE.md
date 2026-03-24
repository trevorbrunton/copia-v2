# Architecture

System architecture for the Copia OC Mid-Cap Fund investor demo — an AI voice agent that answers investor questions as Robert Frost, Head of Investments at OC Funds Management.

**Related document:** [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — external services, accounts, and deployment.

---

## System Overview

The system uses three external services with clear separation of concerns:

- **ElevenLabs Conversational AI** — intent classification and response generation (NLU + RAG)
- **ElevenLabs TTS API** — speech synthesis with a custom cloned voice
- **LiveAvatar** — lip-synced avatar video driven by the generated audio

The app orchestrates these services and maintains a set of pre-generated answers for common questions to provide instant responses.

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser (Client)                         │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐│
│  │  DemoPage     │  │  AvatarPanel │  │  ChatPanel +       ││
│  │  (layout)     │  │  (LiveAvatar │  │  ChatInput         ││
│  │               │  │   video)     │  │                    ││
│  └──────┬───────┘  └──────┬───────┘  └────────┬───────────┘│
│         │                 │                    │            │
│         ▼                 ▼                    ▼            │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                    useDemo() hook                        ││
│  │                                                         ││
│  │  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐ ││
│  │  │ Pre-generated│  │ ElevenLabs   │  │ LiveAvatar    │ ││
│  │  │ answer store │  │ Agent (NLU)  │  │ session       │ ││
│  │  └──────────────┘  └──────────────┘  └───────────────┘ ││
│  └────────────────────────────────────────────────────────-┘│
└─────────────────────────────────────────────────────────────┘
         │                      │                    │
         │                      │                    │
    Pre-rendered           NLU + RAG           LiveKit (WebRTC)
    PCM audio files        (no audio)          video + audio commands
         │                      │                    │
         ▼                      ▼                    ▼
  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐
  │ ElevenLabs   │  │ ElevenLabs       │  │ LiveAvatar       │
  │ TTS API      │  │ Conversational   │  │ LITE Mode        │
  │              │  │ AI Agent         │  │                  │
  │ Custom voice │  │ • RAG knowledge  │  │ • Lip-sync from  │
  │ pcm_24000    │  │ • Intent classif.│  │   PCM audio      │
  │              │  │ • LLM response   │  │ • Avatar video   │
  └──────────────┘  └──────────────────┘  └──────────────────┘
```

---

## Process Flows

### Flow 1: Page Load → Start Conversation

```
User visits /demo
    │
    ▼
Landing page renders (branded, no auth required)
    │
    ▼
User clicks "Start Now" on landing page (app/(public)/page.tsx)
    │
    ▼
Navigates to /demo (app/(app)/demo/page.tsx)
    │
    ▼
DemoPage renders → "Start Conversation" button shown
    │
    ▼
User clicks "Start Conversation" (user gesture — unlocks browser audio)
    │
    ├──▶ Create LiveAvatar session
    │      POST /api/v1/demo/avatar → session token
    │      session.start() → LiveKit room connected
    │      session.attach(videoElement) → avatar video renders
    │
    ├──▶ Play greeting via LiveAvatar
    │      Load pre-rendered PCM: /audio/greeting.pcm
    │      session.repeatAudio(pcmData)
    │      Text: "Hello, I'm Robert Frost..."
    │      Avatar lip-syncs the greeting
    │
    └──▶ Connect to ElevenLabs agent in background
           For intent classification (NLU only, no audio)
           Status: "Connected" shown in chat header
```

### Flow 2: Known Question (Pre-generated Path — Instant)

```
User types: "Who is the manager of the fund?"
    │
    ▼
Send to ElevenLabs Agent (NLU)
    │
    ▼
Agent classifies intent
    │  Match: intent "fund_manager", confidence 0.92
    │
    ▼
App looks up pre-generated answer
    │  Text from local answer store → added to chat immediately
    │  PCM audio from /audio/fund_manager.pcm
    │
    ▼
session.repeatAudio(pcmData)
    │  LiveAvatar lip-syncs to pre-rendered audio
    │  Custom ElevenLabs voice (generated offline)
    │
    │  Total latency: agent classification time + audio start
```

### Flow 3: Unknown Question (Runtime TTS Path)

```
User types: "What are the risks of investing?"
    │
    ▼
Send to ElevenLabs Agent (NLU + RAG)
    │
    ▼
Agent returns: { intent: "unknown", generatedResponse: "..." }
    │  Searches fund document knowledge base
    │  Generates response with LLM
    │
    ▼
App displays generated text in chat panel
    │
    ▼
App calls ElevenLabs TTS API
    │  POST /v1/text-to-speech/{voice_id}/stream
    │  output_format: "pcm_24000"
    │  Same custom cloned voice as pre-generated answers
    │
    ▼
PCM audio stream received
    │
    ▼
session.repeatAudio(pcmData)
    │  LiveAvatar lip-syncs to runtime-generated audio
    │  Voice is consistent with pre-generated answers
    │
    │  Total latency: agent + TTS + avatar start (~2–5 seconds)
```

### Flow 4: Agent Not Connected (Fallback)

```
User types question but ElevenLabs agent is disconnected
    │
    ▼
Show fallback text in chat
    │  "That's a great question — I'd suggest speaking
    │   directly with our investor relations team..."
    │
    ▼
Load pre-rendered fallback PCM audio
    │
    ▼
session.repeatAudio(pcmData)
    │  Avatar speaks the fallback response
```

---

## Component Architecture

### Page Structure

```
app/(public)/page.tsx          Landing page ("Start Now" button)
    │
    ▼
app/(app)/demo/page.tsx        Demo page (server component, metadata)
    │
    ▼
components/demo/demo-page.tsx  Client component (useDemo hook)
    ├── AvatarPanel             Left panel — LiveAvatar video element, status indicator
    ├── ErrorBanner             Dismissible error display
    ├── ChatPanel               Message list with auto-scroll
    └── ChatInput               Text input with Enter to send
```

### Hook Architecture

```
useDemo()
    │
    ├── ElevenLabs Agent        NLU connection (intent classification only)
    │     Sends user questions, receives intent labels or generated text
    │     No audio — agent is used purely for NLU + RAG
    │
    ├── ElevenLabs TTS API      Runtime voice synthesis (unknown questions only)
    │     Called server-side via /api/v1/demo/tts
    │     output_format: pcm_24000
    │     Custom cloned voice
    │
    ├── Pre-generated store     Static map of category → { text, pcmAudioUrl }
    │     Loaded at build time
    │     PCM audio pre-rendered offline with same custom voice
    │
    └── LiveAvatar session      Avatar rendering and lip-sync
          session.start() → connect to LiveKit room
          session.attach(videoElement) → render avatar video
          session.repeatAudio(pcmData) → lip-sync from PCM audio
          session.stop() → disconnect and release credits
```

---

## Audio Architecture

### Format

A single audio format flows through the entire pipeline with no conversion required:

| Stage | Format | Notes |
|---|---|---|
| ElevenLabs TTS API | `output_format: "pcm_24000"` | Raw PCM, 24kHz, 16-bit signed, mono |
| Pre-rendered audio files | `.pcm` files in `public/audio/` | Same format, generated offline |
| LiveAvatar SDK | `session.repeatAudio(pcmData)` | Expects PCM 24kHz, 16-bit signed, mono |
| LiveAvatar internal | 20ms chunks (960 bytes each) | SDK handles chunking automatically |

### Voice Consistency

All audio — whether pre-generated or runtime — uses the same ElevenLabs custom cloned voice (`ELEVENLABS_VOICE_ID`). LiveAvatar's built-in TTS is deliberately bypassed (`session.repeatAudio()` instead of `session.message()`) to maintain voice consistency.

### Pre-rendering Workflow

Run when answer text changes:

1. Update answer text in the app's response store
2. Call ElevenLabs TTS API with `output_format: "pcm_24000"` and the custom `voice_id` for each answer
3. Save the PCM output as static files (e.g. `/public/audio/recent_performance.pcm`)
4. Deploy — the app loads these at runtime for instant playback

### Pre-generated Audio Files

Located in `public/audio/`, generated offline using the ElevenLabs TTS API with the custom cloned voice:

| File | Category |
|------|----------|
| greeting.pcm | Opening greeting |
| fund_manager.pcm | Who manages the fund |
| investment_strategy.pcm | Investment strategy |
| since_inception_return.pcm | Returns since inception |
| recent_performance.pcm | Recent performance |
| benchmark_comparison.pcm | Benchmark comparison |
| fallback.pcm | Out-of-scope response |

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

**Note:** These tables store the response data but are NOT queried at runtime. The pre-generated responses are hardcoded in the app for instant client-side use. The database serves as a source of truth for the content and for future CMS integration.

### Response Categories

| Category | Example Questions |
|---|---|
| `fund_manager` | "Who manages the fund?", "Tell me about Robert Frost" |
| `investment_strategy` | "What's your investment approach?", "Are you benchmark aware?" |
| `since_inception_return` | "What's the total return since inception?" |
| `recent_performance` | "How did the fund perform this year?" |
| `benchmark_comparison` | "How do you compare to the benchmark?" |

Intent classification is performed by the ElevenLabs agent (not a local keyword classifier). The agent returns an intent label for known categories or generates a response for unknown questions.

---

## Responsibility Split

| Concern | This App | ElevenLabs Agent | ElevenLabs TTS | LiveAvatar |
|---|---|---|---|---|
| Intent classification | — | NLU + RAG | — | — |
| Answer text (known) | Lookup from local store | Returns intent label | — | — |
| Answer text (unknown) | — | Generates response | — | — |
| Voice synthesis (known) | Loads pre-rendered PCM | — | Generated offline | — |
| Voice synthesis (unknown) | Calls TTS API, pipes result | — | Runtime synthesis | — |
| Voice consistency | Ensures same voice ID used | — | Custom cloned voice | — |
| Avatar lip-sync | Calls `repeatAudio()` | — | — | Animates from PCM |
| Avatar video | Renders in `<video>` element | — | — | Streams via LiveKit |
| Session management | Creates session, starts/stops | — | — | Manages LiveKit room |
| API key security | Proxies keys server-side | Agent ID is public | Key server-side | Key server-side |

---

## Custom Voice & Avatar Setup

### Custom Voice (ElevenLabs)

- Clone or create a custom voice in the ElevenLabs dashboard
- Use the same `voice_id` for both offline pre-rendering and runtime TTS calls
- Voice consistency is guaranteed because all audio passes through the same ElevenLabs voice

### Custom Avatar (LiveAvatar)

- Create or configure a custom avatar in the LiveAvatar dashboard
- Set the avatar ID via `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID` environment variable
- The avatar receives audio only — it does not need to know about the voice; it lip-syncs to whatever PCM audio it receives

---

## Security Model

### Authentication
- The demo page is **intentionally unauthenticated** — no login required
- Auth pages (`/sign-in`, `/sign-up`, etc.) redirect to `/demo` via middleware
- The underlying auth infrastructure (Supabase Auth, sessions, devices) exists but is bypassed for the demo

### API Key Protection

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` | Client | ElevenLabs Conversational AI agent (not a secret) |
| `ELEVENLABS_API_KEY` | Server only | ElevenLabs TTS API calls |
| `ELEVENLABS_VOICE_ID` | Server only | Custom cloned voice for TTS |
| `LIVEAVATAR_API_KEY` | Server only | LiveAvatar session creation |
| `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID` | Client + Server | Custom avatar ID |

No API keys are exposed to the browser. The ElevenLabs TTS API is called server-side via a proxy route. LiveAvatar session tokens are created server-side.

### Input Handling
- User text input is sent to ElevenLabs for intent classification
- Pre-generated answers are static text with no user-controlled content
- The avatar API route validates input and returns structured errors

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| ElevenLabs agent fails to connect | Error shown in banner, can still show fallback responses via LiveAvatar |
| LiveAvatar session fails | Error shown, text responses still displayed in chat (audio-only degradation) |
| Pre-rendered audio file fails to load | Text response still shown in chat |
| Unknown question + agent disconnected | Fallback response text + pre-rendered fallback audio sent to avatar |
| ElevenLabs TTS API fails (runtime) | Text response shown in chat, avatar does not speak |
| Network error during agent response | Error banner shown, conversation can continue |

The system degrades gracefully — text responses always display regardless of audio or avatar failures.
