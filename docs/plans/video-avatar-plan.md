# Pre-generated Video Avatar — Implementation Plan

**Created:** 25 March 2026
**Parent plan:** [copia-demo-plan.md](./copia-demo-plan.md)
**Architecture:** [ARCHITECTURE.md](../ARCHITECTURE.md)

---

## Goal

Replace the LiveAvatar streaming integration with pre-generated MP4 video clips.
A feature flag switches between the two approaches so we can fall back to LiveAvatar if needed.

## Why

- LiveAvatar streaming has runtime dependencies (LiveKit, session credits, WebSocket connections) that make it fragile for a live demo
- Pre-generated video is bulletproof — no connections, no credits, no latency
- Same visual result: avatar lip-syncs to ElevenLabs voice
- Demo must not fail on April 1

## Feature Flag

**Env var:** `NEXT_PUBLIC_AVATAR_MODE`

| Value | Behaviour |
|-------|-----------|
| `video` | Play pre-generated MP4 clips (default for demo) |
| `live` | Use LiveAvatar streaming SDK (existing code) |
| `audio` | Audio-only, no avatar (existing fallback) |
| _(empty)_ | Same as `audio` |

The flag is read once at module level. No runtime switching — restart dev server to change mode.

```ts
// src/demo/config.ts
const AVATAR_MODE = process.env.NEXT_PUBLIC_AVATAR_MODE ?? "audio";
export const USE_VIDEO_AVATAR = AVATAR_MODE === "video";
export const USE_LIVE_AVATAR = AVATAR_MODE === "live";
export const USE_AUDIO_ONLY = AVATAR_MODE === "audio" || !AVATAR_MODE;
```

## Architecture

```
User types question
    │
    ▼
Classifier (local, instant)
    │
    ├── Match found
    │   ├── video mode → play /video/<category>.mp4 in <video> element
    │   ├── live mode  → fetch PCM → avatar.repeatAudio(base64)
    │   └── audio mode → play /audio/<category>.mp3 via browser Audio
    │
    └── No match
        ├── video mode → play /video/fallback.mp4
        ├── live mode  → ElevenLabs agent (muted) → TTS API → avatar.repeatAudio()
        └── audio mode → ElevenLabs agent (voice) or fallback MP3
```

## File Changes

### New files

| File | Purpose |
|------|---------|
| `public/video/<category>.mp4` | 30 pre-generated video clips (greeting, fund_manager, etc.) |
| `scripts/generate-video.ts` | Script to generate videos via HeyGen API (optional — can also use dashboard) |

### Modified files

| File | Change |
|------|--------|
| `src/demo/config.ts` | Add `AVATAR_MODE`, `USE_VIDEO_AVATAR`, `USE_LIVE_AVATAR` exports |
| `src/demo/classifier.ts` | Add `videoUrl` field to `PREGENERATED` entries |
| `components/demo/avatar-panel.tsx` | Add video playback mode: `<video>` element playing MP4 clips |
| `src/demo/use-demo.ts` | Branch on `AVATAR_MODE` for greeting + sendMessage |
| `.env.local` | Add `NEXT_PUBLIC_AVATAR_MODE=video` |
| `.env.example` | Document the flag |

### No changes needed

| File | Why |
|------|-----|
| `src/demo/use-avatar.ts` | Kept as-is for `live` mode |
| `app/api/v1/demo/avatar/route.ts` | Kept as-is for `live` mode |
| `app/api/v1/demo/tts/route.ts` | Kept as-is for `live` mode |

## Implementation Steps

### Phase 1: Video playback integration (Claude Code)

1. **Add feature flag** to `src/demo/config.ts`
2. **Add `videoUrl` field** to `PREGENERATED` map in `classifier.ts`
3. **Update `avatar-panel.tsx`** — accept a `videoSrc` prop, render `<video>` element when provided
4. **Update `use-demo.ts`** — branch on `USE_VIDEO_AVATAR`:
   - `connect()`: play `/video/greeting.mp4` instead of PCM/MP3
   - `sendMessage()`: play `/video/<category>.mp4` for matched questions
   - Expose `currentVideoSrc` in the return value for the avatar panel
5. **Don't connect ElevenLabs agent or LiveAvatar** in video mode — no external services needed
6. **Add idle video loop** — when not answering, loop a short idle clip (`/video/idle.mp4`)

### Phase 2: Generate video clips (Trevor — manual or scripted)

**Option A: HeyGen Dashboard (recommended for first pass)**
1. Go to HeyGen → Create Video → Talking Photo
2. Upload Robert Frost's photo
3. For each of the 30 responses:
   - Upload the MP3 from `public/audio/<category>.mp3` as the audio track
   - Generate video
   - Download MP4
   - Save as `public/video/<category>.mp4`
4. Also generate an idle clip (5-10 seconds of the avatar sitting still, subtle movement)

**Option B: HeyGen API (automated)**
1. Use `POST /v2/video/generate` with `talking_photo` type
2. Script uploads photo + audio URL, polls for completion, downloads result
3. ~1-2 minutes per clip, ~30-60 minutes for all 30

### Phase 3: Test + polish

1. Verify all 30 videos play correctly
2. Check video dimensions match the avatar panel aspect ratio
3. Test transitions between idle → speaking → idle
4. Confirm feature flag switching works (restart dev server between modes)

## Video Player Behaviour

```
Page load → show static Robert Frost photo (or idle video loop)
    │
Click "Start Conversation"
    │
    ▼
Play greeting.mp4 → when finished → show idle loop
    │
User asks question
    │
    ▼
Classifier matches → play <category>.mp4 → when finished → show idle loop
    │
No match → play fallback.mp4 → when finished → show idle loop
```

- Videos play inline, no controls visible
- `playsInline`, `autoPlay` on the `<video>` element
- Idle loop: `loop` attribute on idle video
- Transition: swap `src` on the `<video>` element, call `play()`

## Video Generation Specs

| Property | Value |
|----------|-------|
| Resolution | 1080x1080 or 1920x1080 (match avatar panel aspect ratio) |
| Format | MP4 (H.264) |
| Audio | Embedded (from ElevenLabs MP3) |
| Expected size | 2-5 MB per clip |
| Total storage | ~60-150 MB for 30 clips |

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| HeyGen video quality is poor | Medium | High | Test with one clip first before generating all 30 |
| Video files too large for hosting | Low | Medium | Compress with ffmpeg, use 720p if needed |
| Lip-sync quality is bad | Medium | High | Try different HeyGen avatar modes (instant vs studio) |
| Feature flag adds code complexity | Low | Low | Clean branching, each mode is self-contained |
| Video transitions look jarring | Medium | Medium | Add fade transitions, use idle loop between responses |

## Verification Checklist

- [ ] Feature flag switches between video/live/audio modes
- [ ] Video mode: greeting plays on connect
- [ ] Video mode: all 5 core questions play correct video
- [ ] Video mode: fallback plays for unknown questions
- [ ] Video mode: idle loop between responses
- [ ] Video mode: no external API calls at runtime
- [ ] Live mode: still works as before (LiveAvatar + PCM)
- [ ] Audio mode: still works as before (MP3 + ElevenLabs agent)
- [ ] Build passes in all three modes
