import { describe, it, expect } from "vitest";
import { scoreAcceptance, type ContactOutcome } from "./score-acceptance";

const makeOffer = (status: string) => ({ status });
const recentDate = () => new Date(Date.now() - 86_400_000).toISOString(); // 1 day ago
const oldDate = () => new Date(Date.now() - 90 * 86_400_000).toISOString(); // 90 days ago

describe("scoreAcceptance", () => {
  it("should return 0.5 low confidence when no offer history", () => {
    const result = scoreAcceptance([]);

    expect(result.score).toBeCloseTo(0.5);
    expect(result.confidence).toBe("low");
  });

  it("should return 1.0 when all offers accepted", () => {
    const offers = Array.from({ length: 5 }, () => makeOffer("accepted"));
    const result = scoreAcceptance(offers);

    expect(result.score).toBeCloseTo(1.0);
  });

  it("should return 0.0 when all offers declined", () => {
    const offers = Array.from({ length: 5 }, () => makeOffer("declined"));
    const result = scoreAcceptance(offers);

    expect(result.score).toBeCloseTo(0.0);
  });

  it("should compute ratio for mixed offers", () => {
    const offers = [
      makeOffer("accepted"),
      makeOffer("accepted"),
      makeOffer("declined"),
      makeOffer("pending"), // ignored
    ];
    const result = scoreAcceptance(offers);

    // 2 accepted / (2 accepted + 1 declined) = 0.667
    expect(result.score).toBeCloseTo(2 / 3, 2);
  });

  it("should have low confidence for <3 resolved offers", () => {
    const offers = [makeOffer("accepted"), makeOffer("declined")];
    const result = scoreAcceptance(offers);

    expect(result.confidence).toBe("low");
  });

  it("should have medium confidence for 3–9 resolved offers", () => {
    const offers = Array.from({ length: 5 }, () => makeOffer("accepted"));
    const result = scoreAcceptance(offers);

    expect(result.confidence).toBe("medium");
  });

  it("should have high confidence for 10+ resolved offers", () => {
    const offers = Array.from({ length: 12 }, () => makeOffer("accepted"));
    const result = scoreAcceptance(offers);

    expect(result.confidence).toBe("high");
  });

  // --- DappaAi outcomes integration ---

  it("should boost score when recent DappaAi outcomes are positive", () => {
    // AlayaCare: 2 accepted, 2 declined = 0.5
    const offers = [makeOffer("accepted"), makeOffer("accepted"), makeOffer("declined"), makeOffer("declined")];
    // DappaAi: 2 recent accepts → should push score above 0.5
    const outcomes: ContactOutcome[] = [
      { response: "accepted", timestamp: recentDate() },
      { response: "accepted", timestamp: recentDate() },
    ];

    const result = scoreAcceptance(offers, outcomes);

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.reason).toContain("DappaAi outcomes");
  });

  it("should weight recent DappaAi outcomes higher than old ones", () => {
    // 1 AlayaCare decline as baseline (so score isn't trivially 1.0)
    const offers = [makeOffer("declined")];

    // Same accept outcome but different ages
    const recentAccept: ContactOutcome[] = [{ response: "accepted", timestamp: recentDate() }];
    const oldAccept: ContactOutcome[] = [{ response: "accepted", timestamp: oldDate() }];

    const recentResult = scoreAcceptance(offers, recentAccept);
    const oldResult = scoreAcceptance(offers, oldAccept);

    // Recent accept has more weight vs the 1 decline, so score should be higher
    expect(recentResult.score).toBeGreaterThan(oldResult.score);
  });

  it("should skip expired DappaAi outcomes", () => {
    const offers = [makeOffer("accepted"), makeOffer("declined")];
    const outcomes: ContactOutcome[] = [
      { response: "expired", timestamp: recentDate() },
      { response: "expired", timestamp: recentDate() },
    ];

    const withExpired = scoreAcceptance(offers, outcomes);
    const withoutOutcomes = scoreAcceptance(offers);

    // Expired outcomes are ignored, so scores should be equal
    expect(withExpired.score).toBeCloseTo(withoutOutcomes.score);
  });
});
