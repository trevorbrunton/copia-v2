"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, Play, RotateCcw } from "lucide-react";
import { FunnelRail } from "./funnel-rail";
import { StocksTable } from "./stocks-table";
import { SourceBadge } from "./source-badge";
import { StalenessBanner } from "./staleness-banner";
import { StockFactPanel } from "./stock-fact-panel";
import { ConversationPane, type TranscriptEntry } from "./conversation-pane";
import { AvatarVideo } from "./avatar-video";
import {
  METHODOLOGY_FILTERS,
  QUESTIONNAIRE_FILTERS,
  STAGE_LABELS,
  type FilterId,
  type StageId,
} from "@/src/screen/funnel";
import type { Intent } from "@/src/screen/intent";
import { useScreener } from "@/src/screen/use-screener";
import {
  describeAppliedFilter,
  describeAppliedFilterFailure,
  describeFallback,
  describeFunnelComplete,
  describeInitialScreenStart,
  describeMonitoringEnabled,
  describeOpening,
  describeOutputEmail,
  describeOutputShow,
  describePortfolioOverlap,
  describeRestart,
  describeStockFactRequest,
  describeStockFactUnresolved,
} from "@/src/screen/narration";
import { useTavusAvatar } from "@/src/demo/use-tavus-avatar";
import { useVoiceListener } from "@/src/demo/use-voice-listener";

type Preset = "questionnaire" | "methodology";

// Single configured Pep persona — must be `pipeline_mode: "echo"` per
// docs/TAVUS-PERSONA-SETUP.md. Read once at module load; surfaced as a
// constant so the rest of the page just consumes it.
const PEP_PERSONA_ID = process.env.NEXT_PUBLIC_TAVUS_PERSONA_ID ?? "";

