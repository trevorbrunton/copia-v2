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

## Two flavours of echo

Tavus documents two flavours under *Server-to-Server Architecture*:

- **Text Echo** — you send `properties.text`; Tavus's TTS speaks it; replica lip-syncs. This is what we use today.
- **Audio Echo** — you send pre-rendered audio bytes (your own TTS); Tavus only does lip-sync. Useful if you want full voice control or to keep PHI out of Tavus entirely.

If you ever need to keep utterance text out of Tavus's data path (e.g. for ISO-27001 / DPIA reasons), switch to Audio Echo and route all TTS through ElevenLabs server-side. No code in this repo does that today.

## Create an echo-mode persona

### Option A — script (recommended)

```bash
bun scripts/create-tavus-echo-persona.ts \
  --name "Pep Generic" \
  --replica-id rXXXXXXXXX
```

Run it once per persona slot you want. The replica id comes from your Tavus dashboard (Replicas tab). The script prints the new `persona_id`; copy it into the matching env var:

```env
NEXT_PUBLIC_TAVUS_PERSONA_GENERIC=<persona_id from script>
NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM=<another persona_id from a second run>
```

### Option B — direct API

```bash
curl -X POST https://tavusapi.com/v2/personas \
  -H "x-api-key: $TAVUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "persona_name": "Pep Generic",
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
TAVUS_API_KEY=                       # server-side, used for conversation create + DELETE
TAVUS_REPLICA_ID=                    # default replica if persona doesn't set one
NEXT_PUBLIC_TAVUS_PERSONA_GENERIC=   # echo-mode persona id (Generic radio)
NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM=    # echo-mode persona id (Custom radio)
```

`NEXT_PUBLIC_TAVUS_PERSONA_*` need to be public so the client can pass the selected one through to `POST /api/v1/demo/tavus`. The API key stays server-side.
