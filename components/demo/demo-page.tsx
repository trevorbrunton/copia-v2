"use client";

import { useDemo } from "@/src/demo/use-demo";
import { PERSONA, USE_TAVUS_AVATAR, USE_LIVE_AVATAR } from "@/src/demo/config";
import { AvatarPanel } from "./avatar-panel";
import { ChatPanel } from "./chat-panel";
import { StatusBadge } from "./status-badge";
import { ErrorBanner } from "./error-banner";
import { Button } from "@/components/ui/button";
import { Mic, PhoneOff } from "lucide-react";

export function DemoPage() {
  const {
    status, messages, error, connect, disconnect, isConnected,
    avatarStream, attachAvatar, avatarReady,
    currentVideoSrc, handleVideoEnded,
  } = useDemo();

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
            status={status}
            mediaStream={avatarStream}
            attachAvatar={USE_LIVE_AVATAR ? attachAvatar : undefined}
            avatarReady={avatarReady}
            expectsStream={USE_TAVUS_AVATAR || USE_LIVE_AVATAR}
            videoSrc={currentVideoSrc}
            onVideoEnded={handleVideoEnded}
          />
          {isConnected && (
            <div className="mt-3">
              <StatusBadge status={status} />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col mt-4 lg:mt-0 rounded-2xl border border-white/10 bg-[var(--oc-navy)] overflow-hidden min-h-0">
          <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
            <h2 className="text-sm font-medium text-white">
              Ask {PERSONA.name}
            </h2>
            {isConnected && (
              <div className="ml-auto flex items-center gap-3">
                <span className="flex items-center gap-1.5 text-xs text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Connected
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={disconnect}
                  className="text-red-400 hover:text-red-300 hover:bg-red-400/10 gap-1.5 text-xs"
                >
                  <PhoneOff className="h-3.5 w-3.5" />
                  Leave
                </Button>
              </div>
            )}
          </div>

          <ErrorBanner message={error} />

          {!isConnected ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
              <p className="text-sm text-white/50 text-center">
                Click below to start a voice conversation with {PERSONA.name}.
                <br />
                You&apos;ll need to allow microphone access.
              </p>
              <Button
                onClick={connect}
                className="bg-white text-[var(--oc-navy)] hover:bg-white/90 gap-2"
              >
                <Mic className="h-4 w-4" />
                Start Conversation
              </Button>
            </div>
          ) : (
            <ChatPanel messages={messages} status={status} />
          )}
        </div>
      </main>
    </div>
  );
}
