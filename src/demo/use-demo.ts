"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConversation } from "@11labs/react";
import {
  USE_VIDEO_AVATAR,
  USE_LIVE_AVATAR,
  USE_TAVUS_AVATAR,
  USE_HAIKU_MODE,
} from "./config";
import { PREGENERATED } from "./classifier";
import { useAvatar } from "./use-avatar";
import { useTavusAvatar } from "./use-tavus-avatar";
import { useVoiceListener } from "./use-voice-listener";
import type { ChatMessage, DemoStatus } from "./types";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID ?? "";

/** Parse a `[category_name]` tag from an agent response, ignoring any prefix. */
function parseCategoryTag(text: string): { category: string; rest: string } | null {
  const match = text.match(/\[(\w+)\]\s*/);
  if (!match) return null;
  return { category: match[1], rest: text.slice(match.index! + match[0].length) };
}

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

/**
 * Fetch a PCM file and return as base64 string (for LiveAvatar mode).
 * Uses chunked conversion to avoid O(n²) string concatenation.
 */
async function fetchPcmAsBase64(pcmUrl: string): Promise<string> {
  const res = await fetch(pcmUrl);
  if (!res.ok) throw new Error(`Failed to fetch PCM: ${res.status}`);
  const buffer = await res.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 8192;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
    chunks.push(String.fromCharCode(...chunk));
  }
  return btoa(chunks.join(""));
}

