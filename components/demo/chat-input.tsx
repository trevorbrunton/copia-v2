"use client";

import {
  useState,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DemoStatus } from "@/src/demo/types";

interface ChatInputProps {
  onSend: (message: string) => void;
  status: DemoStatus;
}

export function ChatInput({ onSend, status }: ChatInputProps) {
  const [input, setInput] = useState("");
  const isDisabled = status === "processing" || status === "speaking";

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

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-white/10 p-4"
    >
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