export function ScreenPage() {
  const screener = useScreener();
  const tavusAvatar = useTavusAvatar();

  const [preset, setPreset] = useState<Preset>("questionnaire");
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);

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

  const appendTranscript = useCallback(
    (role: "user" | "assistant", text: string) => {
      setTranscript((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role, text },
      ]);
    },
    []
  );

  // Track tavus availability via ref so dispatcher closures see the latest.
  const tavusReadyRef = useRef(false);
  useEffect(() => {
    tavusReadyRef.current =
      tavusAvatar.status === "ready" || tavusAvatar.status === "speaking";
  }, [tavusAvatar.status]);

  // One-shot opener: spoken when both the avatar reaches `ready` AND the
  // snapshot has loaded, so the audience hears the cloned voice and a
  // hint of what to ask. Guarded by a ref so an avatar reconnect mid-
  // session doesn't replay the greeting. The state-touching work is
  // queued via `queueMicrotask` so it runs after the effect completes
  // (React 19 forbids setState inside an effect's synchronous body).
  const openingSpokenRef = useRef(false);
  useEffect(() => {
    if (openingSpokenRef.current) return;
    if (tavusAvatar.status !== "ready") return;
    if (!screener.snapshot) return;
    openingSpokenRef.current = true;
    queueMicrotask(() => {
      const greeting = describeOpening();
      appendTranscript("assistant", greeting);
      tavusAvatar.echo(greeting).catch((err) => {
        console.warn("[screen] tavus opening echo failed:", err);
      });
    });
  }, [tavusAvatar, screener.snapshot, appendTranscript]);

  /**
   * Append an assistant line to the transcript AND have Pep speak it
   * via Tavus echo when the avatar is ready. Best-effort — avatar
   * failures are logged but don't break the text path.
   */
  const narrate = useCallback(
    (text: string) => {
      appendTranscript("assistant", text);
      if (tavusReadyRef.current) {
        tavusAvatar.echo(text).catch((err) => {
          console.warn("[screen] tavus echo failed:", err);
        });
      }
    },
    [appendTranscript, tavusAvatar]
  );

  /**
   * Apply a filter and narrate the outcome.
   *
   * `applyFilter` returns null both on real failures AND on early-return
   * paths (in-flight, wrong status, no current stage). To distinguish
   * "didn't run" from "ran and failed" we capture `screener.error`
   * before the call and only narrate failure if a NEW error was set.
   */
  const applyAndNarrate = useCallback(
    async (filterId: FilterId): Promise<boolean> => {
      const prevCount = screener.stages.at(-1)?.count ?? 0;
      const errBefore = screener.error;
      const stage = await screener.applyFilter(filterId);
      if (stage) {
        narrate(describeAppliedFilter(filterId, stage.count, prevCount));
        return true;
      }
      const errAfter = screener.error;
      if (errAfter && errAfter !== errBefore) {
        narrate(describeAppliedFilterFailure(filterId, errAfter));
        return false;
      }
      // Early-return path (e.g. duplicate click while applying). Stay silent.
      return false;
    },
    [screener, narrate]
  );

  /** Run the full methodology preset, resetting first for a clean rail. */
  const runInitialScreen = useCallback(async () => {
    if (screener.stages.length > 1) screener.reset();
    for (const f of METHODOLOGY_FILTERS) {
      const ok = await applyAndNarrate(f);
      if (!ok) break;
    }
  }, [screener, applyAndNarrate]);

  const handleIntent = useCallback(
    async (intent: Intent) => {
      switch (intent.kind) {
        case "next_step":
          if (nextFilter) {
            await applyAndNarrate(nextFilter);
          } else {
            narrate(describeFunnelComplete());
          }
          break;
        case "apply_filter":
          await applyAndNarrate(intent.filterId);
          break;
        case "apply_initial_screen":
          if (preset !== "methodology") setPreset("methodology");
          narrate(describeInitialScreenStart());
          await runInitialScreen();
          break;
        case "output_show": {
          const current = screener.stages.at(-1);
          narrate(
            current
              ? describeOutputShow(current)
              : "There's nothing to show yet — start the screen first."
          );
          break;
        }
        case "output_email":
          toast.success("Email queued — check your inbox.", {
            description: "Demo workflow — no email is actually sent.",
          });
          narrate(describeOutputEmail());
          break;
        case "info_stock_field":
          if (intent.ticker) {
            setSelectedTicker(intent.ticker);
            narrate(
              describeStockFactRequest(
                intent.ticker,
                intent.field,
                screener.snapshot?.date
              )
            );
          } else {
            narrate(describeStockFactUnresolved());
          }
          break;
        case "info_portfolio_overlap": {
          const current = screener.stages.at(-1);
          if (!current) {
            narrate("Run the screen first, then ask about portfolio overlap.");
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
            narrate(
              describePortfolioOverlap({
                matching: data.matching.length,
                totalHoldings: data.totalHoldings,
                nonMatchingTickers: data.nonMatching.map((h) => h.ticker),
                isSample: data.isSample,
              })
            );
          } catch (e) {
            narrate(
              `Couldn't compute the overlap: ${e instanceof Error ? e.message : "unknown error"}.`
            );
          }
          break;
        }
        case "monitoring_enable_daily":
          toast.success("Daily monitoring on.", {
            description: "Demo workflow — no real schedule is started.",
          });
          narrate(describeMonitoringEnabled());
          break;
        case "restart":
          screener.reset();
          narrate(describeRestart());
          break;
        case "fallback":
        default:
          narrate(describeFallback());
          break;
      }
    },
    [screener, nextFilter, preset, runInitialScreen, narrate, applyAndNarrate]
  );

  /** Send transcribed/typed text through the intent pipeline. */
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
        const data = (await res.json()) as { intent: Intent };
        await handleIntent(data.intent);
      } catch (e) {
        narrate(`Error: ${e instanceof Error ? e.message : "couldn't classify the question"}.`);
      } finally {
        setIsThinking(false);
      }
    },
    [isStarted, appendTranscript, handleIntent, narrate]
  );

  /** Voice handler — POST audio multipart to /process. */
  const handleUtterance = useCallback(
    async (pcm: ArrayBuffer, sampleRate: number) => {
      setIsThinking(true);
      try {
        const form = new FormData();
        form.append("audio", new Blob([pcm], { type: "application/octet-stream" }));
        form.append("sampleRate", String(sampleRate));
        const res = await fetch("/api/v1/screen/process", {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(45_000),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error?.message ?? `process (audio) failed: ${res.status}`);
        }
        const data = (await res.json()) as { text: string; intent: Intent };
        if (!data.text) return; // no speech detected
        appendTranscript("user", data.text);
        await handleIntent(data.intent);
      } catch (e) {
        narrate(`Error: ${e instanceof Error ? e.message : "couldn't transcribe the audio"}.`);
      } finally {
        setIsThinking(false);
      }
    },
    [appendTranscript, handleIntent, narrate]
  );

  const voiceListener = useVoiceListener({ onUtterance: handleUtterance });

  // Pause/resume the voice listener while the avatar is speaking so we
  // don't transcribe Pep's own voice as a follow-up question.
  useEffect(() => {
    if (!voiceEnabled) return;
    if (tavusAvatar.status === "speaking") voiceListener.pause();
    else voiceListener.resume();
  }, [tavusAvatar.status, voiceEnabled, voiceListener]);

  // Cleanup Tavus + voice on unmount.
  useEffect(() => {
    return () => {
      voiceListener.stop();
      tavusAvatar.stopAvatar().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the StockFactPanel.
  useEffect(() => {
    if (selectedTicker === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedTicker(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedTicker]);

  /** Start the demo — load snapshot AND init Tavus in parallel. */
  const startSession = useCallback(async () => {
    await Promise.all([
      screener.start(),
      (async () => {
        if (!PEP_PERSONA_ID) return;
        const ok = await tavusAvatar.initAvatar(PEP_PERSONA_ID);
        if (!ok) {
          toast.message("Avatar offline — text mode only.", {
            description: "The screening flow still works without Pep speaking.",
          });
        }
      })(),
    ]);
  }, [screener, tavusAvatar]);

  /** Toggle voice listening. */
  const toggleVoice = useCallback(async () => {
    if (voiceEnabled) {
      voiceListener.stop();
      setVoiceEnabled(false);
      return;
    }
    try {
      await voiceListener.start();
      setVoiceEnabled(true);
    } catch (e) {
      toast.error("Mic access denied.", {
        description: e instanceof Error ? e.message : String(e),
      });
    }
  }, [voiceEnabled, voiceListener]);

  return (
    <div className="flex h-svh flex-col bg-[var(--oc-dark)] text-white">
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

      <main className="flex flex-1 min-h-0 flex-col lg:flex-row">
        {/* Left rail */}
        <aside className="flex w-full flex-col gap-6 border-r border-white/10 p-4 lg:w-[22rem]">
          <AvatarVideo
            mediaStream={tavusAvatar.mediaStream}
            status={tavusAvatar.status}
            error={tavusAvatar.error}
          />

          {!isStarted ? (
            <div className="flex flex-col items-stretch gap-3">
              <Button
                onClick={() => void startSession()}
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
                  onClick={() => nextFilter && void applyAndNarrate(nextFilter)}
                  disabled={!nextFilter || isBusy}
                  className="flex-1 bg-white text-[var(--oc-navy)] hover:bg-white/90"
                >
                  {isBusy ? "Applying…" : nextFilter ? "Next filter →" : "Funnel complete"}
                </Button>
                <Button
                  onClick={() => {
                    screener.reset();
                    narrate(describeRestart());
                  }}
                  disabled={isBusy || screener.stages.length <= 1}
                  variant="ghost"
                  className="text-white/70 hover:bg-white/5 hover:text-white"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
                <Button
                  onClick={() => void toggleVoice()}
                  variant="ghost"
                  className={`text-white/70 hover:bg-white/5 ${
                    voiceEnabled ? "text-emerald-300" : ""
                  }`}
                  title={voiceEnabled ? "Stop voice listening" : "Start voice listening"}
                >
                  {voiceEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
                </Button>
              </div>
              {voiceEnabled ? (
                <div className="text-xs text-white/50">
                  {voiceListener.isSpeaking
                    ? "Listening — go ahead."
                    : tavusAvatar.status === "speaking"
                      ? "Pep is speaking…"
                      : "Mic on. Ask Pep anything."}
                </div>
              ) : null}
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
