# Infrastructure

External services, environment variables, database, and deployment configuration for the **Pep Avatar v2** demo.

**Companion documents:**
- [ARCHITECTURE.md](./ARCHITECTURE.md) — code structure, data flows, layered patterns.
- [PROCESSING-STREAMS.md](./PROCESSING-STREAMS.md) — every concurrent processing stream and when each is active.

---

## Service map

| Service | Purpose | Wire | Where called from |
|---|---|---|---|
| **Supabase Postgres** | Snapshot store + user data | `postgres-js` over pgbouncer | `src/db/index.ts`, all server routes |
| **Supabase Auth** | Email/password login (dashboard only) | `@supabase/ssr` cookies | `src/auth/`, `src/lib/supabase/` |
| **Tavus CVI** | Streaming avatar (face + lip-sync) | REST + Daily.co WebRTC | `app/api/v1/demo/tavus/*`, `src/demo/use-tavus-avatar.ts` |
| **ElevenLabs** | STT (`scribe_v1`) + persona-side TTS (`eleven_turbo_v2_5`) | REST | `src/screen/stt.ts`; **TTS runs server-side on Tavus's persona**, not in our code |
| **Anthropic** | Claude Haiku intent-classifier fallback | REST (no SDK) | `src/screen/screen-matcher.ts` |
| **Vercel** (assumed) | Hosting | — | All Next.js routes |

---

## Environment variables

All variables and what they control. Cross-reference with `.env.example` (kept in lockstep with this list).

### Database — fatal if unset (validated at startup by `instrumentation.ts`)

| Var | Where | Notes |
|---|---|---|
| `DATABASE_URL` | server | Pooled Supabase connection (port 6543). Required. |
| `DIRECT_URL` | server | Direct connection (port 5432). Used by `bun scripts/run-migration.ts` and Drizzle Kit migrations. |

### Supabase Auth — warn-only (auth UI fails without them; demo path unaffected)

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | client + server | `https://<project-ref>.supabase.co`. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | client + server | Anon key. Safe to expose. |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Service-role key. Used by the admin Supabase client (`src/lib/supabase/admin.ts`); never sent to the browser. |

### Tavus CVI — warn-only

| Var | Where | Notes |
|---|---|---|
| `TAVUS_API_KEY` | server | Used by `app/api/v1/demo/tavus/*` for conversation create + DELETE. |
| `TAVUS_REPLICA_ID` | server | Optional override; absent → Tavus uses the persona's `default_replica_id`. |
| `NEXT_PUBLIC_TAVUS_PERSONA_ID` | client | The Pep persona id passed to `POST /api/v1/demo/tavus`. **Must be a `pipeline_mode: "echo"` persona with `tts_engine: "elevenlabs"`** — see [TAVUS-PERSONA-SETUP.md](./TAVUS-PERSONA-SETUP.md). |

### ElevenLabs — warn-only

| Var | Where | Notes |
|---|---|---|
| `ELEVENLABS_API_KEY` | server + persona | Used by `src/screen/stt.ts` for STT. **A copy of this key is also stored on the Tavus persona's TTS layer server-side**; Tavus uses that copy to render Pep's voice. Same key, two places. |
| `ELEVENLABS_VOICE_ID` | setup-only | Voice id (e.g. a Voice Lab clone). Not read at runtime; consumed by `bun scripts/create-tavus-echo-persona.ts` and the `PATCH /v2/personas/<id>` setup step. |

### Anthropic — warn-only

| Var | Where | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | server | Used by the classifier fallback. Without it the matcher silently degrades to `{ kind: "fallback" }`. |
| `ANTHROPIC_MODEL_ID` | server | Optional override; default `claude-haiku-4-5-20251001`. |

