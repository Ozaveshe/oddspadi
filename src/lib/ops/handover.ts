/**
 * Daily handover — the read a staff member starts a shift with.
 *
 * It answers: what is open and how bad, what has breached its SLA, what is
 * escalated, and what closed since yesterday. Crucially it reports honestly
 * when a source could not be read: a handover that shows zeros because the
 * query failed would send someone home thinking the queue was clear. A degraded
 * read is a degraded handover, never a clean one.
 */

import type { CaseSeverity } from "@/lib/ops/cases";
import type { CaseRow } from "@/lib/ops/dashboardMetrics";
import { openCasesBySeverity } from "@/lib/ops/dashboardMetrics";
import { classifyCaseSla } from "@/lib/ops/serviceLevels";

const DAY_MS = 24 * 60 * 60_000;

export type HandoverInput = {
  cases: CaseRow[];
  /** Sources that failed to read this run. Non-empty ⇒ the handover is degraded. */
  couldNotRead: string[];
};

export type Handover = {
  generatedAt: string;
  status: "clear" | "attention" | "degraded";
  degraded: boolean;
  couldNotRead: string[];
  openBySeverity: Record<CaseSeverity, number>;
  breachedNow: number;
  openEscalations: number;
  resolvedLast24h: number;
};

const TERMINAL = new Set(["resolved", "dismissed"]);

export function buildHandover(input: HandoverInput, now: Date): Handover {
  const active = input.cases.filter((c) => !TERMINAL.has(c.state));

  const breachedNow = active.filter(
    (c) =>
      classifyCaseSla(
        { workspace: c.workspace, severity: c.severity, openedAt: c.openedAt, dueAt: c.dueAt, resolvedAt: null },
        now
      ) === "breached"
  ).length;

  const openEscalations = active.filter((c) => c.state === "escalated").length;

  const resolvedLast24h = input.cases.filter(
    (c) => c.resolvedAt && now.getTime() - new Date(c.resolvedAt).getTime() <= DAY_MS
  ).length;

  const openBySeverity = openCasesBySeverity(input.cases);
  const degraded = input.couldNotRead.length > 0;

  const status: Handover["status"] = degraded
    ? "degraded"
    : breachedNow > 0 || openEscalations > 0 || openBySeverity.critical > 0
      ? "attention"
      : "clear";

  return {
    generatedAt: now.toISOString(),
    status,
    degraded,
    couldNotRead: input.couldNotRead,
    openBySeverity,
    breachedNow,
    openEscalations,
    resolvedLast24h
  };
}
