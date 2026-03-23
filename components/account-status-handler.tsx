"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/src/auth/context";

type StatusError = {
  code: "ACCOUNT_SUSPENDED" | "ACCOUNT_DELETED";
  reason?: string;
};

export function AccountStatusHandler() {
  const router = useRouter();
  const { signOut } = useAuth();
  const [statusError, setStatusError] = useState<StatusError | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    function handleStatusError(e: Event) {
      const detail = (e as CustomEvent<StatusError>).detail;
      setStatusError(detail);
    }

    window.addEventListener("account-status-error", handleStatusError);
    return () => {
      window.removeEventListener("account-status-error", handleStatusError);
    };
  }, []);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.push("/");
    } catch {
      setSigningOut(false);
    }
  };

  if (!statusError) return null;

  const isSuspended = statusError.code === "ACCOUNT_SUSPENDED";

  return (
    <AlertDialog open>
      <AlertDialogContent className="[&>button]:hidden">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {isSuspended ? (
              <>
                <ShieldAlert className="h-5 w-5 text-destructive" />
                Account Suspended
              </>
            ) : (
              <>
                <Trash2 className="h-5 w-5 text-destructive" />
                Account Deleted
              </>
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isSuspended ? (
              <>
                Your account has been suspended.
                {statusError.reason && (
                  <>
                    {" "}
                    Reason: {statusError.reason}.
                  </>
                )}
                {" "}Please contact support for assistance.
              </>
            ) : (
              <>
                Your account has been deleted. If this was recent, contact
                support within 30 days to request reactivation.
              </>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            variant="destructive"
            onClick={handleSignOut}
            disabled={signingOut}
          >
            {signingOut ? "Signing out..." : "Sign Out"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
