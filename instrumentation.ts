/**
 * Next.js startup hook — runs once on server cold start.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 *
 * Skip the edge runtime (no `process.env` for some vars, different
 * lifecycle). Run on Node serverless and on local `next dev` —
 * `NEXT_RUNTIME` is "nodejs" on Vercel and may be undefined locally.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { validateEnv } = await import("./src/server/env-check");
  validateEnv();
}
