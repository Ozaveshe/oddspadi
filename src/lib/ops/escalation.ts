/**
 * Escalation paths — the defined routes a case takes when it outgrows the
 * workspace. The point of naming them is that a staff member escalates a defect
 * *through the product*, to a known owner, with an audit trail — never through
 * an informal message or a direct database edit.
 */

import type { CaseSeverity } from "@/lib/ops/cases";
import type { CaseCategory } from "@/lib/ops/caseCategories";

export type EscalationPath = {
  id: string;
  name: string;
  trigger: string;
  /** Who the case routes to. A role, never a named person. */
  target: string;
  /** Escalating on this path raises the case to at least this severity. */
  minimumSeverity: CaseSeverity;
};

export const ESCALATION_PATHS: readonly EscalationPath[] = [
  {
    id: "security",
    name: "Security",
    trigger: "credential exposure, auth bypass, injection, suspected intrusion",
    target: "Security lead + engineering on-call",
    minimumSeverity: "critical"
  },
  {
    id: "data_corruption",
    name: "Suspected data corruption",
    trigger: "immutable-record mismatch, ledger anomaly, unexplained mass state change",
    target: "Data-integrity owner — stop writes, get a second reviewer",
    minimumSeverity: "critical"
  },
  {
    id: "legal_community_safety",
    name: "Legal / community safety",
    trigger: "illegal content, threats, minors, defamation, regulated-market exposure",
    target: "Legal/compliance + community lead",
    minimumSeverity: "critical"
  },
  {
    id: "mass_provider_failure",
    name: "Mass provider failure",
    trigger: "an upstream provider is down or wrong at scale",
    target: "Market-ops lead + engineering on-call",
    minimumSeverity: "critical"
  },
  {
    id: "model_contradiction",
    name: "Model contradiction",
    trigger: "a public surface contradicts the model or itself",
    target: "Modelling owner + editorial",
    minimumSeverity: "warning"
  },
  {
    id: "public_record_correction",
    name: "Public-record correction",
    trigger: "a published pick or track-record figure is wrong",
    target: "Publication owner — append a correction, never edit the record",
    minimumSeverity: "warning"
  }
];

export function isEscalationPath(value: unknown): value is string {
  return typeof value === "string" && ESCALATION_PATHS.some((p) => p.id === value);
}

export function escalationPath(id: string): EscalationPath | null {
  return ESCALATION_PATHS.find((p) => p.id === id) ?? null;
}

/**
 * The default escalation path suggested for a case category, or null when a
 * category has no automatic route (the analyst chooses). Never guesses a path
 * that would misroute — an unmapped category returns null rather than a wrong owner.
 */
export function escalationPathForCategory(category: CaseCategory | null): string | null {
  switch (category) {
    case "identity_mismatch":
    case "record_mismatch":
      return "data_corruption";
    case "provider_outage":
      return "mass_provider_failure";
    case "community_abuse":
      return "legal_community_safety";
    case "result_conflict":
    case "settlement_exception":
    case "content_error":
      return "public_record_correction";
    default:
      return null;
  }
}
