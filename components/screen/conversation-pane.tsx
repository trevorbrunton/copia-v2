"use client";

import { useEffect, useRef, useState } from "react";
import { Send } from "lucide-react";

export type TranscriptEntry = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

interface ConversationPaneProps {
  transcript: TranscriptEntry[];
  isThinking: boolean;
  disabled?: boolean;
  placeholder?: string;
  onAsk: (text: string) => void;
  className?: string;
}

export function ConversationPane({
  transcript,
  isThinking,
  disabled,
  placeholder,
  onAsk,
  className,
}: ConversationPaneProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll on new entry.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [transcript, isThinking]);

  const submit = () => {
    const trimmed = input.trim();
    if (!trimmed || disabled || isThinking) return;
    onAsk(trimmed);
    setInput("");
  };

  return (
    <div className={className ?? "flex flex-col"}>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto border-b border-white/10 bg-[var(--oc-navy)]/40 px-4 py-3"
      >
        {transcript.length === 0 ? (
          <p className="text-sm text-white/40">
            Ask Pep a question — try{" "}
            <span className="text-white/70">
              &ldquo;show me stocks with market cap over $50m&rdquo;
            </span>{" "}
            or{" "}
            <span className="text-white/70">&ldquo;run the OC initial screen&rdquo;</span>.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {transcript.map((e) => (
              <li
                key={e.id}
                className={`flex gap-2 text-sm ${
                  e.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-3 py-2 ${
                    e.role === "user"
                      ? "bg-amber-400/10 text-amber-100"
                      : "bg-white/5 text-white/85"
                  }`}
                >
                  {e.text}
                </div>
              </li>
            ))}
            {isThinking ? (
              <li className="flex justify-start">
                <div className="rounded-lg bg-white/5 px-3 py-2 text-sm text-white/50">
                  <span className="animate-pulse">…thinking</span>
                </div>
              </li>
            ) : null}
          </ol>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-center gap-2 border-t border-white/10 px-3 py-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={disabled}
          placeholder={placeholder ?? "Ask Pep…"}
          className="flex-1 bg-transparent text-sm text-white placeholder:text-white/30 focus:outline-none"
        />
        <button
          type="submit"
          disabled={disabled || isThinking || input.trim().length === 0}
          aria-label="Send"
          className="rounded-md bg-white px-3 py-1.5 text-[var(--oc-navy)] disabled:opacity-30 hover:bg-white/90"
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </form>
    </div>
  );
}
