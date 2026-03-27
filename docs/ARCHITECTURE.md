# Architecture

System architecture for the Copia OC Mid-Cap Fund investor demo — an AI voice agent that answers investor questions as Robert Frost, Head of Investments at OC Funds Management.

**Related document:** [INFRASTRUCTURE.md](./INFRASTRUCTURE.md) — external services, accounts, and deployment.

---

## System Overview

The system supports five avatar modes grouped into two processing pipelines, selected by `NEXT_PUBLIC_AVATAR_MODE`:

### Local Pipeline (haiku, live, tavus modes)

Uses client-side voice activity detection and server-side STT + classification for zero-hallucination response matching against the database.

- **Voice capture** — `useVoiceListener` (AudioContext + ScriptProcessorNode, amplitude-based VAD)
- **Processing** — Unified `POST /api/v1/demo/process` endpoint handles STT + classification in a single round-trip:
  - **Flash pipeline** (`NEXT_PUBLIC_PROCESSING_MODE=flash`): Gemini 2.5 Flash — audio → transcript + category in one multimodal call
  - **Default pipeline** (unset or `default`): ElevenLabs Scribe STT → Bedrock Haiku classifier (two sequential API calls, one server round-trip)
- **Response playback** — Pre-recorded video/audio (haiku), PCM sent to LiveAvatar (live), or text echoed to Tavus (tavus)

### Agent Pipeline (video, audio modes)

Uses the ElevenLabs Conversational AI agent for combined STT + RAG + response generation.

- **ElevenLabs Conversational AI** — WebRTC connection for real-time STT, intent classification via category tags
- **Category tag extraction** — Agent returns `[category_name]` tags, matched to `PREGENERATED` response map
- **Response playback** — Pre-recorded video (video mode) or MP3 audio (audio mode)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Client)                          │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     useDemo() hook                        │   │
│  │                                                          │   │
│  │  Local Pipeline (haiku/live/tavus): Agent Pipeline:       │   │
│  │  useVoiceListener (VAD)             useConversation       │   │
│  │    → /api/v1/demo/transcribe          (ElevenLabs WebRTC) │   │
│  │    → /api/v1/demo/match               → category tag parse│   │
│  │    → playResponse()                   → playResponse()    │   │
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

| Mode | Env Value | Pipeline | Input | Output Rendering | Avatar Init |
|------|-----------|----------|-------|------------------|-------------|
| **Video** | `video` | Agent | ElevenLabs Conv. AI (WebRTC) | Pre-recorded MP4 video + embedded audio | None |
| **Live** | `live` | Local | VAD → STT → Bedrock Haiku | HeyGen LiveAvatar lip-sync from PCM | LiveAvatar session |
| **Tavus** | `tavus` | Local | VAD → STT → Bedrock Haiku | Tavus CVI echo via Daily.co WebRTC | Daily.co room |
| **Haiku** | `haiku` | Local | VAD → STT → Bedrock Haiku | Pre-recorded MP4 video + embedded audio | None |
| **Audio** | `audio` | Agent | ElevenLabs Conv. AI (WebRTC) | MP3 audio playback (no avatar video) | None |

The `USE_LOCAL_PIPELINE` flag (`config.ts`) controls which pipeline is active. It is `true` for `haiku`, `live`, and `tavus` modes.

---

## Detailed Mode Architectures

### Mode 1: Video (Pre-recorded MP4)

**Pipeline:** Agent | **Avatar:** Dual-layer video (idle loop + response overlay)

```
User connects
├── Play greeting video from PREGENERATED
├── Start ElevenLabs agent (conversation.startSession, WebRTC)
│
User speaks
├── ElevenLabs agent transcribes via WebRTC STT
├── Agent returns [category_name] tagged response
├── Parse category → lookup PREGENERATED[category]
├── Display answer text in chat
├── playResponse():
│   ├── HEAD request to check videoUrl exists
│   ├── IF video found → play MP4, wait for onended event
│   └── ELSE → fall back to playCachedAudio (MP3)
├── Unmute agent mic, restore volume
└── Agent ready for next question

Assets: MP4 videos, MP3 audio (fallback) — served from CloudFront CDN
```

**Dual-layer video rendering:** An idle video loops continuously on a back layer. Response videos play on a front overlay layer with opacity transitions. When the response ends, it hides — revealing the idle loop still running. No src-swapping on a single element = no flicker.

### Mode 2: Live (HeyGen LiveAvatar)

