/** Weight configuration for the 5 scoring dimensions. Values must sum to 1.0. */
export interface WeightConfig {
  skills: number;
  relationship: number;
  proximity: number;
  workload: number;
  acceptance: number;
}

/** Score for a single scoring dimension, normalised to [0, 1]. */
export interface DimensionScore {
  score: number;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/** Breakdown of all 5 dimension scores for a candidate. */
export interface DimensionBreakdown {
  skills: DimensionScore;
  relationship: DimensionScore;
  proximity: DimensionScore;
  workload: DimensionScore;
  acceptance: DimensionScore;
}

/** A candidate scored and ranked by the scoring engine. */
export interface ScoredCandidate {
  employee_id: number;
  employee_name: string;
  overall: number;
  confidence: "high" | "medium" | "low";
  dimensions: DimensionBreakdown;
  warnings: string[];
}

/** Result of hard constraint filtering for a single employee. */
export interface HardConstraintResult {
  eligible: boolean;
  failed_constraints: string[];
}

// ── Shared AlayaCare data shapes (used by scorers + constraints) ──

/** Minimal employee skill reference from AlayaCare. */
export interface EmployeeSkillRef {
  skill_id: number;
  expired_date: string | null;
}

/** Minimal schedule visit reference for conflict checking. */
export interface ScheduleVisitRef {
  start_at: string;
  end_at: string;
}

/** Minimal prior visit reference for relationship scoring. */
export interface PriorVisitRef {
  start_at: string;
}

/** Minimal offer reference for acceptance scoring. */
export interface OfferRef {
  status: string;
}

/** Fetched visit data carried on MatchResult to avoid re-fetching downstream. */
export interface FetchedVisitDetail {
  id: number;
  client_id: number | null;
  start_at: string;
  end_at: string;
  status?: string;
  service_instructions?: string | null;
}

/** Fetched client data carried on MatchResult to avoid re-fetching downstream. */
export interface FetchedClientDetail {
  id: number;
  latitude: number | null;
  longitude: number | null;
  first_name?: string;
  last_name?: string;
  city?: string | null;
  state?: string | null;
}

/** Overall match result returned by the scoring orchestrator. */
export interface MatchResult {
  visit_id: number;
  client_id: number | null;
  candidates: ScoredCandidate[];
  weights_used: WeightConfig;
  preset_name: string | null;
  candidate_pool_size: number;
  eligible_pool_size: number;
  data_warnings: string[];
  match_confidence: "high" | "medium" | "low";
  scored_at: string;
  /** Pre-fetched visit detail — avoids re-fetching in downstream consumers like buildRecommendationContext. */
  fetchedVisit?: FetchedVisitDetail;
  /** Pre-fetched client detail — avoids re-fetching in downstream consumers like buildRecommendationContext. */
  fetchedClient?: FetchedClientDetail;
}
