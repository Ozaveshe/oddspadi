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
import type { CaseCategory } from "@/lib/ops/caseCategories";
import type { CaseRow } from "@/lib/ops/dashboardMetrics";
import { openCasesBySeverity } from "@/lib/ops/dashboardMetrics";
import { classifyCaseSla } from "@/lib/ops/serviceLevels";

const DAY_MS = 24 * 60 * 60_000;

/** Optional external signals the page supplies; null when a source is unread. */
export type HandoverSignals = {
  publicationStatus?: string | null;
  importantFixtures?: number | null;
  providerHealth?: string | null;
  contentScheduled?: number | null;
  moderationBacklog?: number | null;
};

export type HandoverInput = {
  cases: CaseRow[];
  /** Sources that failed to read this run. Non-empty ⇒ the handover is degraded. */
  couldNotRead: string[];
  signals?: HandoverSignals;
};

/** One line of the handover: a labelled figure, null when unread (never a false zero). */
export type HandoverSection = { id: string; label: string; value: number | string | null };

export type Handover = {
  generatedAt: string;
  status: "clear" | "attention" | "degraded";
  degraded: boolean;
  couldNotRead: string[];
  openBySeverity: Record<CaseSeverity, number>;
  breachedNow: number;
  openEscalations: number;
  resolvedLast24h: number;
  sections: HandoverSection[];
};

const TERMINAL = new Set(["resolved", "dismissed"]);

function activeCountByCategory(active: readonly CaseRow[], category: CaseCategory): number {
  return active.filter((c) => c.category === category).length;
}

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

  const s = input.signals ?? {};
  // The structured handover the brief names. Case-derived sections are computed
  // from the board; the rest come from optional signals and are null (unread)
  // when the page did not supply them — never a false zero.
  const sections: HandoverSection[] = [
    { id: "incidents", label: "Incidents (critical, active)", value: active.filter((c) => c.severity === "critical").length },
    { id: "publication_status", label: "Publication status", value: s.publicationStatus ?? null },
    { id: "unresolved_cases", label: "Unresolved cases", value: active.length },
    { id: "important_fixtures", label: "Important fixtures", value: s.importantFixtures ?? null },
    { id: "provider_health", label: "Provider health", value: s.providerHealth ?? null },
    { id: "settlement_backlog", label: "Settlement backlog", value: activeCountByCategory(active, "settlement_exception") },
    { id: "closing_gaps", label: "Closing gaps", value: activeCountByCategory(active, "missing_close") },
    { id: "content_scheduled", label: "Content scheduled", value: s.contentScheduled ?? null },
    {
      id: "moderation_risks",
      label: "Moderation risks",
      value: activeCountByCategory(active, "community_abuse") + (s.moderationBacklog ?? 0)
    }
  ];

  return {
    generatedAt: now.toISOString(),
    status,
    degraded,
    couldNotRead: input.couldNotRead,
    openBySeverity,
    breachedNow,
    openEscalations,
    resolvedLast24h,
    sections
  };
}
