/**
 * Service levels for operational cases, and the KPI sets each role is measured
 * on.
 *
 * Two deliberate choices are encoded here as rules, not conventions:
 *  1. Prediction win rate is NEVER an operations KPI. This module does not
 *     import from src/lib/performance/*; the ops-analyst is measured on how the
 *     operation runs (SLA, backlog, data integrity), not on whether the model
 *     won. A test asserts no KPI names or ids reference win/hit rate.
 *  2. Two integrity KPIs carry a hard target of zero — direct database edits
 *     and unsupported-claim rate — because "some" is the wrong number for both.
 */

import type { CaseSeverity, CaseWorkspace } from "@/lib/ops/cases";

export type SlaTarget = { respondMins: number; resolveMins: number };

/**
 * Response and resolution deadlines by workspace and severity. Critical is
 * always tighter than warning is tighter than info; and for equal severity a
 * market-ops case (a mispriced market, a settlement gap) resolves faster than a
 * community case (a spam report), because the market-ops case can move money.
 */
export const SLA_POLICY: Record<CaseWorkspace, Record<CaseSeverity, SlaTarget>> = {
  market_ops: {
    critical: { respondMins: 10, resolveMins: 60 },
    warning: { respondMins: 30, resolveMins: 240 },
    info: { respondMins: 120, resolveMins: 1440 }
  },
  community: {
    critical: { respondMins: 30, resolveMins: 240 },
    warning: { respondMins: 120, resolveMins: 720 },
    info: { respondMins: 240, resolveMins: 2880 }
  }
};

export function slaTarget(workspace: CaseWorkspace, severity: CaseSeverity): SlaTarget {
  return SLA_POLICY[workspace][severity];
}

export function slaDueAt(workspace: CaseWorkspace, severity: CaseSeverity, openedAt: Date): Date {
  return new Date(openedAt.getTime() + slaTarget(workspace, severity).resolveMins * 60_000);
}

export function slaRespondBy(workspace: CaseWorkspace, severity: CaseSeverity, openedAt: Date): Date {
  return new Date(openedAt.getTime() + slaTarget(workspace, severity).respondMins * 60_000);
}

export type SlaClassification = "on_track" | "due_soon" | "breached" | "resolved_in_sla" | "resolved_late";

export type CaseSlaInput = {
  workspace: CaseWorkspace;
  severity: CaseSeverity;
  openedAt: string;
  dueAt: string | null;
  resolvedAt: string | null;
};

/**
 * Classify a case against its SLA. A resolved case is judged once, on whether
 * it beat its deadline — it is never re-flagged as "breached". An unresolved
 * case is breached past the resolution deadline, due_soon once it is past its
 * response window, otherwise on_track. A case with no deadline is never
 * breached (there is nothing to miss).
 */
export function classifyCaseSla(c: CaseSlaInput, now: Date): SlaClassification {
  if (c.resolvedAt) {
    if (!c.dueAt) return "resolved_in_sla";
    return new Date(c.resolvedAt).getTime() <= new Date(c.dueAt).getTime() ? "resolved_in_sla" : "resolved_late";
  }
  if (!c.dueAt) return "on_track";
  if (now.getTime() >= new Date(c.dueAt).getTime()) return "breached";
  const respondBy = slaRespondBy(c.workspace, c.severity, new Date(c.openedAt));
  if (now.getTime() >= respondBy.getTime()) return "due_soon";
  return "on_track";
}

// --------------------------------------------------------------------- KPIs

export type KpiDirection = "higher_is_better" | "lower_is_better";
export type KpiUnit = "percent" | "minutes" | "count" | "ratio";

export type KpiDescriptor = {
  id: string;
  name: string;
  unit: KpiUnit;
  /** The value we are steering toward. null when there is no fixed target. */
  target: number | null;
  direction: KpiDirection;
};

/**
 * Market Ops Analyst KPIs. Operational health only — never the model's win
 * rate. Two carry a hard zero target: an unaudited ("direct") database edit and
 * an unsupported public claim should both never happen.
 */
export const OPS_ANALYST_KPIS: readonly KpiDescriptor[] = [
  { id: "cases_resolved_in_sla", name: "Cases resolved within SLA", unit: "percent", target: 95, direction: "higher_is_better" },
  { id: "median_time_to_resolution", name: "Median time to resolution", unit: "minutes", target: null, direction: "lower_is_better" },
  { id: "open_reconciliation_errors", name: "Open reconciliation errors", unit: "count", target: 0, direction: "lower_is_better" },
  { id: "direct_database_edits", name: "Direct database edits (unaudited)", unit: "count", target: 0, direction: "lower_is_better" },
  { id: "unsupported_claim_rate", name: "Unsupported-claim rate", unit: "percent", target: 0, direction: "lower_is_better" }
] as const;

/**
 * Social/Community Manager KPIs. Community growth counts organic accounts only
 * — demo and staff activity never inflates it, the same exclusion the tipster
 * leaderboard already applies.
 */
export const COMMUNITY_MANAGER_KPIS: readonly KpiDescriptor[] = [
  { id: "moderation_backlog", name: "Open moderation reports", unit: "count", target: null, direction: "lower_is_better" },
  { id: "median_time_to_action", name: "Median time to moderation action", unit: "minutes", target: null, direction: "lower_is_better" },
  { id: "organic_community_growth", name: "Organic community growth (excl. demo/staff)", unit: "percent", target: null, direction: "higher_is_better" },
  { id: "integrity_flagged_accounts", name: "Integrity-flagged accounts", unit: "count", target: 0, direction: "lower_is_better" }
] as const;

export const OPS_KPIS: readonly KpiDescriptor[] = [...OPS_ANALYST_KPIS, ...COMMUNITY_MANAGER_KPIS];