export function useDemo() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPlayingCached, setIsPlayingCached] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [currentVideoSrc, setCurrentVideoSrc] = useState<string | null>(null);
  const [micMuted, setMicMuted] = useState(true);
  const isConnectingRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pcmCacheRef = useRef<Record<string, string>>({});

  // Epoch counter — incremented each time busy mode starts.
  const epochRef = useRef(0);
  const messageEpochRef = useRef(0);

  // When true, the system is playing a response — ignore all input.
  const busyRef = useRef(false);
  // Resolves when a video finishes playing.
  const videoEndedResolveRef = useRef<(() => void) | null>(null);
  // Ref to track ElevenLabs agent connection status.
  const isConnectedRef = useRef(false);

  // Avatar hooks — always called for hook order stability
  const avatar = useAvatar();
  const tavusAvatar = useTavusAvatar();

  // ─── Haiku mode: continuous voice listener ────────────────────────

  // Ref for voiceListener controls — avoids stale closure in handleUtterance
  const voiceListenerRef = useRef<{ pause: () => void; resume: () => void }>({
    pause: () => {},
    resume: () => {},
  });

  /**
   * Called by the voice listener when the user finishes an utterance.
   * Transcribes via ElevenLabs STT → matches via Bedrock Haiku → plays response.
   */
  const handleUtterance = useCallback(
    async (pcm: ArrayBuffer, sampleRate: number) => {
      if (busyRef.current) return;

      // Pause listener immediately to prevent overlapping utterances
      busyRef.current = true;
      voiceListenerRef.current.pause();
      setIsProcessing(true);

      try {
        // Step 1: Transcribe via ElevenLabs STT
        const formData = new FormData();
        formData.append(
          "audio",
          new Blob([pcm], { type: "application/octet-stream" }),
        );
        formData.append("sampleRate", String(sampleRate));

        const transcribeRes = await fetch("/api/v1/demo/transcribe", {
          method: "POST",
          body: formData,
          signal: AbortSignal.timeout(30_000),
        });

        if (!transcribeRes.ok) {
          throw new Error(`Transcribe error: ${transcribeRes.status}`);
        }

        const { text: userText } = await transcribeRes.json();

        if (!userText) {
          // No speech detected — resume listening
          setIsProcessing(false);
          busyRef.current = false;
          voiceListenerRef.current.resume();
          return;
        }

        // Show user's transcribed speech in chat
        setMessages((prev) => [...prev, createMessage("user", userText)]);

        // Step 2: Match question via Bedrock Haiku
        const matchRes = await fetch("/api/v1/demo/match", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: userText }),
          signal: AbortSignal.timeout(15_000),
        });

        if (!matchRes.ok) {
          throw new Error(`Match error: ${matchRes.status}`);
        }

        const result: {
          category: string;
          answerText: string;
          audioUrl: string;
          pcmUrl: string;
          videoUrl: string;
        } = await matchRes.json();

        const cached = {
          audioUrl: result.audioUrl,
          pcmUrl: result.pcmUrl,
          videoUrl: result.videoUrl,
          text: result.answerText,
        };

        // Show response text in chat
        setMessages((prev) => [
          ...prev,
          createMessage("assistant", cached.text),
        ]);
        setIsProcessing(false);

        // Step 3: Play matched video/audio, then resume listening
        await playResponseRef.current(cached);
        busyRef.current = false;
        voiceListenerRef.current.resume();
      } catch (err) {
        setIsProcessing(false);
        busyRef.current = false;
        voiceListenerRef.current.resume();
        setError(
          err instanceof Error ? err.message : "Failed to process question",
        );
      }
    },
    [],
  );

  const voiceListener = useVoiceListener({ onUtterance: handleUtterance });
  voiceListenerRef.current = voiceListener;

  // ─── ElevenLabs agent (non-haiku modes) ───────────────────────────

  const conversation = useConversation({
    micMuted,
    onConnect: () => {
      isConnectedRef.current = true;
    },
    onDisconnect: () => {
      isConnectedRef.current = false;
    },
    onError: (err: string | Error) => {
      if (USE_HAIKU_MODE) return;
      const msg = typeof err === "string" ? err : err.message;
      setError(msg);
      setIsProcessing(false);
    },
    onMessage: (message: { source: string; message: string }) => {
      if (USE_HAIKU_MODE) return;
      if (busyRef.current) return;

      if (messageEpochRef.current !== epochRef.current) {
        messageEpochRef.current = epochRef.current;
        return;
      }

      if (message.source === "user") {
        setMessages((prev) => [...prev, createMessage("user", message.message)]);
        setIsProcessing(true);
      }

      if (message.source === "ai") {
        const parsed = parseCategoryTag(message.message);
        const cached = parsed ? PREGENERATED[parsed.category] : null;

        if (cached) {
          busyRef.current = true;
          epochRef.current += 1;
          setMicMuted(true);
          conversation.setVolume({ volume: 0 });
          setMessages((prev) => [
            ...prev,
            createMessage("assistant", cached.text),
          ]);
          setIsProcessing(false);
          playResponseRef.current(cached).finally(() => {
            busyRef.current = false;
            messageEpochRef.current = epochRef.current;
            setMicMuted(false);
            conversation.setVolume({ volume: 1 });
            try {
              conversation.sendContextualUpdate(
                "You just finished answering. Wait silently for the user's next question. Do not prompt or ask if they are still there."
              );
            } catch {
              // Safe to ignore
            }
          });
        } else {
          setMessages((prev) => [
            ...prev,
            createMessage("assistant", message.message),
          ]);
          setIsProcessing(false);
        }
      }
    },
  });

  const conversationRef = useRef(conversation);
  conversationRef.current = conversation;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (USE_HAIKU_MODE) {
        voiceListener.stop();
      } else if (isConnectedRef.current) {
        conversationRef.current.endSession().catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const playPcmOnAvatar = useCallback(
    async (pcmUrl: string) => {
      let base64 = pcmCacheRef.current[pcmUrl];
      if (!base64) {
        base64 = await fetchPcmAsBase64(pcmUrl);
        pcmCacheRef.current[pcmUrl] = base64;
      }
      avatar.speakAudio(base64);
    },
    [avatar]
  );

  const playTextOnTavus = useCallback(
    (text: string): Promise<void> => {
      return new Promise((resolve) => {
        tavusAvatar.echo(text);
        const estimatedDuration = Math.max(3000, text.length * 60);
        setTimeout(resolve, estimatedDuration);
      });
    },
    [tavusAvatar]
  );

  const playResponse = useCallback(
    async (cached: { audioUrl: string; pcmUrl: string; videoUrl: string; text: string }) => {
      if (USE_VIDEO_AVATAR || USE_HAIKU_MODE) {
        let hasVideo = false;
        try {
          const headRes = await fetch(cached.videoUrl, { method: "HEAD" });
          const contentType = headRes.headers.get("content-type") ?? "";
          hasVideo = headRes.ok && contentType.startsWith("video/");
        } catch {
          // No video available
        }

        if (hasVideo) {
          await new Promise<void>((resolve) => {
            videoEndedResolveRef.current = resolve;
            setCurrentVideoSrc(cached.videoUrl);
          });
        } else {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else if (USE_TAVUS_AVATAR && tavusAvatar.status === "ready") {
        try {
          await playTextOnTavus(cached.text);
        } catch {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else if (USE_LIVE_AVATAR && avatar.status === "ready") {
        try {
          await playPcmOnAvatar(cached.pcmUrl);
        } catch {
          await playCachedAudio(cached.audioUrl).catch(() => {});
        }
      } else {
        const conv = conversationRef.current;
        if (isConnectedRef.current) conv.setVolume({ volume: 0 });
        try {
          await playCachedAudio(cached.audioUrl);
        } catch {
          // Text already shown
        }
        if (isConnectedRef.current) conv.setVolume({ volume: 1 });
      }
    },
    [avatar, tavusAvatar, playCachedAudio, playPcmOnAvatar, playTextOnTavus]
  );

  const playResponseRef = useRef(playResponse);
  playResponseRef.current = playResponse;

  const handleVideoEnded = useCallback(() => {
    setCurrentVideoSrc(null);
    setIsPlayingCached(false);
    if (videoEndedResolveRef.current) {
      videoEndedResolveRef.current();
      videoEndedResolveRef.current = null;
    }
  }, []);

  // ─── Connect ──────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setError(null);
    setHasStarted(true);
    busyRef.current = true;
    epochRef.current += 1;
    setMicMuted(true);

    try {
      if (!USE_HAIKU_MODE) {
        if (USE_TAVUS_AVATAR) {
          const avatarReady = await tavusAvatar.initAvatar();
          if (!avatarReady) {
            console.warn("Tavus avatar failed to connect — running in audio-only mode");
          }
        } else if (USE_LIVE_AVATAR) {
          const avatarReady = await avatar.initAvatar();
          if (!avatarReady) {
            console.warn("Avatar failed to connect — running in audio-only mode");
          }
        }
      }

      // Play greeting
      const greeting = PREGENERATED.greeting;
      setMessages((prev) => [
        ...prev,
        createMessage("assistant", greeting.text),
      ]);

      const greetingPromise = playResponse(greeting);

      // In haiku mode, skip ElevenLabs agent — start voice listener instead
      const setupPromise = USE_HAIKU_MODE
        ? Promise.resolve()
        : (AGENT_ID
          ? conversation.startSession({
              agentId: AGENT_ID,
              connectionType: "webrtc",
            }).then(() => {
              conversation.setVolume({ volume: 0 });
            }).catch((err) => {
              console.warn("Agent connection failed:", err);
            })
          : Promise.resolve());

      await Promise.all([greetingPromise, setupPromise]);

      // Greeting done — ready for interaction
      busyRef.current = false;
      messageEpochRef.current = epochRef.current;

      if (USE_HAIKU_MODE) {
        // Start continuous voice listener
        await voiceListener.start();
      } else {
        setMicMuted(false);
        if (isConnectedRef.current) {
          conversation.setVolume({ volume: 1 });
          try {
            conversation.sendContextualUpdate(
              "You just greeted the user. Wait silently for their first question. Do not prompt or ask if they are still there."
            );
          } catch {
            // Safe to ignore
          }
        }
      }
    } catch (err) {
      busyRef.current = false;
      const msg = err instanceof Error ? err.message : "Failed to connect";
      setError(msg);
    } finally {
      isConnectingRef.current = false;
    }
  }, [conversation, playResponse, avatar, tavusAvatar, voiceListener]);

  // ─── Status ───────────────────────────────────────────────────────

  const demoStatus: DemoStatus = isProcessing
    ? "processing"
    : isPlayingCached ||
        currentVideoSrc !== null ||
        avatar.status === "speaking" ||
        tavusAvatar.status === "speaking"
      ? "speaking"
      : voiceListener.isListening && !busyRef.current
        ? "listening"
        : "ready";

  return {
    status: demoStatus,
    messages,
    error: error || avatar.error || tavusAvatar.error,
    connect,
    isConnected: hasStarted,
    avatarStream: USE_TAVUS_AVATAR
      ? tavusAvatar.mediaStream
      : avatar.mediaStream,
    currentVideoSrc,
    handleVideoEnded,
    // Haiku mode — expose listening/speaking state for UI
    isListening: voiceListener.isListening,
    isSpeaking: voiceListener.isSpeaking,
  };
}
