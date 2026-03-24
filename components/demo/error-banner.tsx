"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface ErrorBannerProps {
  message: string | null;
}

export function ErrorBanner({ message }: ErrorBannerProps) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);

  const visible = !!message && message !== dismissedMessage;
  if (!visible) return null;

  return (
    <div className="mx-4 mt-3 flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2">
      <p className="flex-1 text-xs text-red-300">{message}</p>
      <button
        onClick={() => setDismissedMessage(message)}
        className="shrink-0 text-red-300/60 hover:text-red-300 transition-colors"
        aria-label="Dismiss error"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
