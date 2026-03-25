"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Continuous voice listener with amplitude-based Voice Activity Detection.
 *
 * Captures PCM Int16 audio via AudioContext + ScriptProcessorNode.
 * Detects speech start/end using amplitude thresholds and silence timeout.
 * When the user stops speaking, calls `onUtterance` with the audio buffer.
 *
 * Flow:
 *   1. start() → opens mic, begins monitoring audio levels
 *   2. User speaks → amplitude exceeds threshold → starts buffering
 *   3. User pauses → silence timeout → fires onUtterance(pcm, sampleRate)
 *   4. Repeat from step 2
 *   5. pause()/resume() — suspends listening during response playback
 *   6. stop() — closes mic and cleans up
 */

/** VAD tuning defaults */
const DEFAULT_SPEECH_THRESHOLD = 0.015; // amplitude above this = speech
const DEFAULT_SILENCE_TIMEOUT_MS = 1500; // silence duration to end an utterance
const DEFAULT_MIN_SPEECH_DURATION_MS = 400; // ignore utterances shorter than this

interface UseVoiceListenerOptions {
  onUtterance: (pcm: ArrayBuffer, sampleRate: number) => void;
  /** Amplitude threshold to detect speech (0.0–1.0). Default: 0.015 */
  speechThreshold?: number;
  /** Milliseconds of silence before ending an utterance. Default: 1500 */
  silenceTimeoutMs?: number;
  /** Minimum utterance duration in ms (filters noise). Default: 400 */
  minSpeechDurationMs?: number;
}

export function useVoiceListener({
  onUtterance,
  speechThreshold = DEFAULT_SPEECH_THRESHOLD,
  silenceTimeoutMs = DEFAULT_SILENCE_TIMEOUT_MS,
  minSpeechDurationMs = DEFAULT_MIN_SPEECH_DURATION_MS,
}: UseVoiceListenerOptions) {
  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);

  const chunksRef = useRef<Int16Array[]>([]);
  const isSpeakingRef = useRef(false);
  const speechStartTimeRef = useRef(0);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef = useRef(false);
  const sampleRateRef = useRef(48000);
  const onUtteranceRef = useRef(onUtterance);
  onUtteranceRef.current = onUtterance;

  /** Flush the current speech buffer and fire onUtterance. */
  const flushUtterance = useCallback(() => {
    const chunks = chunksRef.current;
    if (chunks.length === 0) return;

    const speechDuration = Date.now() - speechStartTimeRef.current;
    if (speechDuration < minSpeechDurationMs) {
      // Too short — likely noise, discard
      chunksRef.current = [];
      return;
    }

    // Combine chunks into a single buffer
    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Int16Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    chunksRef.current = [];

    onUtteranceRef.current(combined.buffer, sampleRateRef.current);
  }, []);

  /** Open mic and start continuous listening with VAD. */
  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });

    const audioContext = new AudioContext();
    sampleRateRef.current = audioContext.sampleRate;

    const source = audioContext.createMediaStreamSource(stream);
    const processor = audioContext.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (pausedRef.current) return;

      const float32 = e.inputBuffer.getChannelData(0);

      // Calculate RMS amplitude
      let sum = 0;
      for (let i = 0; i < float32.length; i++) {
        sum += float32[i] * float32[i];
      }
      const rms = Math.sqrt(sum / float32.length);

      if (rms > speechThreshold) {
        // Speech detected
        if (!isSpeakingRef.current) {
          isSpeakingRef.current = true;
          speechStartTimeRef.current = Date.now();
          setIsSpeaking(true);
          chunksRef.current = [];
        }

        // Clear any pending silence timer
        if (silenceTimerRef.current) {
          clearTimeout(silenceTimerRef.current);
          silenceTimerRef.current = null;
        }

        // Buffer the audio as Int16
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        chunksRef.current.push(int16);
      } else if (isSpeakingRef.current) {
        // Still buffering during silence (captures trailing audio)
        const int16 = new Int16Array(float32.length);
        for (let i = 0; i < float32.length; i++) {
          const s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        chunksRef.current.push(int16);

        // Start silence timer if not already running
        if (!silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            silenceTimerRef.current = null;
            flushUtterance();
          }, silenceTimeoutMs);
        }
      }
    };

    source.connect(processor);
    processor.connect(audioContext.destination);

    audioContextRef.current = audioContext;
    streamRef.current = stream;
    sourceRef.current = source;
    processorRef.current = processor;
    pausedRef.current = false;
    setIsListening(true);
  }, [flushUtterance]);

  /** Temporarily pause listening (e.g. during response playback). */
  const pause = useCallback(() => {
    pausedRef.current = true;
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (isSpeakingRef.current) {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      chunksRef.current = [];
    }
  }, []);

  /** Resume listening after a pause. */
  const resume = useCallback(() => {
    pausedRef.current = false;
  }, []);

  /** Stop listening entirely and release the microphone. */
  const stop = useCallback(() => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (processorRef.current && sourceRef.current) {
      sourceRef.current.disconnect();
      processorRef.current.disconnect();
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    processorRef.current = null;
    sourceRef.current = null;
    audioContextRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    isSpeakingRef.current = false;
    setIsListening(false);
    setIsSpeaking(false);
  }, []);

  return { isListening, isSpeaking, start, stop, pause, resume };
}
