import { z } from "zod";
import { desc } from "drizzle-orm";
import { handleAppError } from "@/src/server/errors";
import { logger } from "@/src/lib/logger";
import { db } from "@/src/db";
import { ocHoldings } from "@/src/db/screen-schema";
import { parseNumeric } from "@/src/screen/numeric";

/**
 * POST /api/v1/screen/portfolio-overlap
 *
 * Q8 — given the current shortlist of tickers, returns which of the OC
 * sample portfolio holdings still meet the screen and which don't.
 *
 * Body:    { fromTickers: string[] }
 * Returns: {
 *   portfolioLabel: string,
 *   asOfDate: string,
 *   isSample: boolean,
 *   matching: Array<{ ticker, weightPct, marketValueAud, sector }>,
 *   nonMatching: Array<{ ticker, weightPct, marketValueAud, sector }>,
 *   totalHoldings: number,
 * }
 *
 * Per D2: inline route pattern, no auth, no UoW. Per D8: response
 * carries the `isSample` flag so the avatar/UI can label answers.
 */

// Max ~ universe size (1,979 today). 2_000 is a comfortable defensive cap.
const BodySchema = z.object({
  fromTickers: z.array(z.string().min(1).max(10)).max(2_000),
});

export async function POST(req: Request) {
  const traceId = crypto.randomUUID();
  try {
    const raw = await req.json().catch(() => ({}));
    const { fromTickers } = BodySchema.parse(raw);

    // Pick the most recent portfolio in the table. If multiple labels
    // ever land, the latest as_of_date wins; tiebroken by created_at
    // implicitly via insertion order.
    const holdings = await db
      .select({
        portfolioLabel: ocHoldings.portfolioLabel,
        asOfDate: ocHoldings.asOfDate,
        ticker: ocHoldings.ticker,
        weightPct: ocHoldings.weightPct,
        marketValueAud: ocHoldings.marketValueAud,
        sector: ocHoldings.sector,
        isSample: ocHoldings.isSample,
      })
      .from(ocHoldings)
      .orderBy(desc(ocHoldings.asOfDate));

    if (holdings.length === 0) {
      return Response.json({
        portfolioLabel: null,
        asOfDate: null,
        isSample: true,
        matching: [],
        nonMatching: [],
        totalHoldings: 0,
      });
    }

    // Group by portfolioLabel + asOfDate (most-recent wins).
    const latest = holdings.filter(
      (h) =>
        h.portfolioLabel === holdings[0].portfolioLabel &&
        String(h.asOfDate) === String(holdings[0].asOfDate)
    );

    const shortlist = new Set(fromTickers);
    const matching = latest.filter((h) => shortlist.has(h.ticker));
    const nonMatching = latest.filter((h) => !shortlist.has(h.ticker));

    logger.info(
      {
        traceId,
        portfolioLabel: latest[0].portfolioLabel,
        totalHoldings: latest.length,
        matching: matching.length,
      },
      "screen:portfolio-overlap"
    );

    const project = (h: (typeof latest)[number]) => ({
      ticker: h.ticker,
      weightPct: parseNumeric(h.weightPct),
      marketValueAud: parseNumeric(h.marketValueAud),
      sector: h.sector,
    });

    return Response.json({
      portfolioLabel: latest[0].portfolioLabel,
      asOfDate: latest[0].asOfDate,
      isSample: latest[0].isSample,
      matching: matching.map(project),
      nonMatching: nonMatching.map(project),
      totalHoldings: latest.length,
    });
  } catch (err) {
    return handleAppError(err, traceId);
  }
}

export async function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}

