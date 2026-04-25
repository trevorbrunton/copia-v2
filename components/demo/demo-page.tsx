"use client";

import { useState } from "react";
import { useDemo } from "@/src/demo/use-demo";
import { PERSONA, USE_TAVUS_AVATAR } from "@/src/demo/config";
import { AvatarPanel } from "./avatar-panel";
import { ChatPanel } from "./chat-panel";
import { StatusBadge } from "./status-badge";
import { ErrorBanner } from "./error-banner";
import { Button } from "@/components/ui/button";
import { Mic, PhoneOff } from "lucide-react";

const PERSONA_OPTIONS = [
  { id: process.env.NEXT_PUBLIC_TAVUS_PERSONA_GENERIC ?? "", label: "Generic" },
  { id: process.env.NEXT_PUBLIC_TAVUS_PERSONA_CUSTOM ?? "", label: "Custom" },
].filter((p) => p.id);

export function DemoPage() {
  const {
    status,
    messages,
    error,
    connect,
    disconnect,
    isConnected,
    avatarStream,
    currentVideoSrc,
    handleVideoEnded,
  } = useDemo();

  const [selectedPersona, setSelectedPersona] = useState<string>(PERSONA_OPTIONS[0]?.id ?? "");

  return (
    <div className="flex h-svh flex-col bg-[var(--oc-dark)] overflow-hidden">
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
        <div className="w-full lg:w-1/2 xl:w-3/5 shrink-0 flex flex-col items-center">
          <AvatarPanel
            isConnected={isConnected}
            mediaStream={avatarStream}
            expectsStream={USE_TAVUS_AVATAR}
            videoSrc={currentVideoSrc}
            onVideoEnded={handleVideoEnded}
          />
          <div className="mt-3">
            {isConnected ? (
              <div className="flex items-center gap-4">
                <StatusBadge status={status} />
                <Button
                  onClick={disconnect}
                  variant="ghost"
                  className="text-red-400 hover:text-red-300 hover:bg-red-400/10 gap-2"
                >
                  <PhoneOff className="h-4 w-4" />
                  Leave Conversation
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                {USE_TAVUS_AVATAR && (
                  <div className="flex items-center gap-4">
                    {PERSONA_OPTIONS.map((p) => (
                      <label
                        key={p.id}
                        className="flex items-center gap-1.5 cursor-pointer text-xs text-white/70 hover:text-white/90"
                      >
                        <input
                          type="radio"
                          name="persona"
                          value={p.id}
                          checked={selectedPersona === p.id}
                          onChange={() => setSelectedPersona(p.id)}
                          className="accent-white"
                        />
                        {p.label}
                      </label>
                    ))}
                  </div>
                )}
                <Button
                  onClick={() =>
                    connect(USE_TAVUS_AVATAR ? selectedPersona : undefined)
                  }
                  className="bg-white text-[var(--oc-navy)] hover:bg-white/90 gap-2"
                >
                  <Mic className="h-4 w-4" />
                  Start Conversation
                </Button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-1 flex-col mt-4 lg:mt-0 rounded-2xl border border-white/10 bg-[var(--oc-navy)] overflow-hidden min-h-0">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-medium text-white">
              Ask {PERSONA.name}
            </h2>
            {isConnected && (
              <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Connected
              </span>
            )}
          </div>

          <ErrorBanner message={error} />

          <ChatPanel
            messages={messages}
            status={status}
            isConnected={isConnected}
          />
        </div>
      </main>
    </div>
  );
}
