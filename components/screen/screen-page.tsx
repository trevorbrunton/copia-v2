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
  describeFundFact,
  describeFundFactMissingCategory,
  describeFundFactMissingFund,
  describeFunnelComplete,
  describeMethodologyIntro,
  describeMethodologyTransition,
  describeMonitoringEnabled,
  describeOutputEmail,
  describeOutputShow,
  describePortfolioOverlap,
  describeQuestionnaireIntro,
  describeQuestionnaireTransition,
  describeRestart,
  describeStockFactRequest,
  describeStockFactUnresolved,
  describeUniverseStage,
} from "@/src/screen/narration";
import {
  CATEGORY_IDS,
  getCategoryLabel,
  getFundAnswer,
  getFundDisplayName,
  listFunds,
  type CategoryId,
  type FundId,
} from "@/src/screen/fund-qa";
import { useTavusAvatar } from "@/src/demo/use-tavus-avatar";
import { useVoiceListener } from "@/src/demo/use-voice-listener";

type Preset = "questionnaire" | "methodology";
type Mode = "screening" | "fund_qa";

const FUNDS = listFunds();

/**
 * Pause after each narrate() echo before releasing the queue for the
 * next call. Tavus's `stopped_speaking` event fires when the server
 * stops streaming audio, but the client-side buffer can still have a
 * few hundred ms of audio trailing — the pause lets it drain so the
 * next echo doesn't interrupt the tail of the current one. Also gives
 * the audience a natural beat between thoughts.
 */
const INTER_NARRATION_PAUSE_MS = 750;

// Single configured Pep persona — must be `pipeline_mode: "echo"` per
// docs/TAVUS-PERSONA-SETUP.md. Read once at module load; surfaced as a
// constant so the rest of the page just consumes it.
const PEP_PERSONA_ID = process.env.NEXT_PUBLIC_TAVUS_PERSONA_ID ?? "";