**Pipeline:** Local | **Avatar:** HeyGen LiveAvatar SDK (WebRTC via LiveKit)

```
User connects → status badge: "Initialising"
├── avatar.initAvatar():
│   ├── POST /api/v1/demo/avatar → get session token
│   ├── Create LiveAvatarSession(token)
│   ├── session.start() → connects to LiveKit room
│   ├── Wait for SESSION_STREAM_READY event
│   └── Hook addEventListener("message") on WebSocket for speak events
├── 200ms yield → React flushes avatarReady → useEffect calls attach()
├── session.attach(videoElement) — wires video+audio tracks
├── Play greeting: fetch PCM → avatar.speakAudio(base64)
├── Start voiceListener (continuous VAD)
│
User speaks
├── VAD captures PCM Int16 (threshold 0.015 RMS, 1.5s silence timeout)
├── Listener paused (prevents feedback loop)
├── POST /api/v1/demo/transcribe → ElevenLabs STT (scribe_v1)
├── POST /api/v1/demo/match → Bedrock Haiku classifier
├── Display answer text in chat
├── playPcmOnLiveAvatar():
│   ├── Fetch PCM from CloudFront (cached in pcmCacheRef)
│   ├── Base64 encode
│   ├── Send via WebSocket in 64KB chunks (agent.speak messages)
│   ├── Send agent.speak_end signal
│   └── Wait for agent.speak_ended event (safety timeout at 1.5x duration)
├── Listener resumed
└── Ready for next question

Assets: PCM 24kHz 16-bit mono — served from CloudFront CDN
Fallback: MP3 audio if avatar not ready or speakAudio fails
```

**WebSocket protocol:** The SDK's built-in `repeatAudio()` has a chunking bug, so we bypass it and send base64 PCM directly:
- `agent.speak` — audio chunk (64KB, multiple of 4 for valid base64)
- `agent.speak_end` — signals end of audio for a given event_id
- `agent.speak_ended` — server confirms avatar finished speaking (used to resolve the promise)

### Mode 3: Tavus (CVI Streaming)

**Pipeline:** Local | **Avatar:** Tavus Conversational Video Interface (WebRTC via Daily.co)

```
User clicks "Start Conversation" → status badge: "Initialising"
├── Pre-warm mic permission (getUserMedia, then release — prompt appears during avatar load)
├── tavusAvatar.initAvatar():
│   ├── POST /api/v1/demo/tavus → create conversation
│   │   └── Returns { conversationId, conversationUrl (Daily.co room) }
│   ├── Create Daily call object (no local video/audio)
│   ├── Join Daily room via conversationUrl
│   ├── Listen for track-started events
│   └── Extract replica's video+audio tracks → MediaStream
├── 200ms yield → React flushes mediaStream → useEffect sets <video srcObject>
├── Play greeting: tavusAvatar.echo(greeting.text)
│   └── Send Daily app message { event_type: "conversation.echo", text }
│   └── Wait estimated duration (text.length * 55ms + 1s, min 3s)
├── Start voiceListener (continuous VAD, mic permission already granted)
│
User speaks
├── VAD captures PCM Int16
├── Listener paused
├── POST /api/v1/demo/process → STT + classification (Gemini Flash or ElevenLabs+Bedrock)
├── Display answer text in chat
├── playTextOnTavus():
│   ├── Send Daily app message with response text
│   └── Wait estimated duration (text.length * 55ms + 1s, min 3s)
├── Listener resumed
└── Ready for next question

User clicks "Stop" or navigates away:
├── tavusAvatar.stopAvatar():
│   ├── Leave Daily room (call.leave + call.destroy)
│   └── DELETE /api/v1/demo/tavus/{conversationId} → ends conversation server-side
└── voiceListener.stop()

Assets: Response text only — Tavus generates voice+lip-sync from text
Fallback: MP3 audio if Tavus echo fails
Cleanup: Automatic on disconnect, unmount, and page unload
```

### Mode 4: Haiku (Bedrock Matcher + Pre-recorded Video)

**Pipeline:** Local | **Avatar:** Dual-layer video (same as video mode)

