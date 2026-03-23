import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/src/lib/alayacare-client", () => ({
  alayaFetch: vi.fn(),
}));
vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { detectNewTriggers } from "./trigger-detector";
import { alayaFetch } from "@/src/lib/alayacare-client";

function makeMockTx(existingVisitIds: number[] = []) {
  const select = vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue(
        existingVisitIds.map((id) => ({ visitId: id }))
      ),
    }),
  });
  return { select } as unknown as Parameters<typeof detectNewTriggers>[0];
}

describe("detectNewTriggers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("should detect new vacant visits not already tracked", async () => {
    vi.mocked(alayaFetch).mockResolvedValue({
      count: 3, page: 1, total_pages: 1,
      items: [
        { id: 100, status: "vacant" },
        { id: 200, status: "vacant" },
        { id: 300, status: "vacant" },
      ],
    });

    const tx = makeMockTx([100]); // visit 100 already tracked
    const result = await detectNewTriggers(tx, "user-1");

    expect(result.newVisits).toEqual([200, 300]);
    expect(result.alreadyTracked).toEqual([100]);
  });

  it("should return empty when no vacant visits", async () => {
    vi.mocked(alayaFetch).mockResolvedValue({
      count: 0, page: 1, total_pages: 1, items: [],
    });

    const tx = makeMockTx();
    const result = await detectNewTriggers(tx, "user-1");

    expect(result.newVisits).toEqual([]);
    expect(result.alreadyTracked).toEqual([]);
  });

  it("should return all as new when none are tracked", async () => {
    vi.mocked(alayaFetch).mockResolvedValue({
      count: 2, page: 1, total_pages: 1,
      items: [
        { id: 400, status: "vacant" },
        { id: 500, status: "vacant" },
      ],
    });

    const tx = makeMockTx([]);
    const result = await detectNewTriggers(tx, "user-1");

    expect(result.newVisits).toEqual([400, 500]);
  });
});