### App configuration

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_VAD_SILENCE_TIMEOUT_MS` | client | Voice-activity-detection silence threshold for `useVoiceListener`. Default `1000`. |
| `LOG_LEVEL` | server | `debug | info | warn | error`. Default `info`. |
| `NODE_ENV` | server | Standard Next.js. Toggles human-readable vs JSON log output. |

---

## Database

Two Drizzle schema files, bundled by `src/db/index.ts`.

### `src/db/schema.ts` — user / session tables

| Table | Purpose | Notes |
|---|---|---|
| `users` | Profile (name, email, avatar URL, status, login counters) | RLS via `auth.uid() = supabase_id`. |
| `user_status_history` | Audit log for every `active ↔ suspended ↔ soft_deleted` transition | Append-only; written by `user-lifecycle-service`. |
| `user_devices` | Device fingerprint + last-seen | Joined onto sessions. |
| `user_sessions` | Per-login row with heartbeat timestamps | Heartbeat every 15 min; 30-day TTL; persisted in `localStorage` so sessions survive refresh. |
| `demo_responses` *(orphan)* | v1 Q&A response set | **Read by a separate v1 app that still runs.** v2 doesn't query these but the Drizzle exports stay so `drizzle-kit generate` doesn't emit a `DROP TABLE` migration against the shared DB. |
| `demo_question_patterns` *(orphan)* | v1 question patterns | Same orphan rationale. |

### `src/db/screen-schema.ts` — screening tables

| Table | Purpose | Notes |
|---|---|---|
| `asx_snapshots` | One row per ingested ASX snapshot (date, count, collected_at) | Active snapshot = `MAX(collected_at)`, tiebreak by `id`. |
| `asx_securities` | One row per security per snapshot | Wide projection: ticker, sector, GICS, mcap, turnover, profitability flags, curated demo flags (`is_unproven_or_complex_tech`, `is_single_commodity_or_single_mine`, `is_asx_100`), full `data_quality` JSON. |
| `oc_holdings` | Sample portfolio for the Q8 portfolio-overlap intent | Seeded with 10 supplied holdings flagged `is_sample = true`. |

### Static Q&A banks (no DB)

The non-screening modes are backed by version-controlled JSON files, not Postgres rows. Each ships with a typed loader (`src/screen/fund-qa.ts`, `src/screen/process-qa.ts`) that runs a bidirectional drift assertion at module load.

| File | Shape | Source documents |
|---|---|---|
| `data/fund-qa.json` | 3 funds × 21 categories of curated answers | OC fund PDS PDFs (extracted in `docs/fund-data/`) |
| `data/process-qa.json` | 12 topics of curated answers about OC's investment process | `docs/plans/OC_Prem_Dyn_-_FSC_Questionnaire_0625.txt` (FSC §1.1–1.5 + §2.1–2.19) |

Updating an answer means editing the JSON and redeploying — no migration, no ingest. Adding a new fund / category / topic requires a paired edit to the loader's TypeScript union; the module-load assertion fails the dev server immediately if the two drift.

Snapshot ingest is a one-shot script:

```bash
# Plain run (validates fixture, then upserts)
bun scripts/ingest-asx-snapshot.ts data/snapshots/2026-04-XX.json

