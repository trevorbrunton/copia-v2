"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw } from "lucide-react";
import { PersonaSelector, PERSONA_OPTIONS } from "@/components/demo/persona-selector";
import { FunnelRail } from "./funnel-rail";
import { StocksTable } from "./stocks-table";
import { SourceBadge } from "./source-badge";
import { StalenessBanner } from "./staleness-banner";
import {
  METHODOLOGY_FILTERS,
  QUESTIONNAIRE_FILTERS,
  STAGE_LABELS,
  type StageId,
} from "@/src/screen/funnel";
import { useScreener } from "@/src/screen/use-screener";

type Preset = "questionnaire" | "methodology";

export function ScreenPage() {
  const screener = useScreener();
  const [selectedPersona, setSelectedPersona] = useState<string>(
    PERSONA_OPTIONS[0]?.id ?? ""
  );
  const [preset, setPreset] = useState<Preset>("questionnaire");

  const sequence = preset === "questionnaire" ? QUESTIONNAIRE_FILTERS : METHODOLOGY_FILTERS;

  // Position within the active preset: which filter would `Next` apply?
  const completedStageIds: StageId[] = screener.stages.map((s) => s.id);
  const nextIdx = sequence.findIndex((f) => !completedStageIds.includes(f));
  const nextFilter = nextIdx >= 0 ? sequence[nextIdx] : null;

  const pending = useMemo(
    () =>
      sequence
        .slice(nextIdx >= 0 ? nextIdx : sequence.length)
        .map((id) => ({ id, label: STAGE_LABELS[id] })),
    [sequence, nextIdx]
  );

  const isStarted = screener.snapshot !== null;
  const isBusy = screener.status === "loading" || screener.status === "applying";
  const enrichmentFailed = useMemo(
    () =>
      screener.currentRows.filter(
        (r) => r.dataQuality?.enrichment_status !== "ok"
      ).length,
    [screener.currentRows]
  );

  return (
    <div className="flex h-svh flex-col bg-[var(--oc-dark)] text-white">
      {/* ─── Header ───────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white font-bold text-[var(--oc-navy)] text-sm">
            OC
          </div>
          <div>
            <h1 className="text-sm font-semibold">OC Premium Dynamic — Live Screening Demo</h1>
            <p className="text-xs text-white/50">Pep Avatar v2</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {screener.snapshot ? (
            <SourceBadge snapshot={screener.snapshot} />
          ) : null}
        </div>
      </header>

      {screener.snapshot ? <StalenessBanner snapshot={screener.snapshot} /> : null}
      {screener.error ? (
        <div className="border-b border-red-400/30 bg-red-500/10 px-4 py-2 text-xs text-red-200">
          {screener.error}
        </div>
      ) : null}

      {/* ─── Body ────────────────────────────────────────────── */}
      <main className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Left rail: avatar placeholder + funnel */}
        <aside className="flex w-full flex-col gap-6 border-r border-white/10 p-4 lg:w-[22rem]">
          <div className="flex aspect-video items-center justify-center rounded-2xl bg-[var(--oc-navy)] text-xs text-white/40">
            Avatar (phase 5)
          </div>

          {!isStarted ? (
            <div className="flex flex-col items-stretch gap-3">
              <PersonaSelector selectedId={selectedPersona} onChange={setSelectedPersona} />
              <Button
                onClick={() => void screener.start()}
                disabled={isBusy}
                className="bg-white text-[var(--oc-navy)] hover:bg-white/90 gap-2"
              >
                <Play className="h-4 w-4" />
                {screener.status === "loading"
                  ? "Loading snapshot…"
                  : screener.status === "error"
                    ? "Retry"
                    : "Start Screening"}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-xs text-white/60">
                <span className="font-medium">Preset</span>
                <div className="flex gap-1 rounded-md bg-white/5 p-0.5">
                  {(["questionnaire", "methodology"] as Preset[]).map((p) => (
                    <button
                      key={p}
                      onClick={() => setPreset(p)}
                      disabled={screener.stages.length > 1}
                      className={`rounded px-2 py-1 text-xs ${
                        preset === p
                          ? "bg-white text-[var(--oc-navy)]"
                          : "text-white/70 hover:text-white"
                      } disabled:opacity-50 disabled:hover:text-white/70`}
                    >
                      {p === "questionnaire" ? "Pep's 8 Qs" : "OC methodology"}
                    </button>
                  ))}
                </div>
              </div>

              <FunnelRail stages={screener.stages} pending={pending} />

              <div className="flex gap-2">
                <Button
                  onClick={() => nextFilter && void screener.applyFilter(nextFilter)}
                  disabled={!nextFilter || isBusy}
                  className="flex-1 bg-white text-[var(--oc-navy)] hover:bg-white/90"
                >
                  {isBusy ? "Applying…" : nextFilter ? "Next filter →" : "Funnel complete"}
                </Button>
                <Button
                  onClick={screener.reset}
                  disabled={isBusy || screener.stages.length <= 1}
                  variant="ghost"
                  className="text-white/70 hover:bg-white/5 hover:text-white"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </aside>

        {/* Right pane: stocks table */}
        <section className="flex flex-1 min-h-0 flex-col">
          {isStarted ? (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2 text-xs text-white/60">
                <span>
                  Current stage:{" "}
                  <span className="text-white">
                    {screener.stages.at(-1)?.label ?? "—"}
                  </span>{" "}
                  · {screener.currentRows.length.toLocaleString()} rows
                </span>
                {enrichmentFailed > 0 ? (
                  <span title="Securities with incomplete enrichment data" className="text-amber-300/80">
                    {enrichmentFailed.toLocaleString()} with incomplete data
                  </span>
                ) : null}
              </div>
              <StocksTable rows={screener.currentRows} className="flex-1 min-h-0 flex flex-col" />
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-white/40">
              Press <span className="mx-1 font-medium text-white/70">Start Screening</span> to load the snapshot.
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
