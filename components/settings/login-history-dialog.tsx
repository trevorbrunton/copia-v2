"use client";

import { useState } from "react";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useLoginHistory } from "@/src/hooks/use-sessions";
import { DeviceIcon } from "./device-icon";

function formatEndReason(reason: string | null): string {
  if (!reason) return "Active";
  const labels: Record<string, string> = {
    user_logout: "Signed out",
    revoked: "Revoked",
    revoked_all: "Revoked (all sessions)",
    expired: "Expired",
    device_removed: "Device removed",
  };
  return labels[reason] || reason;
}

export function LoginHistoryDialog() {
  const [open, setOpen] = useState(false);
  const { data: history, isLoading } = useLoginHistory(50, open);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          <History className="mr-2 h-4 w-4" />
          Login History
        </Button>
      </SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Login History</SheetTitle>
          <SheetDescription>
            Recent sign-in activity on your account
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1 px-4">
          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : !history?.length ? (
            <p className="text-sm text-muted-foreground py-4">
              No login history found
            </p>
          ) : (
            <div className="space-y-3">
              {history.map((session) => (
                <div
                  key={session.id}
                  className="rounded-lg border p-3 text-sm"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <DeviceIcon type={session.device?.deviceType ?? null} />
                    <span className="font-medium">
                      {session.device?.deviceName || "Unknown device"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                    <span>
                      {new Date(session.startedAt).toLocaleString()}
                    </span>
                    <span className="text-right">
                      {session.ipAddress || "Unknown IP"}
                    </span>
                    <span>Status: {session.status}</span>
                    <span className="text-right">
                      {formatEndReason(session.endedReason)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
