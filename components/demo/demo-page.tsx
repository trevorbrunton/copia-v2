"use client";

import { useDemo } from "@/src/demo/use-demo";
import { PERSONA } from "@/src/demo/config";
import { AvatarPanel } from "./avatar-panel";
import { ChatPanel } from "./chat-panel";
import { ChatInput } from "./chat-input";
import { ErrorBanner } from "./error-banner";

export function DemoPage() {
  const { status, messages, error, sendMessage } = useDemo();

  return (
    <div className="flex min-h-svh flex-col bg-[var(--oc-dark)]">
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white font-bold text-[var(--oc-navy)] text-sm">
            OC
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white">
              {PERSONA.company}
            </h1>
            <p className="text-xs text-white/50">{PERSONA.fundName}</p>
          </div>
        </div>
      </header>

      <main className="flex flex-1 flex-col lg:flex-row gap-0 lg:gap-6 p-4 lg:p-6 overflow-hidden">
        <div className="w-full lg:w-1/2 xl:w-3/5 shrink-0">
          <AvatarPanel status={status} />
        </div>

        <div className="flex flex-1 flex-col mt-4 lg:mt-0 rounded-2xl border border-white/10 bg-[var(--oc-navy)] overflow-hidden min-h-0">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-medium text-white">
              Ask {PERSONA.name}
            </h2>
          </div>

          <ErrorBanner message={error} />
          <ChatPanel messages={messages} status={status} />
          <ChatInput onSend={sendMessage} status={status} />
        </div>
      </main>
    </div>
  );
}
