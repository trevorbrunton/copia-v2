import { describe, it, expect } from "vitest";
import { WEIGHT_PRESETS, DEFAULT_PRESET, type WeightConfig } from "./weights";

describe("Weight Presets", () => {
  const presetNames = Object.keys(WEIGHT_PRESETS) as Array<
    keyof typeof WEIGHT_PRESETS
  >;

  it("should have exactly 5 presets", () => {
    expect(presetNames).toHaveLength(5);
    expect(presetNames).toEqual(
      expect.arrayContaining([
        "planned",
        "urgent",
        "high_value_client",
        "new_client",
        "efficiency",
      ])
    );
  });

  it.each(presetNames)("preset '%s' weights should sum to 1.0", (name) => {
    const preset: WeightConfig = WEIGHT_PRESETS[name];
    const sum =
      preset.skills +
      preset.relationship +
      preset.proximity +
      preset.workload +
      preset.acceptance;
    expect(sum).toBeCloseTo(1.0, 10);
  });

  it("DEFAULT_PRESET should be 'planned'", () => {
    expect(DEFAULT_PRESET).toBe("planned");
  });
});
