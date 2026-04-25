/**
 * Integration tests for the v2 screen API routes — hits the live DB.
 * Skips gracefully if DATABASE_URL isn't set.
 *
 * Covers:
 *   - GET /api/v1/screen/snapshot
 *   - POST /api/v1/screen/apply-filter
 *   - POST /api/v1/screen/stock-fact
 */
import { describe, expect, it } from "vitest";
import { GET as snapshotGET } from "@/app/api/v1/screen/snapshot/route";
import { POST as applyFilterPOST } from "@/app/api/v1/screen/apply-filter/route";
import { POST as stockFactPOST } from "@/app/api/v1/screen/stock-fact/route";

const SHOULD_RUN = !!process.env.DATABASE_URL;

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!SHOULD_RUN)("GET /api/v1/screen/snapshot", () => {
  it("returns the active snapshot + securities", async () => {
    const res = await snapshotGET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      snapshot: { id: string; date: string; collectedAt: string; stockCount: number };
      securities: Array<{ ticker: string; companyName: string }>;
    };
    expect(body.snapshot.id).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.snapshot.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(body.snapshot.stockCount).toBeGreaterThan(1000);
    expect(body.securities.length).toBe(body.snapshot.stockCount);
    expect(body.securities[0].ticker).toBeTruthy();
    expect(body.securities[0].companyName).toBeTruthy();
  });
});

describe.skipIf(!SHOULD_RUN)("POST /api/v1/screen/apply-filter", () => {
  it("rejects invalid filterId with 400", async () => {
    const res = await applyFilterPOST(jsonRequest({ filterId: "not_a_filter" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.traceId).toBeTruthy();
  });

  it("rejects missing filterId with 400", async () => {
    const res = await applyFilterPOST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("rejects non-string entries in fromTickers with 400", async () => {
    const res = await applyFilterPOST(
      jsonRequest({ filterId: "q1_mcap_50m", fromTickers: ["CBA", 42, "BHP"] })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("Q1 from universe returns ~940 stocks", async () => {
    const res = await applyFilterPOST(jsonRequest({ filterId: "q1_mcap_50m" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { stage: { id: string; count: number; tickers: string[] } };
    expect(body.stage.id).toBe("q1_mcap_50m");
    expect(body.stage.count).toBe(940);
    expect(body.stage.tickers).toContain("CBA");
  });

  it("Q2 from Q1 puts CBA / BHP / RIO at the top by market cap", async () => {
    const q1 = (await (
      await applyFilterPOST(jsonRequest({ filterId: "q1_mcap_50m" }))
    ).json()) as { stage: { tickers: string[] } };
    const res = await applyFilterPOST(
      jsonRequest({ filterId: "q2_top_100", fromTickers: q1.stage.tickers })
    );
    const body = (await res.json()) as { stage: { count: number; tickers: string[] } };
    expect(body.stage.count).toBe(100);
    expect(body.stage.tickers.slice(0, 3)).toEqual(["CBA", "BHP", "RIO"]);
  });
});

describe.skipIf(!SHOULD_RUN)("POST /api/v1/screen/stock-fact", () => {
  it("returns a StockFact for a known ticker", async () => {
    const res = await stockFactPOST(jsonRequest({ ticker: "CBA" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { fact: { ticker: string; isLive: boolean } | null };
    expect(body.fact).not.toBeNull();
    expect(body.fact!.ticker).toBe("CBA");
    expect(body.fact!.isLive).toBe(false);
  });

  it("returns { fact: null } for unknown tickers (200, not 404)", async () => {
    const res = await stockFactPOST(jsonRequest({ ticker: "ZZZ_FAKE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fact).toBeNull();
  });

  it("rejects empty/missing ticker with 400", async () => {
    expect((await stockFactPOST(jsonRequest({ ticker: "" }))).status).toBe(400);
    expect((await stockFactPOST(jsonRequest({}))).status).toBe(400);
  });
});
