export type { WeightConfig } from "./types";
import type { WeightConfig } from "./types";

export type PresetName = keyof typeof WEIGHT_PRESETS;

/** 5 weight presets per scoring engine whitepaper decisions G2/G3. */
export const WEIGHT_PRESETS = {
  /** Planned shifts — continuity + workload balance prioritised */
  planned: {
    skills: 0.20,
    relationship: 0.30,
    proximity: 0.15,
    workload: 0.20,
    acceptance: 0.15,
  },
  /** Urgent shifts — acceptance + proximity prioritised */
  urgent: {
    skills: 0.15,
    relationship: 0.10,
    proximity: 0.25,
    workload: 0.10,
    acceptance: 0.40,
  },
  /** High-value clients — proven track record prioritised */
  high_value_client: {
    skills: 0.15,
    relationship: 0.35,
    proximity: 0.15,
    workload: 0.10,
    acceptance: 0.25,
  },
  /** New clients — experienced caregivers prioritised */
  new_client: {
    skills: 0.25,
    relationship: 0.05,
    proximity: 0.20,
    workload: 0.25,
    acceptance: 0.25,
  },
  /** Efficiency — proximity + workload balance prioritised */
  efficiency: {
    skills: 0.15,
    relationship: 0.10,
    proximity: 0.30,
    workload: 0.30,
    acceptance: 0.15,
  },
} as const satisfies Record<string, WeightConfig>;

export const DEFAULT_PRESET: PresetName = "planned";