export function ScreenPage() {
  const screener = useScreener();
  const tavusAvatar = useTavusAvatar();

  const [preset, setPreset] = useState<Preset>("questionnaire");
  // Tracks which preset's introduction has already finished SPEAKING
  // this session — drives the rail's Introduction step (checked vs
  // pending). Set AFTER the narrate() promise resolves so the visual
  // doesn't flip before Pep finishes the line.
  // The auto-fire effect uses `introQueuedForPresetRef` (synchronous)
  // to avoid double-firing while the audio is in flight.
  const [introSpokenForPreset, setIntroSpokenForPreset] =
    useState<Preset | null>(null);
  const introQueuedForPresetRef = useRef<Preset | null>(null);
  // Same split for universe — `universeSpoken` drives the rail; the
  // ref guards against the auto-fire effect re-queuing during the
  // window between queue + audio-finish.
  const [universeSpoken, setUniverseSpoken] = useState(false);
  const universeQueuedRef = useRef(false);
  const [mode, setMode] = useState<Mode>("screening");
  const [activeFund, setActiveFund] = useState<FundId>("mid_cap");
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

  // The session greeting now lives at the start of the per-preset
  // intro narration (describeQuestionnaireIntro / describeMethodologyIntro
  // both open with "Hi, I'm Pep…"). One greeting + one philosophy line
  // = one echo, no risk of the second cutting off the first.
  const tavusStatus = tavusAvatar.status;

  /**
   * Append an assistant line to the transcript AND have Pep speak it
   * via Tavus echo when the avatar is ready.
   *
   * Echoes are serialized through `narrationQueueRef`: each call
   * chains onto the previous one so a rapid second narrate (e.g. the
   * universe-stage line firing right after the intro) doesn't
   * interrupt the in-flight speech. Tavus's echoResolveRef inside
   * useTavusAvatar holds only one resolver at a time — sending a
   * second echo while one is still playing was overwriting the first
   * resolver and triggering a mid-sentence cut. The queue keeps the
   * audio contiguous.
   *
   * After each echo we wait `INTER_NARRATION_PAUSE_MS` before
   * releasing the queue. Tavus's `stopped_speaking` event fires when
   * the server stops streaming audio, but the client-side buffer can
   * still have a few hundred ms of audio trailing. The pause lets
   * that drain so the next narration doesn't trample the tail of the
   * current one. It also gives the audience a beat between thoughts.
   *
   * Returns the promise that resolves when this specific narration
   * finishes (including the trailing pause), so callers that want to
   * chain can. Existing fire-and-forget callers ignore it.
   */
  const narrationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const narrate = useCallback(
    (text: string): Promise<void> => {
      appendTranscript("assistant", text);
      if (!tavusReadyRef.current) return Promise.resolve();
      const next = narrationQueueRef.current
        .then(() =>
          tavusAvatar.echo(text).catch((err) => {
            console.warn("[screen] tavus echo failed:", err);
          })
        )
        .then(
          () => new Promise<void>((r) => setTimeout(r, INTER_NARRATION_PAUSE_MS))
        );
      narrationQueueRef.current = next;
      return next;
    },
    [appendTranscript, tavusAvatar]
  );

  /**
   * Speak the introduction for the given preset, once per session per
   * preset. The intro is a brief framing of OC's investment philosophy
   * and what the chosen track will demonstrate (source: the FSC
   * questionnaire — see narration.ts). Renders as the first item in
   * the funnel rail.
   */
  const narrateIntroFor = useCallback(
    async (p: Preset): Promise<void> => {
      // Synchronous queue guard — keeps a re-rendered effect from
      // dispatching a second echo while the first is still in flight.
      if (introQueuedForPresetRef.current === p) return;
      if (introSpokenForPreset === p) return;
      introQueuedForPresetRef.current = p;
      await narrate(
        p === "methodology"
          ? describeMethodologyIntro()
          : describeQuestionnaireIntro()
      );
      // Audio (plus inter-narration pause) has fully completed —
      // flip the rail's Introduction step to checked.
      setIntroSpokenForPreset(p);
    },
    [introSpokenForPreset, narrate]
  );

  // Auto-fire the intro once the avatar is ready AND the snapshot has
  // loaded AND the user is in screening mode. The synchronous
  // `introQueuedForPresetRef` guard prevents a re-rendered effect
  // from dispatching a duplicate echo while the first is still in
  // flight; the state guard catches the case where audio has
  // finished and visual is updated.
  useEffect(() => {
    if (!isStarted) return;
    if (tavusStatus !== "ready") return;
    if (mode !== "screening") return;
    if (introQueuedForPresetRef.current === preset) return;
    if (introSpokenForPreset === preset) return;
    queueMicrotask(() => {
      void narrateIntroFor(preset);
    });
  }, [isStarted, tavusStatus, mode, preset, introSpokenForPreset, narrateIntroFor]);

  // Universe narration fires once after the intro audio for the
  // active preset has fully completed. Synchronous queued ref
  // prevents duplicate dispatch; `universeSpoken` state flips after
  // the narrate() promise resolves so the rail's Universe step
  // doesn't visually flip to "checked" until Pep finishes saying it.
  const universeStage = screener.stages[0];
  useEffect(() => {
    if (universeQueuedRef.current) return;
    if (universeSpoken) return;
    if (!isStarted) return;
    if (tavusStatus !== "ready") return;
    if (mode !== "screening") return;
    if (introSpokenForPreset !== preset) return;
    if (!universeStage) return;
    universeQueuedRef.current = true;
    const count = universeStage.count;
    queueMicrotask(async () => {
      await narrate(describeUniverseStage(count));
      setUniverseSpoken(true);
    });
  }, [
    isStarted,
    tavusStatus,
    mode,
    preset,
    introSpokenForPreset,
    universeStage,
    universeSpoken,
    narrate,
  ]);

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

  /**
   * Preset toggle handler with two paths:
   *
   * - **First-time selection** (no funnel progress yet) → narrate the
   *   full preset intro so the audience hears the philosophy framing.
   *   User then clicks Next → for each filter.
   * - **Mid-session switch** (funnel has run filters) → reset the
   *   funnel, narrate a brief transition cue, and let the user click
   *   Next → through the new preset's filters. Both presets are
   *   step-by-step — the audience sees each filter's effect.
   *
   * Mark intro AND universe as "spoken" for the new preset on
   * mid-session switch so the auto-fire effects stay silent and the
   * rail correctly shows them as already-completed (the brief
   * transition narration substitutes for them).
   */
  const switchPreset = useCallback(
    (newPreset: Preset) => {
      if (newPreset === preset) return;
      const hasProgress = screener.stages.length > 1;
      setPreset(newPreset);

      if (!hasProgress) {
        void narrateIntroFor(newPreset);
        return;
      }

      // Mid-session switch: reset, mark intro/universe done sync so
      // the auto-fire effects stay silent, then narrate the brief
      // transition. User clicks Next → through the new preset's
      // filters from there.
      screener.reset();
      introQueuedForPresetRef.current = newPreset;
      setIntroSpokenForPreset(newPreset);
      universeQueuedRef.current = true;
      setUniverseSpoken(true);

      narrate(
        newPreset === "methodology"
          ? describeMethodologyTransition()
          : describeQuestionnaireTransition()
      );
    },
    [preset, screener, narrate, narrateIntroFor]
  );

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
          // Switch to methodology and let the user step through it.
          // First-time path narrates the full intro; mid-session path
          // narrates the brief transition. Either way, no auto-run —
          // the user clicks Next → for each filter.
          switchPreset("methodology");
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
        case "info_fund_field": {
          // In fund_qa mode, fall back to the active fund when the
          // utterance didn't name one (e.g. "what are the fees" with a
          // fund pre-selected). In screening mode the user must name
          // the fund — otherwise we can't disambiguate from screening
          // questions.
          const fundId =
            intent.fundId ?? (mode === "fund_qa" ? activeFund : undefined);
          if (!fundId) {
            narrate(describeFundFactMissingFund());
            break;
          }
          if (!intent.category) {
            narrate(describeFundFactMissingCategory(getFundDisplayName(fundId)));
            break;
          }
          const answer = getFundAnswer(fundId, intent.category);
          narrate(describeFundFact(getFundDisplayName(fundId), answer));
          break;
        }
        case "restart":
          screener.reset();
          setIntroSpokenForPreset(null);
          introQueuedForPresetRef.current = null;
          setUniverseSpoken(false);
          universeQueuedRef.current = false;
          narrate(describeRestart());
          break;
        case "fallback":
        default:
          narrate(describeFallback());
          break;
      }
    },
    [
      screener,
      nextFilter,
      narrate,
      applyAndNarrate,
      switchPreset,
      mode,
      activeFund,
    ]
  );

  /**
   * Click-driven path for the fund-info panel — bypasses the /process
   * route since we already know the fundId + category from the click.
   * Logs a synthetic user line into the transcript so the chat panel
   * shows the question that produced the answer.
   *
   * Gated on `isThinking` (which `handleIntent` toggles via the
   * surrounding setIsThinking) so rapid double-clicks can't overlap
   * echoes — the buttons render `disabled={isThinking}` to mirror.
   */
  const askAboutCategory = useCallback(
    async (fundId: FundId, category: CategoryId) => {
      if (isThinking) return;
      setIsThinking(true);
      try {
        const fundName = getFundDisplayName(fundId);
        const label = getCategoryLabel(category).toLowerCase();
        appendTranscript("user", `Tell me about the ${fundName}'s ${label}.`);
        await handleIntent({ kind: "info_fund_field", fundId, category });
      } finally {
        setIsThinking(false);
      }
    },
    [isThinking, appendTranscript, handleIntent]
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
                <span className="font-medium">Mode</span>
                <div className="flex gap-1 rounded-md bg-white/5 p-0.5">
                  {(["screening", "fund_qa"] as Mode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={`rounded px-2 py-1 text-xs ${
                        mode === m
                          ? "bg-white text-[var(--oc-navy)]"
                          : "text-white/70 hover:text-white"
                      }`}
                    >
                      {m === "screening" ? "Screening" : "Fund Q&A"}
                    </button>
                  ))}
                </div>
              </div>

              {mode === "screening" ? (
                <>
                  <div className="flex items-center justify-between text-xs text-white/60">
                    <span className="font-medium">Preset</span>
                    <div className="flex gap-1 rounded-md bg-white/5 p-0.5">
                      {(["questionnaire", "methodology"] as Preset[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => switchPreset(p)}
                          disabled={isBusy}
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

                  <FunnelRail
                    stages={screener.stages}
                    pending={pending}
                    intro={{ label: "Introduction", spoken: introSpokenForPreset === preset }}
                    universeSpoken={universeSpoken}
                  />
                </>
              ) : (
                <div className="flex flex-col gap-2 text-xs text-white/60">
                  <span className="font-medium">Fund</span>
                  <div className="flex flex-col gap-1 rounded-md bg-white/5 p-0.5">
                    {FUNDS.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setActiveFund(f.id)}
                        className={`rounded px-2 py-1.5 text-left text-xs ${
                          activeFund === f.id
                            ? "bg-white text-[var(--oc-navy)]"
                            : "text-white/70 hover:text-white"
                        }`}
                      >
                        {f.shortName}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {mode === "screening" ? null : <div className="flex-1" />}

              <div className="flex gap-2">
                {mode === "screening" ? (
                  <>
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
                        setIntroSpokenForPreset(null);
                        introQueuedForPresetRef.current = null;
                        setUniverseSpoken(false);
                        universeQueuedRef.current = false;
                        narrate(describeRestart());
                      }}
                      disabled={isBusy || screener.stages.length <= 1}
                      variant="ghost"
                      className="text-white/70 hover:bg-white/5 hover:text-white"
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <div className="flex-1 text-xs text-white/50">
                    Pick a fund, then ask Pep — or click a category in the panel.
                  </div>
                )}
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

        {/* Right pane: header + mode-specific body + conversation pane.
            ConversationPane is rendered ONCE per breakpoint at the
            bottom of the section so the transcript array isn't iterated
            twice on every update. */}
        <section className="flex flex-1 min-h-0 flex-col">
          {!isStarted ? (
            <div className="flex flex-1 items-center justify-center text-sm text-white/40">
              Press <span className="mx-1 font-medium text-white/70">Start Screening</span> to load the snapshot.
            </div>
          ) : (
            <>
              {mode === "screening" ? (
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
              ) : (
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2 text-xs text-white/60">
                  <span>
                    Active fund:{" "}
                    <span className="text-white">{getFundDisplayName(activeFund)}</span>
                  </span>
                  <span className="text-white/40">
                    Click a category to ask Pep, or use voice.
                  </span>
                </div>
              )}
              <div className="flex flex-1 min-h-0">
                {mode === "screening" ? (
                  <StocksTable
                    rows={screener.currentRows}
                    onTickerClick={setSelectedTicker}
                    selectedTicker={selectedTicker}
                    className="flex-1 min-h-0 flex flex-col"
                  />
                ) : (
                  <div className="flex-1 min-h-0 overflow-auto p-4">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {CATEGORY_IDS.map((cat) => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => void askAboutCategory(activeFund, cat)}
                          disabled={isThinking}
                          className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-left text-sm text-white/85 transition hover:border-white/20 hover:bg-white/10 hover:text-white disabled:opacity-50"
                        >
                          {getCategoryLabel(cat)}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <ConversationPane
                  transcript={transcript}
                  isThinking={isThinking}
                  onAsk={ask}
                  className="hidden lg:flex flex-col w-[26rem] border-l border-white/10"
                />
              </div>
              {mode === "screening" && selectedTicker ? (
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
          )}
        </section>
      </main>
    </div>
  );
}
