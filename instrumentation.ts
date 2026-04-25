/**
 * Next.js startup hook — runs once on server cold start.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { validateEnv } = await import("./src/server/env-check");
  validateEnv();
}
