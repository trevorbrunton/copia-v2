"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function VerifyContent() {
  const searchParams = useSearchParams();
  const email = searchParams.get("email");

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">Check Your Email</CardTitle>
        <CardDescription>
          {email ? (
            <>
              We&apos;ve sent a confirmation link to{" "}
              <span className="font-medium text-foreground">{email}</span>
            </>
          ) : (
            "We've sent you a confirmation link"
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="text-center text-sm text-muted-foreground space-y-4">
        <p>
          Click the link in the email to verify your account, then sign in.
        </p>
        <p>
          Didn&apos;t receive it? Check your spam folder or{" "}
          <Link href="/sign-up" className="text-primary hover:underline">
            try signing up again
          </Link>
          .
        </p>
      </CardContent>
      <CardFooter className="flex justify-center">
        <p className="text-sm text-muted-foreground">
          <Link href="/sign-in" className="text-primary hover:underline">
            Back to sign in
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <VerifyContent />
    </Suspense>
  );
}
