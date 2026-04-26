/**
 * OC investment-process Q&A bank loader.
 *
 * Mirrors the `fund-qa` pattern: pre-scripted answers live in
 * `data/process-qa.json` (one row per topic) so they can be reviewed
 * and edited as data, not code. This module bundles the JSON via Next's
 * import resolver, narrows the types, and exposes typed accessors for
 * the intent layer + narration template + UI.
 *
 * The `ProcessTopicId` union below is the contract — the runtime check
 * at module load asserts that the JSON shape matches. Adding a new
 * topic means: (1) add to the JSON, (2) add to the union here,
 * (3) restart. TypeScript will then flag every site that needs to
 * handle the new value.
 */
import bank from "@/data/process-qa.json";

export const PROCESS_TOPIC_IDS = [
  "philosophy",
  "style",
  "universe",
  "research",
  "stock_selection",
  "portfolio_construction",
  "risk_management",
  "esg",
  "corporate_governance",
  "transaction_costs",
  "tax",
  "team",
] as const;
export type ProcessTopicId = (typeof PROCESS_TOPIC_IDS)[number];

interface ProcessQaBank {
  lastUpdated: string;
  topicLabels: Record<ProcessTopicId, string>;
  answers: Record<ProcessTopicId, string>;
}

const TYPED_BANK = bank as unknown as ProcessQaBank;

// Module-load assertion — bidirectional. Fails loud at boot if either
// side drifts: a TS-declared topic missing from the JSON, OR a
// JSON-declared topic not reflected in the union here. Both directions
// matter because either silently breaks lookups: a missing JSON entry
// would throw at narration time; an unknown JSON entry would be
// unreachable from the matcher and never spoken.
for (const topic of PROCESS_TOPIC_IDS) {
  if (!TYPED_BANK.topicLabels[topic]) {
    throw new Error(`process-qa.json: missing topicLabel for "${topic}"`);
  }
  if (!TYPED_BANK.answers[topic]) {
    throw new Error(`process-qa.json: missing answer for "${topic}"`);
  }
}
for (const topic of Object.keys(TYPED_BANK.answers)) {
  if (!isProcessTopicId(topic)) {
    throw new Error(
      `process-qa.json: unknown topic "${topic}" — add it to PROCESS_TOPIC_IDS in src/screen/process-qa.ts`
    );
  }
}
for (const topic of Object.keys(TYPED_BANK.topicLabels)) {
  if (!isProcessTopicId(topic)) {
    throw new Error(
      `process-qa.json: unknown topicLabel "${topic}" — add it to PROCESS_TOPIC_IDS in src/screen/process-qa.ts`
    );
  }
}

export function isProcessTopicId(s: string): s is ProcessTopicId {
  return (PROCESS_TOPIC_IDS as readonly string[]).includes(s);
}

export function getProcessAnswer(topic: ProcessTopicId): string {
  return TYPED_BANK.answers[topic];
}

export function getProcessTopicLabel(topic: ProcessTopicId): string {
  return TYPED_BANK.topicLabels[topic];
}
