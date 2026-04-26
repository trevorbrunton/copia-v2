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
import { POST as processPOST } from "@/app/api/v1/screen/process/route";
import { POST as portfolioOverlapPOST } from "@/app/api/v1/screen/portfolio-overlap/route";

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

  it("Q2 from Q1 excludes CBA / BHP / RIO (the largest names by market cap)", async () => {
    const q1 = (await (
      await applyFilterPOST(jsonRequest({ filterId: "q1_mcap_50m" }))
    ).json()) as { stage: { tickers: string[] } };
    const res = await applyFilterPOST(
      jsonRequest({ filterId: "q2_exclude_top_100", fromTickers: q1.stage.tickers })
    );
    const body = (await res.json()) as { stage: { count: number; tickers: string[] } };
    // Drops the top 100 by mcap from the post-Q1 set, keeps the rest.
    expect(body.stage.count).toBe(q1.stage.tickers.length - 100);
    const tickerSet = new Set(body.stage.tickers);
    for (const top of ["CBA", "BHP", "RIO"]) {
      expect(tickerSet.has(top)).toBe(false);
    }
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

describe.skipIf(!SHOULD_RUN)("POST /api/v1/screen/process", () => {
  it("classifies a Q1 utterance via the rule layer", async () => {
    const res = await processPOST(
      jsonRequest({ text: "Show me ASX stocks with a market cap of more than 50 million dollars" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      text: string;
      intent: { kind: string; filterId?: string };
    };
    expect(body.intent.kind).toBe("apply_filter");
    expect(body.intent.filterId).toBe("q1_mcap_50m");
  });

  it("classifies and resolves a stock-fact query end-to-end", async () => {
    const res = await processPOST(jsonRequest({ text: "What's BHP's market cap?" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      text: string;
      intent: { kind: string; ticker?: string; field?: string };
    };
    expect(body.intent.kind).toBe("info_stock_field");
    expect(body.intent.ticker).toBe("BHP");
    expect(body.intent.field).toBe("market_cap");
  });

  it("resolves a company-name fallback (Commonwealth Bank → CBA)", async () => {
    const res = await processPOST(
      jsonRequest({ text: "what's commonwealth bank's market cap" })
    );
    const body = (await res.json()) as {
      intent: { kind: string; ticker?: string };
    };
    expect(body.intent.kind).toBe("info_stock_field");
    expect(body.intent.ticker).toBe("CBA");
  });

  it("classifies a process-topic question into info_process_field", async () => {
    const res = await processPOST(jsonRequest({ text: "What is OC's investment philosophy?" }));
    const body = (await res.json()) as { intent: { kind: string; topic?: string } };
    expect(body.intent.kind).toBe("info_process_field");
    expect(body.intent.topic).toBe("philosophy");
  });

  it("rejects empty/missing text with 400", async () => {
    expect((await processPOST(jsonRequest({ text: "" }))).status).toBe(400);
    expect((await processPOST(jsonRequest({}))).status).toBe(400);
  });
});

describe.skipIf(!SHOULD_RUN)("POST /api/v1/screen/portfolio-overlap", () => {
  it("partitions sample holdings into matching / nonMatching by ticker presence", async () => {
    // Three holdings present in the shortlist, the rest absent.
    const res = await portfolioOverlapPOST(
      jsonRequest({ fromTickers: ["MIN", "CHC", "ORI"] })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      portfolioLabel: string;
      isSample: boolean;
      matching: Array<{ ticker: string }>;
      nonMatching: Array<{ ticker: string }>;
      totalHoldings: number;
    };
    expect(body.isSample).toBe(true);
    expect(body.totalHoldings).toBe(10); // The 10 supplied sample holdings
    expect(body.matching.map((m) => m.ticker).sort()).toEqual(["CHC", "MIN", "ORI"]);
    expect(body.nonMatching.length).toBe(7);
  });

  it("returns all holdings as nonMatching when fromTickers is empty", async () => {
    const res = await portfolioOverlapPOST(jsonRequest({ fromTickers: [] }));
    const body = (await res.json()) as {
      matching: unknown[];
      nonMatching: unknown[];
      totalHoldings: number;
    };
    expect(body.matching.length).toBe(0);
    expect(body.nonMatching.length).toBe(body.totalHoldings);
  });

  it("rejects oversized fromTickers payload with 400", async () => {
    const big = Array.from({ length: 2_001 }, (_, i) => `T${i}`);
    const res = await portfolioOverlapPOST(jsonRequest({ fromTickers: big }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});
