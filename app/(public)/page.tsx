import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center gap-8 text-center px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground font-bold text-2xl">
        M
      </div>
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">Mayfly</h1>
        <p className="text-lg text-muted-foreground max-w-md">
          A modern full-stack starter with auth, database, and AI chat built in.
        </p>
      </div>
      <div className="flex gap-4">
        <Link
          href="/sign-in"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Sign In
          <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
        <Link
          href="/sign-up"
          className="inline-flex items-center justify-center rounded-lg border px-6 py-2.5 text-sm font-medium hover:bg-accent transition-colors"
        >
          Create Account
        </Link>
      </div>
    </div>
  );
}