```
User connects
├── No avatar init needed
├── Play greeting video from PREGENERATED
├── Start voiceListener (continuous VAD)
│
User speaks
├── VAD captures PCM Int16
├── Listener paused
├── POST /api/v1/demo/transcribe → ElevenLabs STT
├── POST /api/v1/demo/match → Bedrock Haiku classifier
├── Display answer text in chat
├── playResponse():
│   ├── HEAD request to check videoUrl exists
│   ├── IF video found → play MP4, wait for onended event
│   └── ELSE → fall back to playCachedAudio (MP3)
├── Listener resumed
└── Ready for next question

Assets: MP4 videos, MP3 audio (fallback) — served from CloudFront CDN
```

**Key difference from video mode:** Haiku mode uses the local pipeline (VAD → STT → Bedrock) for zero-hallucination matching, while video mode relies on the ElevenLabs agent's RAG system. The rendering is identical.

### Mode 5: Audio (Audio-only)

**Pipeline:** Agent | **Avatar:** None (no video rendering)

```
User connects
├── No avatar init
├── Play greeting MP3 from PREGENERATED
├── Start ElevenLabs agent (conversation.startSession, WebRTC)
│
User speaks
├── ElevenLabs agent transcribes via WebRTC STT
├── Agent returns [category_name] tagged response
├── Parse category → lookup PREGENERATED[category]
├── Display answer text in chat
├── playResponse():
│   ├── Mute agent volume (prevent overlap)
│   ├── Play cached MP3 via <audio> element
│   └── Restore agent volume
└── Agent ready for next question

Assets: MP3 audio files — served from CloudFront CDN
```

---

## Process Flows

### Flow 1: Start Conversation (All Modes)

```
User visits /demo → "Start Conversation" button shown below avatar area
    │
    ▼
User clicks button (user gesture — unlocks browser audio)
    │
    ├──▶ Status badge shows "Initialising" (violet, pulsing)
    │
    ├──▶ Pre-warm mic permission (local pipeline modes only):
    │    getUserMedia({ audio: true }) → release immediately
    │    Browser prompt appears during avatar loading, not after greeting
    │
    ├──▶ Init avatar renderer (blocks until ready):
    │    live  → LiveAvatar session (token + LiveKit + WebSocket)
    │    tavus → Tavus conversation (Daily.co room + WebRTC)
    │    other → no init needed (proceeds immediately)
    │
    ├──▶ 200ms yield (live/tavus only)
    │    Lets React flush avatarReady/mediaStream state and trigger
    │    useEffects that wire audio/video tracks to the <video> element.
    │    Without this, the greeting plays before tracks are connected.
    │
    ├──▶ Play greeting (routed by avatar mode):
    │    video/haiku → play MP4 video (dual-layer)
    │    live        → fetch PCM → speakAudio() via WebSocket
    │    tavus       → echo text via Daily.co app message
    │    audio       → play MP3 via <audio> element
    │
    └──▶ Start input pipeline:
         Local pipeline → voiceListener.start() (continuous VAD)
         Agent pipeline → conversation.startSession() (ElevenLabs WebRTC)
```

### Flow 2: Local Pipeline — Question → Response (haiku, live, tavus)

```
User speaks → VAD detects speech above threshold (0.015 RMS)
    │
    ▼
User pauses → silence timeout (1000ms, configurable) → utterance captured as PCM Int16
    │   (minimum speech duration: 400ms to filter noise)
    │
    ▼
Listener paused (prevents feedback loop during processing)
    │
    ▼
POST /api/v1/demo/process (single round-trip)
    │  PCM → WAV header → STT + classification:
    │    Flash mode:   Gemini 2.5 Flash (audio → transcript + category)
    │    Default mode: ElevenLabs STT → Bedrock Haiku classifier
    │  Returns: { text, category, answerText, audioUrl, pcmUrl, videoUrl }
    │
    ▼
Show answer text in chat panel
    │
    ├── Haiku mode: play MP4 video (with embedded audio)
    │   └── Fallback: play MP3 if no video exists
    │
    ├── Live mode: fetch PCM → avatar.speakAudio(base64)
    │   ├── Send chunks via WebSocket
    │   └── Wait for agent.speak_ended event (timeout fallback)
    │   └── Fallback: play MP3 if avatar not ready
    │
    └── Tavus mode: echo text via Daily.co app message
        └── Wait estimated duration (~55ms/char + 1s, min 3s)
        └── Fallback: play MP3 if echo fails
    │
    ▼
Listener resumed → ready for next question
```

### Flow 3: Agent Pipeline — Question → Response (video, audio)

