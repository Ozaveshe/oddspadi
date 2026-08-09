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
});