# Re-baseline if the input fixture has intentionally changed
bun scripts/ingest-asx-snapshot.ts data/snapshots/2026-04-XX.json --baseline
```

The script computes filter outputs first, validates them against `tests/screen/expected-preset-counts.json`, and **only then** writes to Postgres. Drift exits 2 without touching the DB.

---

## API endpoints

### Public demo (unauthenticated, rate-limited)

| Method + Path | Purpose |
|---|---|
| `GET /api/v1/screen/snapshot` | Active snapshot meta + securities (read from in-process cache; `Cache-Control` for edge fronting) |
| `POST /api/v1/screen/apply-filter` | Stateless single-filter step over an optional ticker subset |
| `POST /api/v1/screen/stock-fact` | Resolve ticker / company name → snapshot field (price, market cap, earnings status) |
| `POST /api/v1/screen/portfolio-overlap` | Q8 holdings overlap |
| `POST /api/v1/screen/process` | STT (multipart audio) → matcher → intent. Rate-limited 30/min, 200/hour |
| `POST /api/v1/demo/tavus` | Create a Tavus conversation. Rate-limited 5/min, 20/hour |
| `DELETE /api/v1/demo/tavus/[conversationId]` | End a Tavus conversation. Rate-limited 30/min, 100/hour |

`next.config.ts` rewrites `/api/user/*` → `/api/v1/user/*` and `/api/demo/*` → `/api/v1/demo/*` so older client code paths keep working.

### Authenticated dashboard

| Method + Path | Purpose |
|---|---|
| `GET /api/v1/user` | Current user's profile |
| `PATCH /api/v1/user` | Update profile |
| `DELETE /api/v1/user/account` | Self-service soft delete |
| `GET /api/v1/user/sessions` | List current user's sessions |
| `POST /api/v1/user/sessions` | Create / record a new session (called on login + heartbeat) |
| `DELETE /api/v1/user/sessions/[id]` | Revoke a session |
| `GET /api/v1/user/devices` | List devices |
| `DELETE /api/v1/user/devices/[id]` | Remove a device |
| `GET /api/v1/user/login-history` | Login audit log |

All authenticated routes resolve `AuthContext` via cookie (web) or `Authorization: Bearer <token>` (mobile-ready).

---

## Deployment (Vercel)

The app is targeted at Vercel; nothing is Vercel-specific so other Node-serverless hosts work.

### Vercel project setup

1. **Connect** the GitHub repo.
2. **Framework preset:** Next.js — Vercel auto-detects Next 16.
3. **Build command:** default (`next build`).
4. **Root directory:** project root.
5. **Environment variables:** mirror `.env.example` into the Vercel dashboard. The startup `validateEnv()` will warn in build / serverless cold-start logs if anything required is missing.
6. **Edge caching:** the `/api/v1/screen/snapshot` route ships with `Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=3600`, so Vercel's edge fronts repeat sessions across instances without further config.

### Post-deploy persona setup

The Tavus persona must exist and be configured for ElevenLabs TTS in your cloned voice. Run the setup steps in [TAVUS-PERSONA-SETUP.md](./TAVUS-PERSONA-SETUP.md):

```bash
# 1. Create an echo-mode persona shell
bun scripts/create-tavus-echo-persona.ts --name "Pep" --replica-id <replica id>

# 2. Patch its TTS layer to use ElevenLabs + your voice + your key
curl -X PATCH https://tavusapi.com/v2/personas/<persona id> \
  -H "x-api-key: $TAVUS_API_KEY" -H "Content-Type: application/json" \
  -d "[
    {\"op\":\"replace\",\"path\":\"/layers/tts/tts_engine\",\"value\":\"elevenlabs\"},
    {\"op\":\"replace\",\"path\":\"/layers/tts/external_voice_id\",\"value\":\"$ELEVENLABS_VOICE_ID\"},
    {\"op\":\"replace\",\"path\":\"/layers/tts/api_key\",\"value\":\"$ELEVENLABS_API_KEY\"},
    {\"op\":\"replace\",\"path\":\"/layers/tts/tts_model_name\",\"value\":\"eleven_turbo_v2_5\"},
    {\"op\":\"replace\",\"path\":\"/layers/tts/voice_settings\",\"value\":{\"stability\":0.5,\"similarity_boost\":0.75}}
  ]"

# 3. Set NEXT_PUBLIC_TAVUS_PERSONA_ID=<persona id> in .env.local and Vercel
```

---

## Cost notes (rough, per pitch session)

A 30-minute session with ~50 utterances averaging 100 chars, ~60 voice questions averaging 3 s of audio:

| Service | Unit rate (Apr 2026) | Per-session cost |
|---|---|---|
| Tavus CVI | ~$0.10 / minute on standard plans | ~$3.00 |
| ElevenLabs STT (`scribe_v1`) | ~$0.30 / hour of audio | ~$0.05 |
| ElevenLabs TTS (`eleven_turbo_v2_5`) | ~$0.30 / 1 K chars on Creator | ~$1.50 |
| Anthropic (Claude Haiku) | ~$0.80 / 1 M input tokens, ~$4 / 1 M output | ~$0.10 (most utterances hit the rule layer) |
| Supabase | Free tier covers demo | ~$0 |
| **Total** | | **~$4.65** |

These are demo-budget; if the system goes to broader pilot the rate-limit ceilings (`30/min`, `200/hour` per IP for `/screen/process`) cap the worst-case spend per attacker IP at roughly $1 of paid services per hour even before account-wide quotas kick in.

---

## Local development

```bash
bun install
cp .env.example .env.local        # then fill in the values
bun run db:migrate                # Drizzle Kit migrations
bun scripts/ingest-asx-snapshot.ts data/snapshots/<file>.json   # one-shot ingest
bun dev                            # http://localhost:3000
```

`bun dev` forwards browser `console.warn` lines to the terminal as `[browser] …` lines. Useful for the diagnostic logs in `useTavusAvatar` (`[tavus] event: conversation.X` traces every CVI app-message Tavus dispatches).

### Useful scripts

```bash
bun run lint                    # ESLint
bunx tsc --noEmit               # Strict TypeScript check
bun run test                    # Vitest (181 cases across 9 files)
bun run db:generate             # Generate Drizzle migration from schema diff
bun run db:push                 # Push schema to Supabase (be careful in prod)
bun run db:studio               # Drizzle Studio
```

### Resetting a development snapshot

```bash
# Re-run ingest with an updated fixture (validates first, then writes)
bun scripts/ingest-asx-snapshot.ts data/snapshots/2026-04-XX.json --baseline
```

The in-process snapshot cache TTL is 60 s; restart `bun dev` if you need an immediate refresh after re-ingesting.

---

## Service-specific failure modes (and what to do)

| Symptom | Likely cause | Mitigation |
|---|---|---|
| `503` from Tavus on conversation create | Tavus quota exhausted or `TAVUS_API_KEY` rotated | Check `validateEnv()` warnings; rotate key in Vercel env |
| Pep speaks the wrong voice | Persona's TTS layer reverted (e.g. someone re-PATCHed it) | `curl https://tavusapi.com/v2/personas/<id> -H "x-api-key: $TAVUS_API_KEY" \| jq '.layers.tts'` — confirm `tts_engine: "elevenlabs"` and your `external_voice_id` |
| Pep's lip-sync is off but voice is right | WebRTC connection blip | Hook auto-reconnects once on disconnect; if it persists, hit Reset on the demo |
| `429` from `/api/v1/screen/process` | IP rate limit hit | `Retry-After` header tells the client when capacity returns. Limits are 30/min, 200/hour |
| STT timeouts | ElevenLabs slow or cold | 12 s upstream timeout fails fast; user sees a retry hint, no demo freeze |
| Cartesia voice during demo | Persona was reset to default Cartesia engine. Or fell back from broken Audio Echo | Re-run the persona PATCH from the Deployment section above |
| Snapshot row counts off | Stale fixture | Re-ingest with `--baseline` after confirming source data |
| Repeated 502s on `/api/v1/screen/*` | Database unreachable | `validateEnv()` would have flagged `DATABASE_URL`; check Supabase project status |

---

## What is *not* in production scope

- Live ASX market-data integration. Snapshot-only by design (see plan §12 D3).
- Email / monitoring infrastructure for Q7. The "daily monitoring" intent is a demo workflow only.
- Admin tooling for managing the screening criteria. Curated flags are hand-maintained in `data/curation.json` and re-applied by re-ingesting.
- Horizontal-scale rate limiting. The in-memory limiter is single-process. Move to Redis / Vercel edge limit if traffic grows beyond demo.
