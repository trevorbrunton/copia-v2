# Tavus Persona Setup — Echo Mode

The Pep avatar in `/demo/screen` must use a Tavus persona configured in **echo mode**. This page explains why, how to create one, and how to verify the result.

## Why echo mode

A Tavus persona has three layers: **STT** (audio in → text), **LLM** (text → text), and **TTS** (text → audio). The default `pipeline_mode: "full"` runs all three end-to-end so the replica responds autonomously to whatever it hears.

`pipeline_mode: "echo"` disables STT, LLM, and TTS auto-flow. The replica becomes a pure rendering layer that only speaks what you send it via `conversation.echo` events. The `system_prompt` requirement is also waived — there's no LLM to prompt.

Why this matters for our demo:

- We do our own STT (ElevenLabs) on `POST /api/v1/screen/process`.
- We classify intent ourselves (rule layer + Anthropic Haiku fallback).
- We pick the spoken answer ourselves (`src/screen/narration.ts`).
- The replica is the mouth, nothing more.

If the persona is left at `pipeline_mode: "full"`, you get the **two-voices** symptom: Tavus's LLM speaks autonomously (auto-greet on join, possibly more) on top of every line we echo. Echo mode is the only fix.

## How echo works in this repo

We use **text echo** with the persona's TTS layer pinned to ElevenLabs running our cloned voice. The client sends:

```js
{
  message_type: "conversation",
  event_type: "conversation.echo",
  conversation_id: "<conv id>",
  properties: { modality: "text", text: "<line to speak>" }
}
```

Tavus's TTS layer (configured below) runs the text through ElevenLabs server-side, and the replica lip-syncs to the resulting audio. Voice consistency lives entirely in the persona configuration — no chunking, no /tts route, no base64. We tried the alternative *Audio Echo* path (rendering audio ourselves and chunking PCM bytes via Daily app-messages) and it didn't deliver: chunks were silently dropped or never produced a `conversation.replica.started_speaking` event. Persona-side ElevenLabs is dramatically simpler and works.

### Configure the persona's TTS layer

After creating the persona shell with the script (which sets `pipeline_mode: "echo"` and `default_replica_id`), patch the TTS layer to use ElevenLabs with your voice:

```bash
curl -X PATCH https://tavusapi.com/v2/personas/$PERSONA_ID \
  -H "x-api-key: $TAVUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d "[
    {\"op\":\"replace\",\"path\":\"/layers/tts/tts_engine\",\"value\":\"elevenlabs\"},
    {\"op\":\"replace\",\"path\":\"/layers/tts/external_voice_id\",\"value\":\"$ELEVENLABS_VOICE_ID\"},
    {\"op\":\"replace\",\"path\":\"/layers/tts/api_key\",\"value\":\"$ELEVENLABS_API_KEY\"},
    {\"op\":\"replace\",\"path\":\"/layers/tts/tts_model_name\",\"value\":\"eleven_turbo_v2_5\"},
    {\"op\":\"replace\",\"path\":\"/layers/tts/voice_settings\",\"value\":{\"stability\":0.5,\"similarity_boost\":0.75}}
  ]"
```

The `api_key` is stored server-side by Tavus and used to call ElevenLabs on every utterance. Verify with:

```bash
curl https://tavusapi.com/v2/personas/$PERSONA_ID \
  -H "x-api-key: $TAVUS_API_KEY" | jq '.layers.tts'
```

Expected fields: `tts_engine: "elevenlabs"`, `external_voice_id: "<your voice id>"`, `tts_model_name: "eleven_turbo_v2_5"`, `api_key: "********"` (masked when read back).

### Why not Audio Echo?

Audio Echo is documented but in our environment Tavus rejected our chunked PCM payloads silently — no `conversation.replica.started_speaking` event ever fired. Likely Daily's `sendAppMessage` size limits or a schema detail we couldn't pin down. Persona-side ElevenLabs achieves the same goal (our voice, replica lip-syncs) without us touching the audio path at all. Keep this as the recorded "tried, abandoned" option in case the API surface changes.

## Create an echo-mode persona

### Option A — script (recommended)

```bash
bun scripts/create-tavus-echo-persona.ts \
  --name "Pep" \
  --replica-id rXXXXXXXXX
```

The replica id comes from your Tavus dashboard (Replicas tab). The script prints the new `persona_id`; copy it into the env var:

```env
NEXT_PUBLIC_TAVUS_PERSONA_ID=<persona_id from script>
```

### Option B — direct API

```bash
curl -X POST https://tavusapi.com/v2/personas \
  -H "x-api-key: $TAVUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "persona_name": "Pep",
    "pipeline_mode": "echo",
    "default_replica_id": "rXXXXXXXXX"
  }'
```

The response includes `persona_id`. Use the same env-var slot.

### Option C — Tavus dashboard

If you'd rather click through the UI, create a persona and set **Pipeline Mode = Echo**. Leave system prompt, knowledge base, and objectives empty — they're LLM-side and ignored in echo mode.

## Verify

Spot-check a persona by ID:

```bash
curl https://tavusapi.com/v2/personas/<persona_id> \
  -H "x-api-key: $TAVUS_API_KEY" | jq '.pipeline_mode'
# expect: "echo"
```

If it returns `"full"` (or anything other than `"echo"`), the demo will exhibit the two-voices symptom. Re-create or edit the persona until `pipeline_mode === "echo"`.

## Runtime contract

Once the persona is in echo mode, our code drives speech with:

```js
// src/demo/use-tavus-avatar.ts → echo()
call.sendAppMessage(
  {
    message_type: "conversation",
    event_type: "conversation.echo",
    properties: { text },
  },
  "*"
);
```

And barges in mid-utterance with:

```js
// src/demo/use-tavus-avatar.ts → interrupt()
call.sendAppMessage(
  {
    message_type: "conversation",
    event_type: "conversation.interrupt",
  },
  "*"
);
```

Both schemas are documented under *Tavus → Interactions Protocol*.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Two voices: ours + an autonomous greeting/response | Persona is not `pipeline_mode: "echo"` |
| Replica speaks but lip-sync is off | Network issue in the Daily.co room — usually resolves with the auto-reconnect in `useTavusAvatar` |
| Nothing happens on `echo()` | Conversation hasn't reached `ready`; check the avatar status in `screen-page.tsx` and the Daily console logs |
| `Tavus API error: 4xx` on conversation create | `TAVUS_API_KEY` invalid or persona ID typo'd in the env var |

## Related env vars

```env
# Tavus
TAVUS_API_KEY=                  # server-side; conversation create + DELETE
TAVUS_REPLICA_ID=               # default replica if persona doesn't set one
NEXT_PUBLIC_TAVUS_PERSONA_ID=   # echo-mode persona id used by /demo/screen

# ElevenLabs — controls the actual voice you hear via Audio Echo
ELEVENLABS_API_KEY=             # server-side; used by /screen/tts and /screen/process
ELEVENLABS_VOICE_ID=            # voice id (stock or cloned). Without it, Audio Echo fails and we fall back to text echo
ELEVENLABS_MODEL_ID=            # optional; default eleven_turbo_v2_5
```

`NEXT_PUBLIC_TAVUS_PERSONA_ID` is public so the client can pass it through to `POST /api/v1/demo/tavus`. All keys stay server-side.
