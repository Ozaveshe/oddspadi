import { describe, expect, it } from "vitest";
import {
  median,
  openCasesBySeverity,
  slaCompliancePercent,
  medianTimeToResolutionMins,
  countUnauditedMutations,
  unsupportedClaimRate,
  organicGrowthPercent,
  marketOpsDashboard,
  communityDashboard,
  type CaseRow
} from "@/lib/ops/dashboardMetrics";
import { slaDueAt } from "@/lib/ops/serviceLevels";

const OPENED = new Date("2026-08-09T10:00:00.000Z");
const NOW = new Date("2026-08-09T13:00:00.000Z");

function marketCase(partial: Partial<CaseRow>): CaseRow {
  return {
    workspace: "market_ops",
    severity: "warning",
    state: "open",
    openedAt: OPENED.toISOString(),
    dueAt: slaDueAt("market_ops", "warning", OPENED).toISOString(),
    resolvedAt: null,
    ...partial
  };
}

describe("primitives", () => {
  it("takes an odd and even median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("counts only non-terminal cases by severity", () => {
    const cases = [
      marketCase({ severity: "critical" }),
      marketCase({ severity: "critical", state: "resolved", resolvedAt: NOW.toISOString() }),
      marketCase({ severity: "warning", state: "in_progress" })
    ];
    expect(openCasesBySeverity(cases)).toEqual({ critical: 1, warning: 1, info: 0 });
  });
});

describe("SLA rollups", () => {
  it("computes compliance only over resolved cases", () => {
    const cases = [
      // resolved in SLA (+120m < 240m)
      marketCase({ state: "resolved", resolvedAt: "2026-08-09T12:00:00.000Z" }),
      // resolved late (+300m > 240m)
      marketCase({ state: "resolved", resolvedAt: "2026-08-09T15:00:00.000Z" }),
      // still open — excluded from the denominator
      marketCase({ state: "in_progress" })
    ];
    expect(slaCompliancePercent(cases, NOW)).toBe(50);
    expect(slaCompliancePercent([marketCase({})], NOW)).toBeNull();
  });

  it("takes the median resolution time in minutes", () => {
    const cases = [
      marketCase({ state: "resolved", resolvedAt: "2026-08-09T10:30:00.000Z" }), // 30m
      marketCase({ state: "resolved", resolvedAt: "2026-08-09T11:30:00.000Z" }) // 90m
    ];
    expect(medianTimeToResolutionMins(cases)).toBe(60);
  });
});

describe("integrity metrics", () => {
  it("counts a governed mutation with no matching audit row as a direct edit", () => {
    const mutations = [
      { target: "publication:1", at: "2026-08-09T10:00:00.000Z" },
      { target: "publication:2", at: "2026-08-09T11:00:00.000Z" }
    ];
    const audits = [{ target: "publication:1", at: "2026-08-09T10:03:00.000Z" }];
    expect(countUnauditedMutations(mutations, audits)).toBe(1);
    // Every mutation audited → zero direct edits.
    expect(
      countUnauditedMutations([mutations[0]], [{ target: "publication:1", at: "2026-08-09T10:01:00.000Z" }])
    ).toBe(0);
  });

  it("does not credit an audit row outside the time window", () => {
    const mutations = [{ target: "settlement:9", at: "2026-08-09T10:00:00.000Z" }];
    const audits = [{ target: "settlement:9", at: "2026-08-09T10:30:00.000Z" }]; // 30m > 10m window
    expect(countUnauditedMutations(mutations, audits)).toBe(1);
  });

  it("returns null for an unsupported-claim rate over zero attempts", () => {
    expect(unsupportedClaimRate(0, 0)).toBeNull();
    expect(unsupportedClaimRate(2, 10)).toBe(20);
  });

  it("measures organic growth ignoring demo and staff cohorts", () => {
    const previous = { organic: 100, demo: 7, staff: 1 };
    const current = { organic: 110, demo: 999, staff: 50 }; // demo/staff surged — must not count
    expect(organicGrowthPercent(current, previous)).toBeCloseTo(10);
    // A zero organic base is not "infinite growth".
    expect(organicGrowthPercent({ organic: 5 }, { organic: 0, demo: 3 })).toBeNull();
  });
});

describe("composed dashboards", () => {
  it("builds a market-ops dashboard without any win-rate field", () => {
    const dash = marketOpsDashboard({
      cases: [marketCase({ severity: "critical" })],
      now: NOW,
      openReconciliationErrors: 1,
      identityFailures: 0,
      settlementLagMins: 30,
      closingLineCoveragePercent: 95,
      governedMutations: [{ target: "publication:2", at: "2026-08-09T11:00:00.000Z" }],
      auditRows: [],
      editorial: { blocked: 0, total: 40 }
    });
    expect(dash.openBySeverity.critical).toBe(1);
    expect(dash.reconciliationErrors.status).toBe("page"); // any is page (warn=page=1)
    expect(dash.closingLineCoverage.status).toBe("ok"); // 95 >= 90
    expect(dash.directDatabaseEdits).toBe(1);
    expect(dash.unsupportedClaimRate).toBe(0);
    expect(Object.keys(dash)).not.toContain("winRate");
    expect(Object.keys(dash)).not.toContain("hitRate");
  });

  it("builds a community dashboard with organic-only growth", () => {
    const dash = communityDashboard({
      moderationBacklog: 25,
      actionDurations: [
        { start: "2026-08-09T10:00:00.000Z", end: "2026-08-09T10:20:00.000Z" },
        { start: "2026-08-09T10:00:00.000Z", end: "2026-08-09T10:40:00.000Z" }
      ],
      currentCohort: { organic: 120, demo: 500 },
      previousCohort: { organic: 100, demo: 3 },
      integrityFlaggedAccounts: 2
    });
    expect(dash.moderationBacklog.status).toBe("warn"); // 25 >= 20 warn, < 100 page
    expect(dash.medianTimeToActionMins).toBe(30);
    expect(dash.organicGrowthPercent).toBeCloseTo(20);
    expect(dash.integrityFlaggedAccounts).toBe(2);
  });
});
