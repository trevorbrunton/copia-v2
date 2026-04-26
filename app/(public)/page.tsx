import Link from "next/link";
import { ArrowRight } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col items-center gap-12 text-center px-4">
      <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--oc-navy)] font-bold text-2xl text-white shadow-lg">
        OC
      </div>
      <div className="space-y-3">
        <h1 className="text-4xl font-bold tracking-tight text-[var(--oc-navy)]">
          OC Funds Management
        </h1>
        <p className="text-lg text-muted-foreground max-w-lg">
          A curated demonstration of the OC Funds Managment stock filtering
          process.
        </p>
      </div>
      <Link
        href="/demo/screen"
        className="inline-flex items-center justify-center rounded-lg bg-[var(--oc-navy)] px-8 py-3 text-base font-medium text-white hover:bg-[var(--oc-dark)] transition-colors shadow-md"
      >
        Start Now
        <ArrowRight className="ml-2 h-5 w-5" />
      </Link>
    </div>
  );
}
