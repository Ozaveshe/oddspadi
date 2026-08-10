/**
 * Role dashboard tiles — the full named metric set each role home shows.
 *
 * The brief enumerates eight operations metrics and seven community metrics.
 * This module assembles every one of them as a labelled tile with its target,
 * pulling the value from what the page can cheaply and safely compute and
 * rendering `null` (→ "—") for a metric that is named and targeted but not yet
 * instrumented. A named-but-unmeasured metric shows honestly as unknown, never
 * as a false zero — the same rule the rest of the ops surface follows.
 */

import { serviceTarget } from "@/lib/ops/serviceTargets";
import { classifyMetric } from "@/lib/observability/metrics";

export type OpsTile = {
  label: string;
  value: number | string | null;
  unit?: string;
  status?: "ok" | "warn" | "page" | "unknown";
  target?: number | null;
};

function targetFor(id: string): number | null {
  return serviceTarget(id, process.env)?.target ?? null;
}

export type MarketTileInputs = {
  openCritical: number;
  reconciliationErrorsOpen: number | null;
  reconciliationComplete: boolean | null;
  staleCardRatePercent?: number | null;
  verifiedResultDelayMins?: number | null;
  settlementDelayMins?: number | null;
  closingLineCoveragePercent?: number | null;
  mappingAccuracyPercent?: number | null;
  directDatabaseEdits?: number | null;
};

/** The eight operations metrics the brief names, in order. */
export function buildMarketTiles(i: MarketTileInputs): OpsTile[] {
  return [
    { label: "Stale-card rate", value: i.staleCardRatePercent ?? null, unit: "%", target: targetFor("stale_card_rate") },
    { label: "Verified-result SLA", value: i.verifiedResultDelayMins ?? null, unit: " min", target: targetFor("result_verification_delay") },
    { label: "Settlement SLA", value: i.settlementDelayMins ?? null, unit: " min", target: targetFor("settlement_delay") },
    {
      label: "Closing-price coverage",
      value: i.closingLineCoveragePercent ?? null,
      unit: "%",
      status: classifyMetric("closing_line_coverage", i.closingLineCoveragePercent ?? null),
      target: targetFor("closing_price_coverage")
    },
    { label: "Mapping accuracy", value: i.mappingAccuracyPercent ?? null, unit: "%", target: null },
    { label: "Unresolved high-priority cases", value: i.openCritical, target: 0 },
    { label: "Direct database edits", value: i.directDatabaseEdits ?? null, status: i.directDatabaseEdits == null ? "unknown" : undefined, target: 0 },
    {
      label: "Reconciliation completion",
      value: i.reconciliationComplete === null ? null : i.reconciliationComplete ? "complete" : "incomplete",
      status: i.reconciliationErrorsOpen == null ? "unknown" : classifyMetric("reconciliation_errors", i.reconciliationErrorsOpen)
    }
  ];
}

export type CommunityTileInputs = {
  moderationBacklog: number | null;
  canonicalContentUsagePercent?: number | null;
  correctionRatePercent?: number | null;
  unsupportedClaimRatePercent?: number | null;
  referralTraffic?: number | null;
  responseTimeMins?: number | null;
  organicGrowthPercent?: number | null;
};

/** The seven community metrics the brief names, in order. */
export function buildCommunityTiles(i: CommunityTileInputs): OpsTile[] {
  return [
    { label: "Canonical-content usage", value: i.canonicalContentUsagePercent ?? null, unit: "%", target: null },
    { label: "Correction rate", value: i.correctionRatePercent ?? null, unit: "%", target: null },
    { label: "Unsupported-claim rate", value: i.unsupportedClaimRatePercent ?? null, unit: "%", status: i.unsupportedClaimRatePercent == null ? "unknown" : undefined, target: 0 },
    { label: "Referral traffic", value: i.referralTraffic ?? null, target: null },
    { label: "Response time", value: i.responseTimeMins ?? null, unit: " min", target: targetFor("community_report_response") },
    {
      label: "Moderation backlog",
      value: i.moderationBacklog,
      status: classifyMetric("moderation_backlog", i.moderationBacklog),
      target: null
    },
    { label: "Community growth (excl. demo/staff)", value: i.organicGrowthPercent ?? null, unit: "%", target: null }
  ];
}
