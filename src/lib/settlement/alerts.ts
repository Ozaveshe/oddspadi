/**
 * Settlement and closing-price alerts.
 *
 * Derived at read time from the exception queue and the SLA thresholds, never
 * stored. A persisted alert ledger can disagree with the exceptions it
 * describes; a derived alert cannot outlive the condition that caused it.
 *
 * Follows the `reconcile-truth` contract, including the rule that matters most:
 * **it never reports zero on failure.** An unreadable source is a finding of
 * its own. That rule was written after the first draft of that script wrapped
 * its reads in `.catch(() => [])` and duly announced "0 projections" against a
 * store holding six — a green light produced by a broken query.
 */

export type AlertSeverity = "critical" | "warning";

export type AlertId =
  | "result-unverified-sla"
  | "pick-unsettled-sla"
  | "close-missing-near-cutoff"
  | "result-conflict"
  | "settlement-correction"
  | "mass-void"
  | "provider-result-lag";

export type Alert = {
  id: AlertId;
  severity: AlertSeverity;
  count: number;
  detail: string;
};

export const SLA = {
  /** Terminal for this long without verification is a problem, not a delay. */
  resultUnverifiedHours: 3,
  /** Verified this long ago with the pick still unsettled. */
  pickUnsettledHours: 1,
  /** Kickoff this close with depth still short. */
  closeMissingMinutes: 30,
  /** Void share above this, over a sample of at least massVoidMinSample. */
  massVoidShare: 0.15,
  massVoidMinSample: 10,
  /** Median minutes from final whistle to first observation. */
  providerLagMinutes: 90
} as const;

export type AlertInputs = {
  /** Fixtures terminal beyond the SLA and still not verified. */
  unverifiedBeyondSla: number;
  /** Published picks whose result is verified but which remain unsettled. */
  unsettledBeyondSla: number;
  /** Eligible picks near kickoff whose closing depth is below the minimum. */
  closeMissingNearCutoff: number;
  /** Open result_conflict exceptions. */
  openResultConflicts: number;
  /** Verdicts superseded in the last 24 hours. */
  correctionsLast24h: number;
  /** Settlements in the last 24 hours, and how many of them voided. */
  settlementsLast24h: number;
  voidsLast24h: number;
  /** Median minutes from final whistle to first observation over 24 hours. */
  medianProviderLagMinutes: number | null;
};

/**
 * A source that could not be read.
 *
 * Carried separately from the alerts because it is not an alert — it is the
 * absence of the evidence an alert would be drawn from, and the two must not be
 * reported in the same list where a reader could mistake "no findings" for "no
 * data".
 */
export type UnreadableSource = { source: string; error: string };

export type AlertReport = {
  generatedAt: string;
  alerts: Alert[];
  couldNotCheck: UnreadableSource[];
  /** 0 clean, 1 critical findings, 2 could not complete. */
  exitCode: 0 | 1 | 2;
};

export function buildAlertReport(
  inputs: AlertInputs,
  couldNotCheck: UnreadableSource[],
  now: Date
): AlertReport {
  const alerts: Alert[] = [];

  if (inputs.unverifiedBeyondSla > 0) {
    alerts.push({
      id: "result-unverified-sla",
      severity: "critical",
      count: inputs.unverifiedBeyondSla,
      detail: `${inputs.unverifiedBeyondSla} fixture(s) terminal for over ${SLA.resultUnverifiedHours}h and still unverified.`
    });
  }

  if (inputs.unsettledBeyondSla > 0) {
    alerts.push({
      id: "pick-unsettled-sla",
      severity: "critical",
      count: inputs.unsettledBeyondSla,
      detail: `${inputs.unsettledBeyondSla} published pick(s) unsettled over ${SLA.pickUnsettledHours}h after their result was verified.`
    });
  }

  if (inputs.openResultConflicts > 0) {
    alerts.push({
      id: "result-conflict",
      severity: "critical",
      count: inputs.openResultConflicts,
      detail: `${inputs.openResultConflicts} open result conflict(s). No claim on these fixtures can settle.`
    });
  }

  if (inputs.closeMissingNearCutoff > 0) {
    alerts.push({
      id: "close-missing-near-cutoff",
      severity: "warning",
      count: inputs.closeMissingNearCutoff,
      detail: `${inputs.closeMissingNearCutoff} eligible pick(s) within ${SLA.closeMissingMinutes} minutes of kickoff with closing depth below the minimum.`
    });
  }

  if (inputs.correctionsLast24h > 0) {
    alerts.push({
      id: "settlement-correction",
      severity: "warning",
      count: inputs.correctionsLast24h,
      detail: `${inputs.correctionsLast24h} settlement verdict(s) superseded in the last 24h.`
    });
  }

  // Guarded by a minimum sample, because three voids out of four is a quiet
  // Tuesday and not an incident.
  if (inputs.settlementsLast24h >= SLA.massVoidMinSample) {
    const share = inputs.voidsLast24h / inputs.settlementsLast24h;
    if (share > SLA.massVoidShare) {
      alerts.push({
        id: "mass-void",
        severity: "critical",
        count: inputs.voidsLast24h,
        detail: `${(share * 100).toFixed(1)}% of ${inputs.settlementsLast24h} settlements voided in 24h, above the ${(SLA.massVoidShare * 100).toFixed(0)}% threshold. Check for a fixture-status defect before accepting these.`
      });
    }
  }

  if (inputs.medianProviderLagMinutes !== null && inputs.medianProviderLagMinutes > SLA.providerLagMinutes) {
    alerts.push({
      id: "provider-result-lag",
      severity: "warning",
      count: Math.round(inputs.medianProviderLagMinutes),
      detail: `Median ${Math.round(inputs.medianProviderLagMinutes)} minutes from final whistle to first observation, above ${SLA.providerLagMinutes}.`
    });
  }

  // Could-not-check outranks everything. A run that could not read its sources
  // has no basis for saying anything is clean, and reporting exit 1 would imply
  // it found something rather than that it found nothing out.
  const exitCode: 0 | 1 | 2 =
    couldNotCheck.length > 0 ? 2 : alerts.some((alert) => alert.severity === "critical") ? 1 : 0;

  return { generatedAt: now.toISOString(), alerts, couldNotCheck, exitCode };
}
