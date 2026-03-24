"use client";

import {
  useState,
  useCallback,
  useRef,
  useEffect,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Mic, MicOff, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DemoStatus } from "@/src/demo/types";

interface ChatInputProps {
  onSend: (message: string) => void;
  status: DemoStatus;
}

export function ChatInput({ onSend, status }: ChatInputProps) {
  const [input, setInput] = useState("");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isDisabled = status === "processing" || status === "speaking";

  // Clean up SpeechRecognition on unmount
  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const submitInput = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || isDisabled) return;
    onSend(trimmed);
    setInput("");
  }, [input, isDisabled, onSend]);

  const handleSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      submitInput();
    },
    [submitInput]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitInput();
      }
    },
    [submitInput]
  );

  const toggleMic = useCallback(() => {
    if (
      !(
        "webkitSpeechRecognition" in window ||
        "SpeechRecognition" in window
      )
    ) {
      return;
    }

    if (isListening) {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
      setIsListening(false);
      return;
    }

    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = "en-AU";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = event.results[0]?.[0]?.transcript;
      if (transcript) {
        onSend(transcript);
      }
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onerror = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);
  }, [isListening, onSend]);

  const hasSpeechRecognition =
    typeof window !== "undefined" &&
    ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-white/10 p-4"
    >
      {hasSpeechRecognition && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={toggleMic}
          disabled={isDisabled}
          className={`shrink-0 text-white/60 hover:text-white hover:bg-white/10 ${
            isListening ? "text-red-400 hover:text-red-300" : ""
          }`}
          aria-label={isListening ? "Stop listening" : "Start voice input"}
        >
          {isListening ? (
            <MicOff className="h-5 w-5" />
          ) : (
            <Mic className="h-5 w-5" />
          )}
        </Button>
      )}

      <textarea
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Type your question…"
        disabled={isDisabled}
        rows={1}
        className="flex-1 resize-none rounded-lg border border-white/20 bg-white/5 px-4 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-white/40 disabled:opacity-50"
      />

      <Button
        type="submit"
        variant="ghost"
        size="icon"
        disabled={isDisabled || !input.trim()}
        className="shrink-0 text-white/60 hover:text-white hover:bg-white/10"
        aria-label="Send message"
      >
        <Send className="h-5 w-5" />
      </Button>
    </form>
  );
}
