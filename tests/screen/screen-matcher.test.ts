/**
 * Tests for `matchScreenIntent` — the rule-first / classifier-fallback
 * composition. The classifier is stubbed (per plan §11) so the tests
 * are deterministic and don't hit Anthropic.
 */
import { describe, expect, it } from "vitest";
import { matchScreenIntent, type ClassifierFn } from "@/src/screen/screen-matcher";
import type { Intent } from "@/src/screen/intent";

const stubClassifier: ClassifierFn = async (text) => {
  // Mock: route specific paraphrases the rule layer doesn't know.
  if (/profitable\s+only/.test(text.toLowerCase())) {
    return { kind: "apply_filter", filterId: "q4_profitable" };
  }
  if (/big\b/.test(text.toLowerCase())) {
    return { kind: "apply_filter", filterId: "q1_mcap_50m" };
  }
  if (/give\s+up/.test(text.toLowerCase())) {
    return { kind: "fallback" };
  }
  // Default for unknown — also fallback.
  return { kind: "fallback" };
};

const throwingClassifier: ClassifierFn = async () => {
  throw new Error("Anthropic outage");
};

describe("matchScreenIntent — composition", () => {
  it("uses the rule layer when a rule matches; classifier never runs", async () => {
    let called = false;
    const tracking: ClassifierFn = async () => {
      called = true;
      return { kind: "fallback" };
    };
    const intent = await matchScreenIntent(
      "Show me ASX stocks with a market cap above 50 million dollars",
      tracking
    );
    expect(intent).toEqual<Intent>({ kind: "apply_filter", filterId: "q1_mcap_50m" });
    expect(called).toBe(false);
  });

  it("falls through to the classifier when no rule matches", async () => {
    const intent = await matchScreenIntent("show me only profitable", stubClassifier);
    expect(intent).toEqual<Intent>({ kind: "apply_filter", filterId: "q4_profitable" });
  });

  it("falls through to fallback when the classifier returns fallback", async () => {
    const intent = await matchScreenIntent("just give up please", stubClassifier);
    expect(intent.kind).toBe("fallback");
  });

  it("returns fallback when the classifier throws", async () => {
    const intent = await matchScreenIntent(
      "what time does the market open",
      throwingClassifier
    );
    expect(intent.kind).toBe("fallback");
  });

  it("propagates an info_stock_field intent from the classifier", async () => {
    const stockFieldClassifier: ClassifierFn = async (text) => {
      if (/price\s+of/.test(text.toLowerCase())) {
        return { kind: "info_stock_field", field: "share_price" };
      }
      return { kind: "fallback" };
    };
    const intent = await matchScreenIntent(
      "what's the going price of nextdc these days",
      stockFieldClassifier
    );
    expect(intent.kind).toBe("info_stock_field");
    if (intent.kind === "info_stock_field") {
      expect(intent.field).toBe("share_price");
    }
  });

  it("respects classifier outputs that pass schema even when the rule layer would have run", async () => {
    // This utterance does NOT match any rule, so the classifier path
    // runs. The stub returns apply_initial_screen — verify the
    // composition propagates it untouched.
    const initialScreenClassifier: ClassifierFn = async () => ({
      kind: "apply_initial_screen",
    });
    const intent = await matchScreenIntent(
      "give me OCs full process please",
      initialScreenClassifier
    );
    expect(intent.kind).toBe("apply_initial_screen");
  });
});