```
User speaks → ElevenLabs agent transcribes (WebRTC STT)
    │
    ▼
Agent processes via RAG → returns text with [category_name] tag
    │
    ▼
App extracts category → looks up PREGENERATED[category]
    │
    ├── Match found:
    │   ├── Mute agent mic + volume (epoch counter prevents stale messages)
    │   ├── Play pre-recorded response (video or audio)
    │   ├── Unmute mic + volume
    │   └── Send contextual update: "wait for next question"
    │
    └── No match: show agent's generated text in chat (no pre-recorded media)
```

---

## Component Architecture

### Page Structure

```
app/demo/page.tsx                 Server component (metadata)
    │
    ▼
components/demo/demo-page.tsx     Client component (useDemo hook)
    ├── AvatarPanel               Video rendering (3 modes: LiveAvatar / Tavus / dual-layer)
    │   └── "Please press Start Conversation" shown before connect
    ├── Start / Leave Button      Below avatar panel, toggles on connect
    ├── StatusBadge               Initialising / Ready / Listening / Thinking / Speaking
    ├── ErrorBanner               Dismissible error display
    └── ChatPanel                 Message list with auto-scroll
        └── "Press Start Conversation to begin" shown before connect
```

### Hook Architecture

```
useDemo()
    │
    ├── useVoiceListener()        Continuous VAD + PCM capture (local pipeline)
    │     speechThreshold: 0.015, silenceTimeoutMs: 1000 (configurable), minSpeechDurationMs: 400
    │     onUtterance callback → handleUtterance
    │     pause()/resume() — suspended during response playback
    │
    ├── useConversation()         ElevenLabs agent (agent pipeline modes)
    │     onMessage → category tag extraction → playResponse
    │     micMuted control + volume control for pre-recorded playback
    │
    ├── useAvatar()               HeyGen LiveAvatar SDK (live mode)
    │     initAvatar() → speakAudio(base64): Promise → stopAvatar()
    │     attach(videoElement) — wires video+audio tracks
    │     WebSocket event listener for agent.speak_ended
    │
    └── useTavusAvatar()          Tavus CVI via Daily.co (tavus mode)
          initAvatar() → echo(text): Promise<void> → stopAvatar()
          mediaStream exposed for <video srcObject>
          Disconnect calls stopAvatar() → leaves Daily room + DELETEs conversation
```

---

## Audio Architecture

### Formats

| Context | Format | Notes |
|---|---|---|
| Voice capture (VAD) | PCM Int16 LE, browser sample rate (~48kHz) | AudioContext + ScriptProcessorNode |
| Transcribe API input | WAV (PCM Int16 + 44-byte RIFF header) | Server wraps PCM before sending to ElevenLabs |
| Pre-recorded audio | MP3 44.1kHz 128kbps (`/audio/{category}.mp3`) | CloudFront CDN, browser `<audio>` playback |
| Pre-recorded PCM | PCM 24kHz 16-bit mono (`/audio/{category}.pcm`) | CloudFront CDN, for LiveAvatar `speakAudio()` |
| Pre-recorded video | MP4 (`/video/{category}.mp4`) | CloudFront CDN, with embedded audio track |
| LiveAvatar WebSocket | Base64-encoded PCM, 64KB chunks | `agent.speak` / `agent.speak_end` protocol |

### Voice Consistency

All pre-recorded audio uses the same ElevenLabs custom voice (voice ID `intqmJdN1hH5FSsuxpV3`, "Real Rob"). Generated via `scripts/generate-audio.ts`. In live mode, LiveAvatar's built-in TTS is bypassed — pre-rendered PCM is sent directly via WebSocket.

### Media CDN

Pre-recorded files are served from an S3 bucket behind CloudFront (`NEXT_PUBLIC_MEDIA_BASE_URL`). Cache-control: `immutable, max-age=31536000`. When files are updated:
1. Upload to S3 via `cdk/upload-media.sh`
2. Invalidate CloudFront cache (`/audio/*`)
3. Users may need hard refresh due to browser `immutable` caching

---

## API Routes

All demo routes are intentionally unauthenticated (public demo page).

### POST /api/v1/demo/process

Unified endpoint: transcribes PCM audio and classifies the question in a single round-trip.

- **Input:** `multipart/form-data` — `audio` (PCM blob), `sampleRate` (number)
- **Process:** Pipeline selected by `NEXT_PUBLIC_PROCESSING_MODE`:
  - `"flash"`: PCM → WAV → Gemini 2.5 Flash (STT + classification in one multimodal call)
  - `"default"`: PCM → WAV → ElevenLabs STT → Bedrock Haiku classifier
