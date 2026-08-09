/**
 * Role dashboard aggregators — pure functions over pre-fetched rows.
 *
 * They compose the observability registry (classifyMetric) and the service
 * levels (classifyCaseSla) so a dashboard states one number once, with the same
 * thresholds the runbook documents. Three honesty rules live here:
 *   - Community growth counts organic accounts only; demo/staff never inflate it.
 *   - "Direct database edits" is the count of governed mutations with no audit
 *     row — a conservative floor (it can only see mutations the audit trail and
 *     reconcilers surface; a silent edit to an unwatched table is invisible).
 *   - A rate over zero attempts is null (unknown), never a satisfied zero.
 */

import type { CaseSeverity, CaseState, CaseWorkspace } from "@/lib/ops/cases";
import { classifyCaseSla } from "@/lib/ops/serviceLevels";
import { classifyMetric } from "@/lib/observability/metrics";

export type CaseRow = {
  workspace: CaseWorkspace;
  severity: CaseSeverity;
  state: CaseState;
  openedAt: string;
  dueAt: string | null;
  resolvedAt: string | null;
};

export type MetricReading = { value: number | null; status: "ok" | "warn" | "page" | "unknown" };

function reading(id: string, value: number | null): MetricReading {
  return { value, status: classifyMetric(id, value) };
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

const SEVERITIES: CaseSeverity[] = ["critical", "warning", "info"];
const TERMINAL: CaseState[] = ["resolved", "dismissed"];

export function openCasesBySeverity(cases: CaseRow[]): Record<CaseSeverity, number> {
  const out: Record<CaseSeverity, number> = { critical: 0, warning: 0, info: 0 };
  for (const c of cases) {
    if (!TERMINAL.includes(c.state)) out[c.severity] += 1;
  }
  return out;
}

/** Of the cases that reached resolution, the share that beat their SLA. Null when none resolved. */
export function slaCompliancePercent(cases: CaseRow[], now: Date): number | null {
  let inSla = 0;
  let resolved = 0;
  for (const c of cases) {
    if (!c.resolvedAt) continue;
    resolved += 1;
    if (classifyCaseSla(c, now) === "resolved_in_sla") inSla += 1;
  }
  return resolved === 0 ? null : (inSla / resolved) * 100;
}

export function medianTimeToResolutionMins(cases: CaseRow[]): number | null {
  const durations = cases
    .filter((c) => c.resolvedAt)
    .map((c) => (new Date(c.resolvedAt as string).getTime() - new Date(c.openedAt).getTime()) / 60_000);
  return median(durations);
}

export function medianDurationMins(pairs: { start: string; end: string }[]): number | null {
  return median(pairs.map((p) => (new Date(p.end).getTime() - new Date(p.start).getTime()) / 60_000));
}

// --------------------------------------------------------- integrity metrics

export type GovernedMutation = { target: string; at: string };
export type AuditRow = { target: string; at: string };
const AUDIT_WINDOW_MS = 10 * 60_000;

/**
 * Count governed mutations with no audit row for the same target within the
 * window. Zero is the target: every governed mutation should have gone through
 * an audited path. Conservative by design — a target with any nearby audit row
 * is treated as explained, so this under-counts rather than false-alarms.
 */
export function countUnauditedMutations(mutations: GovernedMutation[], audits: AuditRow[]): number {
  let unaudited = 0;
  for (const m of mutations) {
    const t = new Date(m.at).getTime();
    const explained = audits.some(
      (a) => a.target === m.target && Math.abs(new Date(a.at).getTime() - t) <= AUDIT_WINDOW_MS
    );
    if (!explained) unaudited += 1;
  }
  return unaudited;
}

/** Blocked-claim share of generation attempts. Null over zero attempts — unknown, not a satisfied zero. */
export function unsupportedClaimRate(blocked: number, total: number): number | null {
  if (total <= 0) return null;
  return (blocked / total) * 100;
}

export type CohortCounts = Record<string, number>;

/**
 * Period-over-period growth of organic accounts only. Demo, staff and system
 * cohorts are ignored entirely. Null when the base period had no organic
 * accounts (a rate off a zero base is meaningless, not "infinite growth").
 */
export function organicGrowthPercent(current: CohortCounts, previous: CohortCounts): number | null {
  const now = current.organic ?? 0;
  const before = previous.organic ?? 0;
  if (before <= 0) return null;
  return ((now - before) / before) * 100;
}

// --------------------------------------------------------------- dashboards

export type MarketOpsDashboardInput = {
  cases: CaseRow[];
  now: Date;
  openReconciliationErrors: number;
  identityFailures: number;
  settlementLagMins: number | null;
  closingLineCoveragePercent: number | null;
  governedMutations: GovernedMutation[];
  auditRows: AuditRow[];
  editorial: { blocked: number; total: number };
};

export type MarketOpsDashboard = {
  openBySeverity: Record<CaseSeverity, number>;
  slaCompliancePercent: number | null;
  medianTimeToResolutionMins: number | null;
  reconciliationErrors: MetricReading;
  identityFailures: MetricReading;
  settlementLag: MetricReading;
  closingLineCoverage: MetricReading;
  directDatabaseEdits: number;
  unsupportedClaimRate: number | null;
};

export function marketOpsDashboard(input: MarketOpsDashboardInput): MarketOpsDashboard {
  return {
    openBySeverity: openCasesBySeverity(input.cases),
    slaCompliancePercent: slaCompliancePercent(input.cases, input.now),
    medianTimeToResolutionMins: medianTimeToResolutionMins(input.cases),
    reconciliationErrors: reading("reconciliation_errors", input.openReconciliationErrors),
    identityFailures: reading("identity_failures", input.identityFailures),
    settlementLag: reading("settlement_lag", input.settlementLagMins),
    closingLineCoverage: reading("closing_line_coverage", input.closingLineCoveragePercent),
    directDatabaseEdits: countUnauditedMutations(input.governedMutations, input.auditRows),
    unsupportedClaimRate: unsupportedClaimRate(input.editorial.blocked, input.editorial.total)
  };
}

export type CommunityDashboardInput = {
  moderationBacklog: number;
  actionDurations: { start: string; end: string }[];
  currentCohort: CohortCounts;
  previousCohort: CohortCounts;
  integrityFlaggedAccounts: number;
};

export type CommunityDashboard = {
  moderationBacklog: MetricReading;
  medianTimeToActionMins: number | null;
  organicGrowthPercent: number | null;
  integrityFlaggedAccounts: number;
};

export function communityDashboard(input: CommunityDashboardInput): CommunityDashboard {
  return {
    moderationBacklog: reading("moderation_backlog", input.moderationBacklog),
    medianTimeToActionMins: medianDurationMins(input.actionDurations),
    organicGrowthPercent: organicGrowthPercent(input.currentCohort, input.previousCohort),
    integrityFlaggedAccounts: input.integrityFlaggedAccounts
  };
}
