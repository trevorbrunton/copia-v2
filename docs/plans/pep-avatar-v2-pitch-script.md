# Pep Avatar v2 — Pitch Run-Through Script

**Audience:** demonstrator (Trevor) running the demo for the OC team in real time.

**URL:** `https://<vercel-deployment>/demo/screen`

**Pre-flight check (do this 5 minutes before the meeting):**

1. ✅ Open the URL in a fresh tab on a stable network.
2. ✅ Snapshot date in the header reads **2026-04-24** (or fresher).
3. ✅ No yellow / red staleness banner. If yellow → mention it once when explaining freshness; if red → re-run `bun scripts/ingest-asx-snapshot.ts` before the meeting.
4. ✅ Click **Start Screening** with the **Custom** persona selected. Pep's face should appear within ~5s.
5. ✅ Sound on. Test mic permission if planning to use voice mode.
6. ✅ Have this script handy in a second monitor / printed.

If anything fails, the typed-input flow below works without Pep's voice — the screen narration still appears in the transcript.

---

## Opening (30 seconds)

> "Today I want to show you a demo of something we've been building — a screening assistant that wraps OC's actual workflow as an interactive tool. The data is a snapshot of the ASX taken on 24 April. Pep's voice and likeness are powered by our existing avatar platform; the screening logic is yours, encoded as deterministic rules.
>
> Two journeys today: first I'll walk Pep through your eight scripted demo questions, then I'll ask him to **run the OC initial screen** in one shot — the actual methodology from the FSC questionnaire."

Click **Start Screening** if you haven't already. Wait for Pep to settle on screen.

---

## Path 1 — The Questionnaire (Pep's eight scripted questions)

Make sure the preset toggle is on **"Pep's 8 Qs"** (the default before any filter is applied).

Ask each question, then pause for Pep's narration before continuing. The funnel rail on the left animates with each step.

| # | Ask Pep (voice or typed) | What you should see | Caveat to mention |
|---|---|---|---|
| 1 | *"Show me ASX stocks with a market cap of more than 50 million dollars."* | Funnel adds `Mcap > $50m`. Pep says **"940 stocks…"** | Pep originally guessed ~500 — the live snapshot shows 940 because we cover ~1,840 stocks, not just the top 500. Mention if asked about the discrepancy. |
| 2 | *"Take the top 100 by market cap."* | Funnel adds `Top 100`. Table shows CBA, BHP, RIO at the top. | — |
| 3 | *"Filter to stocks with annual turnover of at least 20%."* | Funnel adds `Turnover ≥ 20%`. Count drops from 100 → 86. | — |
| 4 | *"Remove unprofitable companies."* | Funnel adds `Profitable (TTM)`. Count drops from 86 → 79. | NXT (NEXTDC) gets dropped here — useful for the Q8 portfolio answer later. |
| 5 | *"Filter out unproven or complex technology."* | Funnel adds `Exclude unproven / complex tech`. Count stays 79. Pep says the framing: *"Every stock with unproven tech in this snapshot has already been excluded by the profitability filter."* | This is a **curated demo flag**, not an automatic classification. Pep's narration says so explicitly per §7c. |
| 6 | *"Filter out single-commodity / single-mine stocks."* | Funnel adds `Exclude single commodity`. Count drops from 79 → 65. | This is also curated — NST, EVN, PRU, GMD, RMS, SFR, CSC, AAI, LYC, YAL, WHC, WDS, STO, ALD. Mention if asked. |
| 7 | *"Send me a daily email on changes to this screen."* | Toast confirmation; Pep narrates the demo workflow. | Honest disclosure: *"Demo workflow — no real schedule is started."* |
| 8 | *"How many of my holdings still meet this screen?"* | Pep recites the overlap. | Built on the **sample portfolio** (10 holdings the OC team supplied — labelled as sample). |

> **Tip:** to advance the funnel manually if voice classification stutters, click **Next filter →** in the left rail. The narration follows the same script.

---

## Path 2 — The OC initial screen (one-shot)

Once Path 1 is done, optionally click **Reset** to clear the rail. Then say:

> *"Run the OC initial screen."*

You should see:

- The preset toggle flips to **"OC methodology"**.
- The funnel rail animates through **7 stages**: Mcap > $50m → Profitable → Cash-flow positive → Exclude unproven tech → Exclude single commodity → Sufficient liquidity → Exclude ASX 100.
- Final count lands at **159** (different from Path 1's 65 because the methodology filters in a different order and excludes ASX 100).
- Pep narrates each step.

> **Caveat to mention if asked:** the OC Premium Small Company Fund has a **20% strategic exception** for ASX 100 names. Our v2 demo applies a hard exclusion. If your question is "how many of *my* holdings meet this?" — most of your top-10 are ASX 100 names today, so the strict screen lands close to zero. That's the methodology working as written; you'd allow the exception in the live fund.

---

## Path 3 — Stock-fact follow-ups

After either funnel completes, you can interrogate any name in the shortlist. Click a ticker in the table OR ask:

| Ask Pep | Expected answer |
|---|---|
| *"What's BHP's market cap?"* | Pep says "$285B" (or similar) and mentions "from our snapshot of 2026-04-24". A panel opens below the table with the StockFact + source badge. |
| *"What is Commonwealth Bank's market cap?"* | Same shape, resolves to CBA via the bigram pass. |
| *"Is NXT profitable?"* | "Unprofitable (TTM)." |
| *"What's the price of Nextdc?"* | Resolves NXT via the company-name pass. |

---

## Closing (30 seconds)

> "Three things to take away:
>
> 1. **Productisation:** every step Pep just took is your published process, encoded once and replayable for any client conversation.
> 2. **Honesty:** every number Pep says is sourced and timestamped. He doesn't invent values, he doesn't claim things are 'live' that aren't, and the curated flags are framed as curated.
> 3. **Extensibility:** swapping in a live ASX feed is a one-file change behind the `MarketDataProvider` interface. The funnel and the avatar don't have to change.
>
> Happy to go deeper on any of those — or take any other questions you'd run past your analyst team."

---

## Recovery

| Symptom | Action |
|---|---|
| Pep's video doesn't appear | Check `NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM` in Vercel env. Demo still runs in text mode — the transcript shows everything. |
| Voice mic doesn't work | Click the mic icon in the rail to disable; switch to typed input. |
| A specific filter answer is wrong vs. expected | Open `tests/screen/expected-preset-counts.json` — the fixture should match. Drift means re-ingest. |
| Tavus session disconnects mid-demo | Click **Reset** then **Start Screening** again. Snapshot stays loaded. |
| Anthropic classifier outage | The rule layer covers all 8 scripted questions; only paraphrases beyond the rules will fall to `fallback`. Stick to the script wording. |

---

## After the demo

- **If the OC team wants to play with it themselves:** share the URL — it's public, no auth, no rate limit.
- **If they ask about deployment:** running on Vercel; data lives in our shared Supabase Postgres; ASX snapshot is updated via `bun scripts/ingest-asx-snapshot.ts` (one-shot, idempotent).
- **If they ask about the real OC holdings:** sample data per D8 — they can replace it via `data/curation.json`-style override + re-ingest.
