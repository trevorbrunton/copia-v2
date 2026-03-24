"use client";

import { useRef, useEffect } from "react";
import type { ChatMessage, DemoStatus } from "@/src/demo/types";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ChatPanelProps {
  messages: ChatMessage[];
  status: DemoStatus;
}

function TypingIndicator() {
  return (
    <div className="self-start flex items-center gap-1.5 rounded-xl bg-white/10 px-4 py-3">
      <span className="h-2 w-2 rounded-full bg-white/40 animate-bounce [animation-delay:0ms]" />
      <span className="h-2 w-2 rounded-full bg-white/40 animate-bounce [animation-delay:150ms]" />
      <span className="h-2 w-2 rounded-full bg-white/40 animate-bounce [animation-delay:300ms]" />
    </div>
  );
}

export function ChatPanel({ messages, status }: ChatPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, status]);

  if (messages.length === 0 && status !== "processing") {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-white/40">
        Ask a question about the OC Mid-Cap Fund
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="flex flex-col gap-3 p-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
              msg.role === "user"
                ? "self-end bg-white text-[var(--oc-navy)]"
                : "self-start bg-white/10 text-white"
            }`}
          >
            {msg.content}
          </div>
        ))}
        {status === "processing" && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
    </ScrollArea>
  );
}
