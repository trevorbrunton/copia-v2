/**
 * Integration tests for SnapshotMarketDataProvider — hits the live DB.
 * vitest.config.ts loads .env.local so DATABASE_URL is available.
 *
 * Skip the suite gracefully if DATABASE_URL isn't set so the file isn't
 * a hard dependency in any environment.
 */
import { describe, expect, it } from "vitest";
import { SnapshotMarketDataProvider } from "@/src/screen/market-data-provider";

const SHOULD_RUN = !!process.env.DATABASE_URL;
const provider = new SnapshotMarketDataProvider();

describe.skipIf(!SHOULD_RUN)("SnapshotMarketDataProvider (live DB)", () => {
  it("returns a StockFact for a known top-100 ticker (CBA)", async () => {
    const fact = await provider.getStockFact("CBA");
    expect(fact).not.toBeNull();
    expect(fact!.ticker).toBe("CBA");
    expect(fact!.companyName.toUpperCase()).toContain("COMMONWEALTH");
    expect(fact!.marketCap).toBeGreaterThan(50_000_000_000); // > $50B
    expect(fact!.sharePrice).toBeGreaterThan(0);
    expect(fact!.isLive).toBe(false);
    expect(fact!.source).toMatch(/^Snapshot \d{4}-\d{2}-\d{2}$/);
    expect(fact!.snapshotDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(fact!.source).toBe(`Snapshot ${fact!.snapshotDate}`);
    expect(fact!.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fact!.earningsStatus).toBe("Profitable (TTM)");
  });

  it("derives earnings status as Unprofitable for a TTM-loss-making ticker (NXT)", async () => {
    const fact = await provider.getStockFact("NXT");
    expect(fact).not.toBeNull();
    expect(fact!.earningsStatus).toBe("Unprofitable (TTM)");
  });

  it("uppercases lowercase tickers", async () => {
    const fact = await provider.getStockFact("cba");
    expect(fact?.ticker).toBe("CBA");
  });

  it("trims whitespace before lookup", async () => {
    const fact = await provider.getStockFact("  bhp  ");
    expect(fact?.ticker).toBe("BHP");
  });

  it("returns null for unknown tickers", async () => {
    const fact = await provider.getStockFact("ZZZZ_NOT_A_REAL_TICKER");
    expect(fact).toBeNull();
  });

  it("returns null for empty input", async () => {
    expect(await provider.getStockFact("")).toBeNull();
    expect(await provider.getStockFact("   ")).toBeNull();
  });
});
