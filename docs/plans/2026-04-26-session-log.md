# Session Log — 2026-04-26

**Branch:** `main` (all work pushed to `origin/main`)
**Starting commit:** `bc58c3b` (yesterday's session-log commit)
**Ending commit:** `07170ee` (Phase C: Fund Q&A mode UI on /demo/screen)
**Net diff:** 8 files changed, +692 / −37 (=+655 lines net)
**Test status:** 149/149 passing (was 130 at session start)
**Voice state:** **Working** — user confirmed persona-side ElevenLabs path plays the cloned voice cleanly.

---

## What was done

### 1. Opener — Pep greets when ready ✓ shipped

The avatar previously sat silent at `ready` until the user spoke or clicked. Useful in production but kills audience confidence during a pitch — they don't hear the cloned voice until they ask a question.

| Commit | What |
|---|---|
| `a252837` | New `describeOpening()` template + a guarded `useEffect` in `screen-page.tsx` that fires once when both `tavusAvatar.status === "ready"` AND `screener.snapshot !== null`. `openingSpokenRef` guards against replays on reconnect |
| `bcd092b` | Dropped the misleading "OC Mid-Cap screen" reference — the screen is fund-agnostic. Final wording: *"Hi — I'm Pep. Say 'run the OC initial screen' to get started."* |

### 2. Multi-fund Q&A — three-phase feature ✓ shipped

A new "Fund Q&A" mode on `/demo/screen` that lets Pep answer pre-scripted questions about three OC funds (Mid-Cap, Micro-Cap, Premium Small Companies). Pattern matches v1's pre-scripted Q&A approach but parameterised by fund.

| Commit | Phase | What |
|---|---|---|
| `0c1d429` | A — Content | New `data/fund-qa.json`: 3 funds × 21 categories = 63 hand-curated, spoken answers (1-3 sentences each). Source: PDS extracts in `docs/fund-data/` plus the CFS factsheet for Premium Small Companies. Per D7-style honesty, fee/minimum fields without disclosure in source point to "the latest PDS" rather than fabricate |
| `ba9d4ce` | B — Engine | New `src/screen/fund-qa.ts` typed loader + `FundId` / `CategoryId` unions + module-load assertion. New `info_fund_field` intent kind. New rule in `intent-rules.ts` that fires only when a fund name is present (defaults category to `fund_overview` if only the fund is named). Anthropic classifier prompt + Zod + switch case extended. `describeFundFact()` + recovery templates. **18 new test cases** + 2 negative cases (149/149 total) |
| `07170ee` | C — UI | Mode toggle `Screening | Fund Q&A` in left rail. When in Fund Q&A: vertical fund picker replaces the funnel rail; right pane swaps stocks-table for a 2-column grid of all 21 category buttons. Each category click → direct `narrate(getFundAnswer(...))` (no LLM call). Voice mic still works in both modes. In `fund_qa` mode, missing `fundId` in voice intent fills from `activeFund` selector |

**Architectural notes baked in:**
- Q&A bank is JSON, not DB — matches the v2 "snapshot-as-data" pattern (see `data/curation.json`, `data/asx/`).
- Rule layer requires explicit fund mention in screening mode so "what are the fees" mid-screen doesn't accidentally route to fund-info.
- `askAboutCategory(fundId, category)` bypasses `/process` route on click — we already know the answer, no LLM needed. Logs a synthetic user transcript line so the chat reads naturally.
- `Rule.build` signature changed to receive the matched `text` so the fund-info rule can re-extract `fundId + category` from the same string. Existing rules that ignore the param still compile.

### 3. Two small fixes that crept in

| Commit | What |
|---|---|
| `a252837` (also) | Wrapped the opener's `appendTranscript` in `queueMicrotask` to satisfy React 19's `react-hooks/set-state-in-effect` rule. Without it, lint blocked. |

---

## Final system state

**Code surface:**
- `/demo/screen` has two modes: **Screening** (existing 8-question funnel + stocks table) and **Fund Q&A** (3 funds × 21 categories).
- Persona `p47e2741f57e` (Pep) configuration **unchanged** from yesterday: echo mode + ElevenLabs TTS in cloned voice. Both new modes use the same `tavusAvatar.echo()` path.
- Q&A bank lives at `data/fund-qa.json` — editable as data, not code.

**Test status:** 149/149 passing (was 130 at session start, +18 fund-info rule cases + 1 sweep test from yesterday's session that I'd missed counting).
**Lint:** 0 errors (one pre-existing unrelated React-Compiler warning in `profile-tab.tsx:79`).
**Typecheck:** clean.

---

## What's NOT done — for the next session

### Pitch blockers (still)

1. **Vercel deploy.** Yesterday's blocker is still yesterday's blocker. Set every env var in `docs/INFRASTRUCTURE.md` § "Environment variables" on the Vercel project — particularly `NEXT_PUBLIC_TAVUS_PERSONA_ID=p47e2741f57e`. Smoke-test the deployed URL with one voice question + one fund-info click.

2. **Pitch run-through against `docs/plans/pep-avatar-v2-pitch-script.md`.** The script was written before the Fund Q&A feature existed — worth either:
   - (a) Updating the script to add a "Fund Q&A demo" segment after the screening section, or
   - (b) Treating Fund Q&A as a self-directed exploration the audience can drive.

### Q&A content review (data quality)

3. **Hand-review the 63 spoken answers in `data/fund-qa.json`** against the PDFs in `docs/fund-data/`. Three flags called out yesterday:
   - **OC Micro-Cap APIR code** I guessed `OPS0001AU` — I couldn't find it in the source docs. Verify before pitch.
   - **OC Premium Small Companies fee fields** are stubbed as "refer to the latest PDS" because the TMD + CFS factsheet don't carry them. If you have the retail PDS, fill them in.
   - **Premium Small Companies performance numbers** quote the "Investments" row from the CFS factsheet (3yr 7.02%, 5yr 5.20%). If you'd rather quote Personal Super or Retirement, swap the values.
4. **Optional rewording**: any spoken answer that reads stiff when spoken aloud. Easy edits via the JSON.

### Open decision (carried forward from yesterday)

5. **`docs/standards/app_architecture_*.md` — restore or accept the deletion?** Three cross-project guides were bundled into commit `76217a0` yesterday. If accidental: `git checkout a8118e2 -- docs/standards/`. If intentional: nothing to do.

### Optional polish

6. **Pitch-script update for Fund Q&A.** The current script is screening-only. A 5-minute edit to add the new mode's flow.
7. **Reconnect UX polish** (still on yesterday's list — silent `tavusAvatar` reconnect could surface a "Reconnecting Pep…" status in `avatar-video.tsx`).
8. **Auth-route test coverage gap** (still on yesterday's list).
9. **Mobile layout verification** — Fund Q&A panel + ConversationPane stack via existing `lg:` classes; matches Screening mode but not eyeballed on a real device.
10. **Cross-fund comparison intent.** "Compare the Mid-Cap and Micro-Cap fees" is currently a `fallback`. Pre-scripted comparison answers would be a Phase D — out of scope for the pitch but worth flagging.

### Watch-outs

- The Fund Q&A category buttons go through `askAboutCategory` which bypasses `/process` entirely — no rate-limit applied because no external call. If a user spammed buttons, ElevenLabs TTS via Tavus's persona would still get hit per echo. The Tavus persona has its own server-side TTS rate; if that becomes a real concern, add a client-side debounce on `askAboutCategory`.
- The fund-info rule layer's category patterns have intentional broad regexes (e.g. `\bright\s+for\b` for `target_market`). False positives in screening mode are blocked by the "must mention fund" gate, but if the gate ever loosens, double-check each pattern.

---

## Files that warrant a glance before deploy

- **`data/fund-qa.json`** — content review (the 63 answers).
- **`.env.example`** vs Vercel project env — confirm parity, especially the new fund Q&A doesn't introduce any env (it doesn't).
- **`docs/plans/pep-avatar-v2-pitch-script.md`** — decide whether to extend it for Fund Q&A.
- **`docs/INFRASTRUCTURE.md`** — env var list is current; deploy steps are complete.

---

## Sentinel

If a future session opens this log and the date is **2026-04-27** or later: the pitch deadline was imminent at session close on **2026-04-26**, with voice working and Fund Q&A shipped. If the pitch already happened, the post-mortem belongs in a fresh session log; this one captures the engineering state as of session close.
