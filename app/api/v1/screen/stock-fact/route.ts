import { z } from "zod";
import { handleAppError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { SnapshotMarketDataProvider } from "@/src/screen/market-data-provider";

/**
 * POST /api/v1/screen/stock-fact
 *
 * Single-ticker lookup via the snapshot-backed `MarketDataProvider`.
 * Used by the v2 demo UI (clickable rows) and, in phase 5, by the
 * `info:stock_field` voice intent.
 *
 * Body:    { ticker: string }
 * Returns: { fact: StockFact } on hit, { fact: null } on miss
 *          (404 only when no snapshot exists at all).
 *
 * Per D2: inline route pattern, no auth, no UoW.
 */

const BodySchema = z.object({
  ticker: z.string().min(1).max(10),
});

const provider = new SnapshotMarketDataProvider();

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const raw = await req.json().catch(() => ({}));
    const { ticker } = BodySchema.parse(raw);

    const fact = await provider.getStockFact(ticker);
    logger.info(
      { traceId, ticker: ticker.toUpperCase(), hit: fact !== null },
      "screen:stock-fact"
    );

    return Response.json({ fact });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
