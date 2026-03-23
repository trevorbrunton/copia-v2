/**
 * Types for the LLM reasoning layer (PoC 2).
 *
 * The reasoning service takes MatchResult from the scoring engine and produces
 * an LLMRecommendation with caregiver selection, escalation decision, and
 * natural language explanation.
 */

/** LLM recommendation output — structured JSON from the reasoning service. */
export interface LLMRecommendation {
  /** Top recommended caregiver with explanation */
  primary: {
    employee_id: number;
    employee_name: string;
    explanation: string;
    confidence: "high" | "medium" | "low";
  };

  /** Whether this scenario should be escalated to a human */
  escalation: {
    should_escalate: boolean;
    reason: string | null;
    urgency: "immediate" | "before_shift" | "informational";
  };

  /** Factors the LLM considered */
  factors_considered: string[];

  /** Trade-offs identified */
  trade_offs: string[];

  /** LLM usage metadata */
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** The JSON shape the LLM is asked to produce (without metadata fields). */
export interface LLMResponsePayload {
  primary: {
    employee_id: number;
    employee_name: string;
    explanation: string;
    confidence: "high" | "medium" | "low";
  };
  escalation: {
    should_escalate: boolean;
    reason: string | null;
    urgency: "immediate" | "before_shift" | "informational";
  };
  factors_considered: string[];
  trade_offs: string[];
}

/** Minimal visit context needed by the reasoning prompt. */
export interface VisitContext {
  id: number;
  start_at: string;
  end_at: string;
  status: string;
  service_instructions?: string | null;
}

/** Minimal client context needed by the reasoning prompt. */
export interface ClientContext {
  first_name: string;
  last_name: string;
  city?: string | null;
  state?: string | null;
  care_needs?: string | null;
}

/** Task-level context for the reasoning prompt. */
export interface ReasoningContext {
  urgency: "planned" | "urgent";
}

/** PoC 2 scenario classification for evaluation. */
export type ScenarioClassification =
  | "straightforward"
  | "ambiguous"
  | "edge_case"
  | "constraint_violation";

/** Human decision baseline for a scenario. */
export interface HumanBaseline {
  id: string;
  classification: ScenarioClassification;
  /** What an experienced rostering staff member would decide */
  human_decision: string;
  /** Should this be escalated? */
  should_escalate: boolean;
  /** Why the human would make this decision */
  rationale: string;
}