- **Output:** `{ text, category, answerText, audioUrl, pcmUrl, videoUrl }` or `{ text: "" }` if no speech
- **Limits:** Audio max 10MB
- **Env (flash):** `GEMINI_API_KEY`, `GEMINI_MODEL` (optional)
- **Env (default):** `ELEVENLABS_API_KEY`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_ID`

### POST /api/v1/demo/transcribe (legacy)

Converts raw PCM audio to text via ElevenLabs STT. Kept for standalone use; main flow uses `/process`.

- **Input:** `multipart/form-data` — `audio` (PCM blob), `sampleRate` (number)
- **Process:** Wrap PCM in WAV header → POST to ElevenLabs STT (`scribe_v1`, `eng`)
- **Output:** `{ text: string }`
- **Env:** `ELEVENLABS_API_KEY`

### POST /api/v1/demo/match (legacy)

Classifies a user question to a response category via Bedrock Haiku. Kept for standalone use; main flow uses `/process`.

- **Input:** `{ text: string }`
- **Process:** Load DB categories (cached) → build prompt → Bedrock Haiku → match category
- **Output:** `{ category, answerText, audioUrl, pcmUrl, videoUrl }`
- **Env:** `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `BEDROCK_MODEL_ID`

### POST /api/v1/demo/avatar

Creates a HeyGen LiveAvatar LITE session.

- **Input:** None
- **Process:** POST to `api.liveavatar.com/v1/sessions/token` with `mode: "LITE"`, `avatar_id`
- **Output:** `{ sessionToken: string }`
- **Env:** `LIVEAVATAR_API_KEY`, `NEXT_PUBLIC_LIVEAVATAR_AVATAR_ID`

### POST /api/v1/demo/tavus

Creates a Tavus CVI conversation.

- **Input:** `{ custom_greeting?: string }` (optional)
- **Process:** POST to `tavusapi.com/v2/conversations` with `persona_id`, optional `replica_id`
- **Output:** `{ conversationId, conversationUrl }` (Daily.co room URL)
- **Env:** `TAVUS_API_KEY`, `TAVUS_PERSONA_ID`, `TAVUS_REPLICA_ID`

### DELETE /api/v1/demo/tavus/[conversationId]

Ends a Tavus CVI conversation to stop billing.

- **Input:** `conversationId` (path parameter)
- **Process:** DELETE to `tavusapi.com/v2/conversations/{id}` with API key
- **Output:** `{ success: true }` or error
- **Called by:** `stopAvatar()` on disconnect, and on component unmount

### POST /api/v1/demo/tts

Generates PCM audio from text via ElevenLabs TTS. Currently unused in main flow (pre-generated responses used instead).

- **Input:** `{ text: string }`
- **Process:** POST to ElevenLabs TTS API → PCM 24kHz
- **Output:** `{ audio: string }` (base64-encoded PCM)
- **Env:** `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`

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

## State Management

### Busy State Machine

```
Ready → User speaks
├── busyRef = true, micMuted = true
├── voiceListener.pause() (local pipeline)
├── Processing: STT + classification
├── playResponse() — awaits completion
└── busyRef = false, micMuted = false
    └── voiceListener.resume() (local pipeline)
```

Prevents overlapping utterances and ensures responses complete before next input.

### Epoch Counter

Incremented on each `connect()` call. Used to discard stale messages from previous sessions in the ElevenLabs agent `onMessage` callback. When a pre-recorded response plays, the epoch increments to ignore any concurrent agent output.

### PCM Cache

`pcmCacheRef` stores base64-encoded PCM in memory after first fetch. Bounded by the fixed set of ~30 categories (~500KB each = ~15MB max). Acceptable for a demo.

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
| `TAVUS_PERSONA_ID` / `TAVUS_REPLICA_ID` | Server only | Tavus persona + replica config |

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
| LiveAvatar session init fails | Falls back to MP3 audio playback |
| LiveAvatar speakAudio fails | Falls back to MP3 audio playback |
| Tavus echo fails | Falls back to MP3 audio playback |
| Pre-recorded video missing | Falls back to MP3 audio playback |
| ElevenLabs agent fails to connect | Error shown, text responses still work |
| Network error during processing | Error banner, busy state cleared, listener resumes |
| No transcribed text (empty speech) | Silently resumes listening |

The system degrades gracefully — text responses always display regardless of audio or avatar failures.
