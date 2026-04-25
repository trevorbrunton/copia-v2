"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { USE_TAVUS_AVATAR, USE_HAIKU_MODE } from "./config";
import { PREGENERATED } from "./classifier";
import { useTavusAvatar } from "./use-tavus-avatar";
import { useVoiceListener } from "./use-voice-listener";
import type { ChatMessage, DemoStatus } from "./types";

function createMessage(
  role: "user" | "assistant",
  content: string
): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: Date.now(),
  };
}

interface CachedResponse {
  audioUrl: string;
  videoUrl: string;
  text: string;
}

export function useDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingCached, setIsPlayingCached] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isInitialising, setIsInitialising] = useState(false);
  const [currentVideoSrc, setCurrentVideoSrc] = useState<string | null>(null);
  const isConnectingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // When true, the system is playing a response — ignore all input.
  // busyRef for synchronous checks in callbacks; isBusy for reactive UI (status badge).
  const busyRef = useRef(false);
  const [isBusy, setIsBusy] = useState(false);
  const setBusy = useCallback((val: boolean) => {
    busyRef.current = val;
    setIsBusy(val);
  }, []);
  // Resolves when a response video finishes playing (haiku mode).
  const videoEndedResolveRef = useRef<(() => void) | null>(null);

  const tavusAvatar = useTavusAvatar();

  // Track avatar readiness via ref — React state may not have flushed
  // when playResponse runs immediately after initAvatar resolves.
  const avatarReadyRef = useRef(false);

  // ─── Playback helpers ─────────────────────────────────────────────

  const playCachedAudio = useCallback((audioUrl: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      audio.onended = () => {
        setIsPlayingCached(false);
        audioRef.current = null;
        resolve();
      };
      audio.onerror = () => {
        setIsPlayingCached(false);
        audioRef.current = null;
        reject(new Error("Audio playback failed"));
      };
      setIsPlayingCached(true);
      audio.play().catch(reject);
    });
  }, []);

  const playResponse = useCallback(
    async (cached: CachedResponse) => {
      if (USE_HAIKU_MODE) {
        // Prefer pre-generated MP4 with lip-synced audio; fall back to bare audio.
        let hasVideo = false;
        if (cached.videoUrl) {
          try {
            const headRes = await fetch(cached.videoUrl, { method: "HEAD" });
            const contentType = headRes.headers.get("content-type") ?? "";
            hasVideo = headRes.ok && contentType.startsWith("video/");
          } catch {
            // No video available
          }
        }

        if (hasVideo) {
          await new Promise<void>((resolve) => {
            videoEndedResolveRef.current = resolve;
            setCurrentVideoSrc(cached.videoUrl);
          });
        } else if (cached.audioUrl) {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
        return;
      }

      if (USE_TAVUS_AVATAR && avatarReadyRef.current) {
        try {
          await tavusAvatar.echo(cached.text);
        } catch {
          if (cached.audioUrl) await playCachedAudio(cached.audioUrl).catch(() => {});
        }
        return;
      }

      if (cached.audioUrl) await playCachedAudio(cached.audioUrl).catch(() => {});
    },
    [playCachedAudio, tavusAvatar]
  );

  /**
   * Called by the voice listener when the user finishes an utterance.
   * Transcribes via ElevenLabs STT → matches via Anthropic Haiku → plays response.
   */
  const handleUtterance = useCallback(
    async (pcm: ArrayBuffer, sampleRate: number) => {
      if (busyRef.current) return;

      setBusy(true);
      setIsProcessing(true);

      try {
        const formData = new FormData();
        formData.append(
          "audio",
          new Blob([pcm], { type: "application/octet-stream" }),
        );
        formData.append("sampleRate", String(sampleRate));

        const processRes = await fetch("/api/v1/demo/process", {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(45_000),
        });

        if (!processRes.ok) {
          throw new Error(`Process error: ${processRes.status}`);
        }

        const result: {
          text: string;
          category?: string;
          answerText?: string;
          audioUrl?: string;
          videoUrl?: string;
        } = await processRes.json();

        if (!result.text) {
          setIsProcessing(false);
          setBusy(false);
          return;
        }

        setMessages((prev) => [...prev, createMessage("user", result.text)]);

        const cached: CachedResponse = {
          audioUrl: result.audioUrl ?? "",
          videoUrl: result.videoUrl ?? "",
          text: result.answerText ?? "",
        };

        setMessages((prev) => [
          ...prev,
          createMessage("assistant", cached.text),
        ]);
        setIsProcessing(false);

        await playResponse(cached);
        setBusy(false);
      } catch (err) {
        setIsProcessing(false);
        setBusy(false);
        setError(
          err instanceof Error ? err.message : "Failed to process question",
        );
      }
    },
    [setBusy, playResponse],
  );

  const voiceListener = useVoiceListener({ onUtterance: handleUtterance });

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      voiceListener.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleVideoEnded = useCallback(() => {
    setCurrentVideoSrc(null);
    setIsPlayingCached(false);
    if (videoEndedResolveRef.current) {
      videoEndedResolveRef.current();
      videoEndedResolveRef.current = null;
    }
  }, []);

  // ─── Connect ──────────────────────────────────────────────────────

  const connect = useCallback(async (personaId?: string) => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setError(null);
    setHasStarted(true);
    setBusy(true);

    try {
      // Pre-warm mic permission so the audio graph is settled before any
      // WebRTC audio flows — avoids a brief audio glitch.
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        micStream.getTracks().forEach((t) => t.stop());
      } catch (err) {
        console.warn("[demo:connect] Mic permission denied:", err);
      }

      setIsInitialising(true);
      if (USE_TAVUS_AVATAR) {
        avatarReadyRef.current = await tavusAvatar.initAvatar(personaId);
        if (!avatarReadyRef.current) {
          console.warn("Tavus avatar failed to connect — running in audio-only mode");
        }
      }
      setIsInitialising(false);

      // Yield so React flushes state and useEffects wire the stream to the
      // <video> element before the greeting plays.
      if (USE_TAVUS_AVATAR && avatarReadyRef.current) {
        await new Promise((r) => setTimeout(r, 200));
      }

      const greeting = PREGENERATED.greeting;
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", greeting.text),
      ]);

      await playResponse({
        audioUrl: greeting.audioUrl ?? "",
        videoUrl: greeting.videoUrl ?? "",
        text: greeting.text,
      });

      setBusy(false);

      await voiceListener.start();
    } catch (err) {
      setBusy(false);
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg);
    } finally {
      isConnectingRef.current = false;
    }
  }, [playResponse, tavusAvatar, voiceListener, setBusy]);

  // ─── Disconnect ──────────────────────────────────────────────────

  const disconnect = useCallback(async () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    voiceListener.stop();

    if (USE_TAVUS_AVATAR && avatarReadyRef.current) {
      tavusAvatar.stopAvatar().catch(() => {});
      avatarReadyRef.current = false;
    }

    setCurrentVideoSrc(null);
    setIsPlayingCached(false);
    setIsProcessing(false);
    setIsInitialising(false);
    setBusy(false);
    setHasStarted(false);
    setMessages([]);
    setError(null);
    isConnectingRef.current = false;
  }, [voiceListener, tavusAvatar, setBusy]);

  // ─── Status ───────────────────────────────────────────────────────

  // isBusy is included in the "speaking" check to prevent a brief "Ready"
  // flash during the microtask gap between playback ending and setBusy(false).
  const demoStatus: DemoStatus = isInitialising
    ? "initialising"
    : isProcessing
    ? "processing"
    : isPlayingCached ||
        currentVideoSrc !== null ||
        tavusAvatar.status === "speaking" ||
        isBusy
      ? "speaking"
      : voiceListener.isListening
        ? "listening"
        : "ready";

  return {
    status: demoStatus,
    messages,
    error: error || tavusAvatar.error,
    connect,
    disconnect,
    isConnected: hasStarted,
    avatarStream: USE_TAVUS_AVATAR ? tavusAvatar.mediaStream : null,
    currentVideoSrc,
    handleVideoEnded,
    isListening: voiceListener.isListening,
    isSpeaking: voiceListener.isSpeaking,
  };
}
