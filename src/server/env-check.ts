/**
 * Validate required environment variables at server startup so missing
 * config surfaces loudly in the logs instead of as an opaque 502 on the
 * first user click.
 *
 * Called once from `instrumentation.ts` (Next.js startup hook).
 */
import { logger } from "@/src/lib/logger";

interface EnvRequirement {
  name: string;
  /** What goes wrong if this is missing. */
  reason: string;
  /** Treat absence as fatal? Default false (warn only). */
  required?: boolean;
}

const REQUIREMENTS: EnvRequirement[] = [
  // External APIs the public demo depends on.
  {
    name: "ELEVENLABS_API_KEY",
    reason: "voice STT — POST /api/v1/screen/process will return 502",
  },
  {
    name: "ANTHROPIC_API_KEY",
    reason:
      "intent classifier fallback — voice utterances that miss the rule layer return `fallback` instead of routing correctly",
  },
  {
    name: "TAVUS_API_KEY",
    reason: "avatar runtime — POST /api/v1/demo/tavus will return 502",
  },
  {
    name: "TAVUS_REPLICA_ID",
    reason: "avatar replica selection (Tavus uses persona default if absent)",
  },
  // Database — fatal if unset.
  {
    name: "DATABASE_URL",
    reason: "Postgres connection — every query will fail",
    required: true,
  },
  // Supabase auth — only needed when the auth UI is exercised.
  {
    name: "NEXT_PUBLIC_SUPABASE_URL",
    reason: "Supabase auth — sign-in flow will fail (demo path is unaffected)",
  },
  {
    name: "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    reason: "Supabase auth — sign-in flow will fail (demo path is unaffected)",
  },
];

let validated = false;

export function validateEnv(): void {
  if (validated) return;
  validated = true;

  const missing: EnvRequirement[] = [];
  const fatal: EnvRequirement[] = [];

  for (const r of REQUIREMENTS) {
    const v = process.env[r.name];
    if (!v) {
      if (r.required) fatal.push(r);
      else missing.push(r);
    }
  }

  for (const r of missing) {
    logger.warn(
      { envVar: r.name, impact: r.reason },
      "env-check: missing optional env var"
    );
  }

  if (fatal.length > 0) {
    for (const r of fatal) {
      logger.error(
        { envVar: r.name, impact: r.reason },
        "env-check: missing REQUIRED env var"
      );
    }
    throw new Error(
      `Missing required env vars: ${fatal.map((r) => r.name).join(", ")}`
    );
  }

  if (missing.length === 0) {
    logger.info({}, "env-check: all configured");
  }
}
