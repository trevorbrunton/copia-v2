/**
 * PoC 2 Task 5.1 + 5.2: Scenario categorisation and human decision baselines.
 *
 * Each of the 32 scoring scenarios from PoC 1 is classified and paired with
 * what an experienced rostering staff member would decide.
 *
 * Classifications:
 *   - straightforward: Clear best candidate, no ambiguity
 *   - ambiguous: Multiple reasonable choices, judgement call
 *   - edge_case: Missing data, sparse pools, or unusual conditions
 *   - constraint_violation: Hard constraints eliminate candidates
 */
import type { HumanBaseline } from "./types";

export const SCENARIO_BASELINES: HumanBaseline[] = [
  // ── Category 1: Straightforward Matches ──
  {
    id: "S1",
    classification: "straightforward",
    human_decision: "Assign Alice Smith (employee 1) — closest, best history, highest acceptance",
    should_escalate: false,
    rationale: "Alice dominates on proximity (CBD), relationship (15 recent visits), and acceptance (90%). Clear winner with no trade-offs.",
  },
  {
    id: "S2",
    classification: "ambiguous",
    human_decision: "Choose between Alice (1) and Bob (2) — both equally strong. Slight edge to whichever is less busy.",
    should_escalate: false,
    rationale: "Near-identical scores across dimensions. Both have strong relationship history and are co-located. Workload balance becomes the tiebreaker.",
  },
  {
    id: "S3",
    classification: "straightforward",
    human_decision: "Assign the employee with lowest workload (Carol, employee 3) — all else equal",
    should_escalate: false,
    rationale: "Same location, same history, same acceptance. Bob has 3 shifts already — Carol has none. Workload balance is the clear differentiator.",
  },
  {
    id: "S4",
    classification: "edge_case",
    human_decision: "Assign Alice (employee 1) as the only option, but flag for review — no alternatives",
    should_escalate: true,
    rationale: "Single candidate means no fallback if they decline. Escalate as informational — human should verify this is acceptable.",
  },
  {
    id: "S5",
    classification: "straightforward",
    human_decision: "Assign highest-ranked from top 10 — large pool gives high confidence",
    should_escalate: false,
    rationale: "20 candidates all in CBD with similar qualifications. High confidence in any top candidate — no need for escalation.",
  },

  // ── Category 2: Multi-Qualified Candidates ──
  {
    id: "M1",
    classification: "straightforward",
    human_decision: "Any of the three — all fully qualified. Use other dimensions to differentiate.",
    should_escalate: false,
    rationale: "All three have all 3 required skills. Specialist One has an extra skill but that doesn't matter for this visit. Differentiate on other dimensions.",
  },
  {
    id: "M2",
    classification: "constraint_violation",
    human_decision: "Assign Full Match (employee 1) — only candidate with all 4 required skills",
    should_escalate: false,
    rationale: "Hard constraint filter leaves only 1 eligible. Two and Three lack required skills. Straightforward single-option assignment.",
  },
  {
    id: "M3",
    classification: "edge_case",
    human_decision: "Assign any candidate — no skill requirements defined. Flag data quality issue.",
    should_escalate: true,
    rationale: "Missing skill requirements means the scoring engine can't properly differentiate. Escalate as informational — confirm with coordinator that no skills are truly needed.",
  },
  {
    id: "M4",
    classification: "straightforward",
    human_decision: "Assign any — all have valid skills. Note that employee 1's skill expires tomorrow.",
    should_escalate: false,
    rationale: "All 3 pass the hard constraint filter since their skills are still valid. The expiring-soon skill is noted but doesn't change the recommendation.",
  },
  {
    id: "M5",
    classification: "constraint_violation",
    human_decision: "Choose between Full Five (1) and Also Full Five (4) — only two with all 5 skills",
    should_escalate: false,
    rationale: "Hard filter correctly excludes employees with fewer than 5 skills. Two valid candidates — differentiate on other dimensions.",
  },

  // ── Category 3: Rural / Sparse Pools ──
  {
    id: "R1",
    classification: "edge_case",
    human_decision: "All candidates are >50km from rural client. Assign closest, but flag travel distance concern.",
    should_escalate: true,
    rationale: "Zero proximity scores mean significant travel time. Escalate before shift — human should confirm the travel commitment with the caregiver.",
  },
  {
    id: "R2",
    classification: "edge_case",
    human_decision: "Assign Regional Alice (1) — closer to client. But only 2 options — flag limited pool.",
    should_escalate: true,
    rationale: "Only 2 candidates in a rural area. If either declines, no fallback. Escalate as informational — limited options available.",
  },
  {
    id: "R3",
    classification: "straightforward",
    human_decision: "Assign Local Alice (1) — closest to rural client, minimal travel time",
    should_escalate: false,
    rationale: "With efficiency preset, proximity + workload dominate. Alice is essentially co-located with the client. Clear winner.",
  },
  {
    id: "R4",
    classification: "edge_case",
    human_decision: "Assign Has Coords (1) or Also Has (3) — skip No Coords (2) due to unknown distance. Flag data gap.",
    should_escalate: true,
    rationale: "Employee 2's missing coordinates mean we can't assess travel. Escalate as informational — recommend updating employee 2's location data.",
  },
  {
    id: "R5",
    classification: "edge_case",
    human_decision: "Assign any candidate — client location unknown, so proximity is not a factor. Flag data gap.",
    should_escalate: true,
    rationale: "Missing client coordinates means proximity is unavailable for all. Escalate as informational — client address needs updating.",
  },

  // ── Category 4: Preset Comparison ──
  {
    id: "P1",
    classification: "straightforward",
    human_decision: "Assign High Accept Far (1) — urgent shift prioritises acceptance likelihood (90%)",
    should_escalate: false,
    rationale: "Urgent preset weights acceptance at 40%. Employee 1 has 90% acceptance rate. Speed of filling is the priority.",
  },
  {
    id: "P2",
    classification: "straightforward",
    human_decision: "Assign Low Accept Near (2) — planned shift prioritises continuity of care (12 recent visits)",
    should_escalate: false,
    rationale: "Planned preset weights relationship at 30%. Employee 2 has 12 recent visits with this client. Continuity matters for planned care.",
  },
  {
    id: "P3",
    classification: "straightforward",
    human_decision: "Assign Near Light (1) — closest with lowest workload, optimal efficiency",
    should_escalate: false,
    rationale: "Efficiency preset weights proximity + workload at 60% combined. Employee 1 is near and has no existing shifts.",
  },
  {
    id: "P4",
    classification: "straightforward",
    human_decision: "Assign Long Relationship (1) — 20 recent visits, strong client bond",
    should_escalate: false,
    rationale: "High-value client preset weights relationship at 35%. Employee 1 has deep established relationship. Client familiarity is paramount.",
  },
  {
    id: "P5",
    classification: "straightforward",
    human_decision: "Assign Highly Skilled (1) or Also Skilled (3) — both highly skilled and reliable. Not employee 2 (low acceptance).",
    should_escalate: false,
    rationale: "New client preset weights skills + acceptance. Employee 2 has only 30% acceptance rate — unreliable for a first impression.",
  },
  {
    id: "P6",
    classification: "straightforward",
    human_decision: "All candidates score equally on skills (100% weight). Other factors irrelevant per custom weights.",
    should_escalate: false,
    rationale: "Custom 100% skills weight means all fully-qualified candidates tie. Location, history, acceptance are all zeroed out.",
  },

  // ── Category 5: Client Relationship ──
  {
    id: "N1",
    classification: "edge_case",
    human_decision: "New client — assign based on proximity and acceptance since no relationship history exists.",
    should_escalate: false,
    rationale: "Zero relationship scores for all. Proximity and acceptance become the differentiators. No escalation needed — new client assignment is routine.",
  },
  {
    id: "N2",
    classification: "straightforward",
    human_decision: "Assign Regular Carer (1) — 25 recent visits, strong established relationship",
    should_escalate: false,
    rationale: "Clear continuity-of-care winner. Client knows and trusts this caregiver. Planned preset reinforces relationship weighting.",
  },
  {
    id: "N3",
    classification: "ambiguous",
    human_decision: "Assign Recent Carer (1) — same visit count as Stale Carer (2) but much more recent interactions.",
    should_escalate: false,
    rationale: "Both have 10 visits, but recency matters. Employee 1's visits were 3 days ago vs 100 days ago. Client relationship is fresher.",
  },
  {
    id: "N4",
    classification: "edge_case",
    human_decision: "No client assigned to visit — assign based on availability. Flag missing client data.",
    should_escalate: true,
    rationale: "Visit without a client is a data quality issue. Escalate as informational — someone needs to assign the client to this visit.",
  },
  {
    id: "N5",
    classification: "straightforward",
    human_decision: "Assign Heavy History (1) — 12 visits gives high confidence in relationship scoring",
    should_escalate: false,
    rationale: "Clear relationship gradient: 12 > 5 > 1. Employee 1 has high confidence relationship score.",
  },

  // ── Category 6: Hard Constraint Edge Cases ──
  {
    id: "H1",
    classification: "constraint_violation",
    human_decision: "No eligible candidates — all filtered out. Must find additional staff or adjust requirements.",
    should_escalate: true,
    rationale: "Zero eligible employees is a critical situation. Escalate immediately — human needs to broaden the search or adjust qualification requirements.",
  },
  {
    id: "H2",
    classification: "constraint_violation",
    human_decision: "Assign Free (2) or Also Free (3) — Conflicting (1) has a schedule overlap",
    should_escalate: false,
    rationale: "Schedule conflict correctly removes employee 1. Two viable options remain — no escalation needed.",
  },
  {
    id: "H3",
    classification: "straightforward",
    human_decision: "All three eligible — adjacent shifts don't overlap. Assign based on other dimensions.",
    should_escalate: false,
    rationale: "Back-to-back and adjacent shifts are valid — no overlap means no conflict. All 3 employees are eligible.",
  },
  {
    id: "H4",
    classification: "constraint_violation",
    human_decision: "Assign Valid Skill (2) or Also Valid (3) — Expired Skill (1) correctly excluded",
    should_escalate: false,
    rationale: "Expired qualification is a compliance issue — employee 1 must be excluded. Two valid options remain.",
  },
  {
    id: "H5",
    classification: "constraint_violation",
    human_decision: "Assign Pass All (2) or Also Pass (3) — Double Fail (1) has both missing skills and schedule conflict",
    should_escalate: false,
    rationale: "Employee 1 fails on two hard constraints. Two remaining candidates pass all checks.",
  },
  {
    id: "H6",
    classification: "straightforward",
    human_decision: "All eligible — no required skills means no constraint filtering. Differentiate on other dimensions.",
    should_escalate: false,
    rationale: "Empty required skills means everyone passes. Having more skills on file doesn't matter if none are required.",
  },
];
