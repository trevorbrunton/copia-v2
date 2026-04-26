"use client";

import { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

/**
 * Modal that captures an email address for the demo "email me the
 * list" workflow. Email sending is **not** implemented — `onSend` just
 * fires the parent's stub (logs + narrates) and the dialog closes.
 *
 * Kept self-contained: own input state, basic validation, autofocus on
 * open. Parent owns open/close via `open` + `onOpenChange`.
 */
interface EmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shortlistCount: number;
  onSend: (email: string) => void;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function EmailDialog({ open, onOpenChange, shortlistCount, onSend }: EmailDialogProps) {
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on open so a re-trigger after Cancel starts fresh. State
  // resets are deferred via queueMicrotask to satisfy React 19's
  // `react-hooks/set-state-in-effect` rule (effect bodies shouldn't
  // synchronously trigger renders). Microtask ordering is enough — it
  // runs before paint, so the user never sees stale input briefly.
  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      setEmail("");
      setTouched(false);
    });
    // Radix focuses the close button by default; nudge focus to the
    // input on the next paint so the user can start typing immediately.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  const isValid = EMAIL_PATTERN.test(email.trim());
  const showError = touched && !isValid && email.length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!isValid) return;
    onSend(email.trim());
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email the shortlist
          </DialogTitle>
          <DialogDescription>
            We&apos;ll send you the {shortlistCount.toLocaleString()} stocks
            currently in your shortlist. (Demo workflow — no email actually
            leaves the system.)
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            ref={inputRef}
            type="email"
            inputMode="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onBlur={() => setTouched(true)}
            aria-invalid={showError}
            aria-describedby={showError ? "email-error" : undefined}
          />
          {showError ? (
            <p id="email-error" className="text-xs text-destructive">
              That doesn&apos;t look like a valid email address.
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
