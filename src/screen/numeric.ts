/**
 * Strict numeric coercion shared between the API routes and the
 * market-data provider.
 *
 * Drizzle returns Postgres `numeric` columns as strings. This helper
 * coerces to a JS number, returning `null` on null/undefined/empty
 * input or any value that isn't finite (never NaN — that would silently
 * affect comparisons in the filter engine).
 */
export function parseNumeric(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
