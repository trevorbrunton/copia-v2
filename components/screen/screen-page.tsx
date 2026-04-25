"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Play, RotateCcw } from "lucide-react";
import { PersonaSelector, PERSONA_OPTIONS } from "@/components/demo/persona-selector";
import { FunnelRail } from "./funnel-rail";
import { StocksTable } from "./stocks-table";
import { SourceBadge } from "./source-badge";
import { StalenessBanner } from "./staleness-banner";
import { StockFactPanel } from "./stock-fact-panel";
import { ConversationPane, type TranscriptEntry } from "./conversation-pane";
import {
  METHODOLOGY_FILTERS,
  QUESTIONNAIRE_FILTERS,
  STAGE_LABELS,
  type FilterId,
  type StageId,
} from "@/src/screen/funnel";
import type { Intent } from "@/src/screen/intent";
import { useScreener } from "@/src/screen/use-screener";

type Preset = "questionnaire" | "methodology";

export function ScreenPage() {
  const screener = useScreener();
  const [selectedPersona, setSelectedPersona] = useState<string>(
    PERSONA_OPTIONS[0]?.id ?? ""
  );
  const [preset, setPreset] = useState<Preset>("questionnaire");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isThinking, setIsThinking] = useState(false);

  // Escape closes the StockFactPanel.
  useEffect(() => {
    if (selectedTicker === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedTicker(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTicker]);

  const sequence = preset === "questionnaire" ? QUESTIONNAIRE_FILTERS : METHODOLOGY_FILTERS;

  const completedStageIds: StageId[] = screener.stages.map((s) => s.id);
  const nextIdx = sequence.findIndex((f) => !completedStageIds.includes(f));
  const nextFilter: FilterId | null = nextIdx >= 0 ? sequence[nextIdx] : null;

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

  const appendTranscript = useCallback((role: "user" | "assistant", text: string) => {
    setTranscript((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role, text },
    ]);
  }, []);

  /**
   * Run a filter and report the outcome on the transcript. If
   * `screener.applyFilter` set an error, surface that instead of the
   * default success line.
   */
  const applyAndNarrate = useCallback(
    async (filterId: FilterId) => {
      const errBefore = screener.error;
      await screener.applyFilter(filterId);
      const errAfter = screener.error;
      // If a NEW error appeared, narrate failure rather than success.
      if (errAfter && errAfter !== errBefore) {
        appendTranscript("assistant", `Couldn't apply ${STAGE_LABELS[filterId]}: ${errAfter}.`);
        return false;
      }
      appendTranscript("assistant", `Applied ${STAGE_LABELS[filterId]}.`);
      return true;
    },
    [screener, appendTranscript]
  );

  /**
   * Run the entire methodology preset. Resets the funnel first so the
   * rail starts cleanly from universe — otherwise stages from a
   * mid-questionnaire run would mix with the methodology stages.
   */
  const runInitialScreen = useCallback(async () => {
    if (screener.stages.length > 1) screener.reset();
    for (const f of METHODOLOGY_FILTERS) {
      const ok = await applyAndNarrate(f);
      if (!ok) break; // bail on first failure
    }
  }, [screener, applyAndNarrate]);

  /** Convert an Intent into a UI action + a narration line. */
  const handleIntent = useCallback(
    async (text: string, intent: Intent) => {
      switch (intent.kind) {
        case "next_step": {
          if (nextFilter) {
            await applyAndNarrate(nextFilter);
          } else {
            appendTranscript("assistant", "The funnel is already complete. Try Reset to start over.");
          }
          break;
        }
        case "apply_filter": {
          await applyAndNarrate(intent.filterId);
          break;
        }
        case "apply_initial_screen": {
          // Switch to methodology preset visually.
          if (preset !== "methodology") setPreset("methodology");
          appendTranscript(
            "assistant",
            "Running the OC initial screen — applying market cap > $50m, profitable, cash-flow positive, exclusions, liquidity, and ASX-100 cut."
          );
          await runInitialScreen();
          break;
        }
        case "output_show": {
          appendTranscript(
            "assistant",
            `Showing the ${screener.currentRows.length.toLocaleString()} stocks in the current stage in the table on the right.`
          );
          break;
        }
        case "output_email": {
          toast.success("Email queued — check your inbox.", {
            description: "(Demo workflow — no email is actually sent.)",
          });
          appendTranscript(
            "assistant",
            "I've queued an email of the current list to your inbox. (This is a demo workflow — no email is actually sent.)"
          );
          break;
        }
        case "info_stock_field": {
          if (intent.ticker) {
            setSelectedTicker(intent.ticker);
            appendTranscript(
              "assistant",
              `Pulling ${intent.field?.replace(/_/g, " ") ?? "details"} for ${intent.ticker} — see the panel below.`
            );
          } else {
            appendTranscript(
              "assistant",
              "I couldn't pin down which company you meant. Try a ticker like BHP or a more specific company name."
            );
          }
          break;
        }
        case "info_portfolio_overlap": {
          const current = screener.stages.at(-1);
          if (!current) {
            appendTranscript("assistant", "Run the screen first, then ask about portfolio overlap.");
            break;
          }
          try {
            const res = await fetch("/api/v1/screen/portfolio-overlap", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ fromTickers: current.tickers }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = (await res.json()) as {
              isSample: boolean;
              matching: Array<{ ticker: string }>;
              nonMatching: Array<{ ticker: string }>;
              totalHoldings: number;
            };
            const sampleNote = data.isSample ? " (based on the sample portfolio)" : "";
            appendTranscript(
              "assistant",
              `${data.matching.length} of your ${data.totalHoldings} top holdings still meet the screen${sampleNote}. The ${data.nonMatching.length} that don't: ${data.nonMatching.map((h) => h.ticker).join(", ") || "—"}.`
            );
          } catch (e) {
            appendTranscript(
              "assistant",
              `Couldn't compute the overlap: ${e instanceof Error ? e.message : "unknown error"}.`
            );
          }
          break;
        }
        case "monitoring_enable_daily": {
          toast.success("Daily monitoring on.", {
            description: "Demo workflow — I'll email you at 6am every day.",
          });
          appendTranscript(
            "assistant",
            "Daily monitoring on. I'll email you at 6am every day, change-or-no-change. (Demo workflow — no real schedule is started.)"
          );
          break;
        }
        case "restart": {
          screener.reset();
          appendTranscript("assistant", "Funnel reset. We're back to the universe stage.");
          break;
        }
        case "fallback":
        default: {
          appendTranscript(
            "assistant",
            "I can't answer that in this demo. Try asking about a filter, a stock's price or market cap, or running the OC initial screen."
          );
          break;
        }
      }
      // `text` is unused here but reserved for future narration that may quote the user.
      void text;
    },
    [screener, nextFilter, preset, runInitialScreen, appendTranscript, applyAndNarrate]
  );

  const ask = useCallback(
    async (text: string) => {
      if (!isStarted) {
        toast.message("Press Start Screening first.");
        return;
      }
      appendTranscript("user", text);
      setIsThinking(true);
      try {
        const res = await fetch("/api/v1/screen/process", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `process failed: ${res.status}`);
        }
        const data = (await res.json()) as { intent: Intent; text: string };
        await handleIntent(text, data.intent);
      } catch (e) {
        appendTranscript(
          "assistant",
          `Error: ${e instanceof Error ? e.message : "couldn't classify the question"}.`
        );
      } finally {
        setIsThinking(false);
      }
    },
    [isStarted, appendTranscript, handleIntent]
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
          {screener.snapshot ? <SourceBadge snapshot={screener.snapshot} /> : null}
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
        {/* Left rail */}
        <aside className="flex w-full flex-col gap-6 border-r border-white/10 p-4 lg:w-[22rem]">
          <div className="flex aspect-video items-center justify-center rounded-2xl bg-[var(--oc-navy)] text-xs text-white/40">
            Avatar (phase 6)
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
                      type="button"
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

        {/* Right pane: stocks table + conversation */}
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
              <div className="flex flex-1 min-h-0">
                <StocksTable
                  rows={screener.currentRows}
                  onTickerClick={setSelectedTicker}
                  selectedTicker={selectedTicker}
                  className="flex-1 min-h-0 flex flex-col"
                />
                <ConversationPane
                  transcript={transcript}
                  isThinking={isThinking}
                  onAsk={ask}
                  className="hidden lg:flex flex-col w-[26rem] border-l border-white/10"
                />
              </div>
              {selectedTicker ? (
                <StockFactPanel
                  key={selectedTicker}
                  ticker={selectedTicker}
                  onClose={() => setSelectedTicker(null)}
                />
              ) : null}
              {/* Mobile: conversation under the table */}
              <ConversationPane
                transcript={transcript}
                isThinking={isThinking}
                onAsk={ask}
                className="lg:hidden flex flex-col h-[40svh] border-t border-white/10"
              />
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
