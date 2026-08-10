import { describe, expect, it } from "vitest";
import { buildHandover } from "@/lib/ops/handover";
import type { CaseRow } from "@/lib/ops/dashboardMetrics";
import { slaDueAt } from "@/lib/ops/serviceLevels";

const NOW = new Date("2026-08-09T13:00:00.000Z");

function c(partial: Partial<CaseRow>): CaseRow {
  const opened = partial.openedAt ?? "2026-08-09T12:30:00.000Z";
  return {
    workspace: "market_ops",
    severity: "warning",
    state: "open",
    openedAt: opened,
    dueAt: slaDueAt("market_ops", "warning", new Date(opened)).toISOString(),
    resolvedAt: null,
    ...partial
  };
}

describe("buildHandover", () => {
  it("summarises open severity, breaches, escalations and last-24h resolutions", () => {
    const cases: CaseRow[] = [
      c({ severity: "critical", state: "in_progress" }),
      // opened 10h ago at critical (60m SLA) → breached
      c({ severity: "critical", state: "open", openedAt: "2026-08-09T03:00:00.000Z" }),
      c({ state: "escalated" }),
      // resolved 2h ago
      c({ state: "resolved", resolvedAt: "2026-08-09T11:00:00.000Z" }),
      // resolved 3 days ago — outside the 24h window
      c({ state: "resolved", resolvedAt: "2026-08-06T11:00:00.000Z" })
    ];
    const h = buildHandover({ cases, couldNotRead: [] }, NOW);
    expect(h.openBySeverity.critical).toBe(2);
    expect(h.openEscalations).toBe(1);
    expect(h.breachedNow).toBe(1);
    expect(h.resolvedLast24h).toBe(1);
    expect(h.status).toBe("attention");
    expect(h.degraded).toBe(false);
  });

  it("is clear when nothing is open, breached or escalated", () => {
    const h = buildHandover({ cases: [c({ state: "resolved", resolvedAt: "2026-08-01T00:00:00.000Z" })], couldNotRead: [] }, NOW);
    expect(h.status).toBe("clear");
    expect(h.breachedNow).toBe(0);
  });

  it("reports degraded, not zeros, when a source could not be read", () => {
    const h = buildHandover({ cases: [], couldNotRead: ["op_operational_cases"] }, NOW);
    expect(h.degraded).toBe(true);
    expect(h.status).toBe("degraded");
    expect(h.couldNotRead).toContain("op_operational_cases");
  });

  it("builds the structured handover sections from cases and optional signals", () => {
    const cases: CaseRow[] = [
      c({ category: "settlement_exception", state: "open" }),
      c({ category: "missing_close", state: "in_progress" }),
      c({ category: "community_abuse", state: "open", workspace: "community" }),
      c({ severity: "critical", state: "in_progress", category: "provider_outage" })
    ];
    const h = buildHandover({ cases, couldNotRead: [], signals: { moderationBacklog: 5, publicationStatus: null } }, NOW);
    const byId = Object.fromEntries(h.sections.map((s) => [s.id, s.value]));
    // The brief's nine sections are all present.
    for (const id of [
      "incidents",
      "publication_status",
      "unresolved_cases",
      "important_fixtures",
      "provider_health",
      "settlement_backlog",
      "closing_gaps",
      "content_scheduled",
      "moderation_risks"
    ]) {
      expect(Object.keys(byId), `missing section ${id}`).toContain(id);
    }
    expect(byId.settlement_backlog).toBe(1);
    expect(byId.closing_gaps).toBe(1);
    expect(byId.incidents).toBe(1); // one critical active case
    // community_abuse case (1) + moderationBacklog signal (5).
    expect(byId.moderation_risks).toBe(6);
    // An unread signal renders null, never a false zero.
    expect(byId.publication_status).toBeNull();
    expect(byId.provider_health).toBeNull();
  });
});
