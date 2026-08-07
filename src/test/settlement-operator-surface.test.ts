import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildAlertReport, SLA, type AlertInputs } from "@/lib/settlement/alerts";
import { decideApproval, impactToken, reviewRequirements, type MappingImpact } from "@/lib/markets/impact";
import type { MarketAlias } from "@/lib/markets/alias";

const NOW = new Date("2026-08-07T18:00:00.000Z");

function inputs(overrides: Partial<AlertInputs> = {}): AlertInputs {
  return {
    unverifiedBeyondSla: 0,
    unsettledBeyondSla: 0,
    closeMissingNearCutoff: 0,
    openResultConflicts: 0,
    correctionsLast24h: 0,
    settlementsLast24h: 0,
    voidsLast24h: 0,
    medianProviderLagMinutes: null,
    ...overrides
  };
}

describe("alerts", () => {
  it("is clean and exits 0 with nothing wrong", () => {
    const report = buildAlertReport(inputs(), [], NOW);
    expect(report.alerts).toEqual([]);
    expect(report.exitCode).toBe(0);
  });

  it("exits 1 on a critical finding and 0 on a warning alone", () => {
    expect(buildAlertReport(inputs({ unverifiedBeyondSla: 2 }), [], NOW).exitCode).toBe(1);
    expect(buildAlertReport(inputs({ correctionsLast24h: 2 }), [], NOW).exitCode).toBe(0);
  });

  it("never reports zero on failure", () => {
    // The defect this rule was written for: a broken read producing a green
    // light. An unreadable source outranks a clean result.
    const report = buildAlertReport(inputs(), [{ source: "op_fixture_results", error: "statement timeout" }], NOW);
    expect(report.exitCode).toBe(2);
    expect(report.alerts).toEqual([]);
    expect(report.couldNotCheck).toHaveLength(1);
  });

  it("lets could-not-check outrank a critical finding", () => {
    const report = buildAlertReport(inputs({ openResultConflicts: 5 }), [{ source: "odds", error: "denied" }], NOW);
    // Exit 1 would imply it found something; it found nothing out.
    expect(report.exitCode).toBe(2);
  });

  it("keeps unreadable sources out of the alert list", () => {
    const report = buildAlertReport(inputs(), [{ source: "a", error: "b" }], NOW);
    expect(report.alerts.map((alert) => alert.id)).not.toContain("result-conflict");
  });

  it("raises mass void only above both the share and the sample floor", () => {
    // Three of four voided is a quiet Tuesday, not an incident.
    const small = buildAlertReport(inputs({ settlementsLast24h: 4, voidsLast24h: 3 }), [], NOW);
    expect(small.alerts.map((alert) => alert.id)).not.toContain("mass-void");

    const real = buildAlertReport(inputs({ settlementsLast24h: 100, voidsLast24h: 20 }), [], NOW);
    expect(real.alerts.map((alert) => alert.id)).toContain("mass-void");
    expect(real.exitCode).toBe(1);
  });

  it("does not raise mass void exactly at the threshold", () => {
    const atThreshold = buildAlertReport(
      inputs({ settlementsLast24h: 100, voidsLast24h: SLA.massVoidShare * 100 }),
      [],
      NOW
    );
    expect(atThreshold.alerts.map((alert) => alert.id)).not.toContain("mass-void");
  });

  it("treats an unknown provider lag as unknown rather than fine", () => {
    const unknown = buildAlertReport(inputs({ medianProviderLagMinutes: null }), [], NOW);
    expect(unknown.alerts.map((alert) => alert.id)).not.toContain("provider-result-lag");
    const slow = buildAlertReport(inputs({ medianProviderLagMinutes: SLA.providerLagMinutes + 1 }), [], NOW);
    expect(slow.alerts.map((alert) => alert.id)).toContain("provider-result-lag");
  });
});

function alias(overrides: Partial<MarketAlias> = {}): MarketAlias {
  return {
    id: "alias-1",
    provider: "the-odds-api",
    sourceSport: "soccer_epl",
    rawMarket: "h2h",
    rawSelection: "Home",
    rawLine: null,
    participantOrder: "as_listed",
    canonicalMarketKey: "football.1x2.regulation",
    canonicalSelectionKey: "football.1x2.regulation.home",
    mappingState: "exact_equivalent",
    confidence: 0.9,
    conditions: [],
    evidence: {},
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    effectiveTo: null,
    version: 1,
    supersedesAliasId: null,
    status: "draft",
    createdBy: "analyst-a",
    reviewer: null,
    reviewedAt: null,
    ...overrides
  };
}

function impact(overrides: Partial<MappingImpact> = {}): MappingImpact {
  return {
    fixturesAffected: 3,
    oddsSnapshotsAffected: 40,
    decisionsAffected: 6,
    betWorkspacesAffected: 0,
    unsettledPublicationsAffected: 0,
    officialPublicationsAffected: 0,
    ...overrides
  };
}

describe("impact token", () => {
  it("is stable for the same alias and counts", () => {
    expect(impactToken(alias(), impact())).toBe(impactToken(alias(), impact()));
  });

  it("changes when the counts move", () => {
    expect(impactToken(alias(), impact({ fixturesAffected: 400 }))).not.toBe(impactToken(alias(), impact()));
  });

  it("changes when the mapping's meaning changes", () => {
    expect(impactToken(alias({ mappingState: "different_settlement" }), impact())).not.toBe(impactToken(alias(), impact()));
    expect(impactToken(alias({ participantOrder: "reversed" }), impact())).not.toBe(impactToken(alias(), impact()));
    expect(impactToken(alias({ canonicalSelectionKey: "football.1x2.regulation.away" }), impact())).not.toBe(
      impactToken(alias(), impact())
    );
  });

  it("does not change for edits that alter nothing the mapping does", () => {
    // Forcing a re-preview for a typo fix trains people to click through.
    expect(impactToken(alias({ notes: "typo fixed" }), impact())).toBe(impactToken(alias(), impact()));
    expect(impactToken(alias({ confidence: 0.6 }), impact())).toBe(impactToken(alias(), impact()));
  });

  it("ignores the order conditions were written in", () => {
    const a = alias({ mappingState: "conditionally_equivalent", conditions: ["x", "y"] });
    const b = alias({ mappingState: "conditionally_equivalent", conditions: ["y", "x"] });
    expect(impactToken(a, impact())).toBe(impactToken(b, impact()));
  });
});

describe("review requirements", () => {
  const base = { providerAliasCount: 12, currentParserVersion: "v3", aliasParserVersion: "v3" };

  it("requires review when official publications exist", () => {
    const result = reviewRequirements({ alias: alias(), impact: impact({ officialPublicationsAffected: 2 }), ...base });
    expect(result.required).toBe(true);
    expect(result.reasons.join(" ")).toContain("public record");
  });

  it("requires review above the fixture threshold", () => {
    expect(reviewRequirements({ alias: alias(), impact: impact({ fixturesAffected: 51 }), ...base }).required).toBe(true);
    expect(reviewRequirements({ alias: alias(), impact: impact({ fixturesAffected: 50 }), ...base }).required).toBe(false);
  });

  it("requires review for a provider with no active aliases", () => {
    const result = reviewRequirements({ alias: alias(), impact: impact(), ...base, providerAliasCount: 0 });
    expect(result.reasons.join(" ")).toContain("new provider");
  });

  it("requires review on parser drift", () => {
    const result = reviewRequirements({ alias: alias(), impact: impact(), ...base, aliasParserVersion: "v2" });
    expect(result.reasons.join(" ")).toContain("Parser drift");
  });

  it("requires review for a differing-settlement mapping", () => {
    const result = reviewRequirements({ alias: alias({ mappingState: "different_settlement" }), impact: impact(), ...base });
    expect(result.required).toBe(true);
  });

  it("needs no review for a small, unpublished, same-parser mapping", () => {
    expect(reviewRequirements({ alias: alias(), impact: impact(), ...base }).required).toBe(false);
  });
});

describe("approval", () => {
  const review = { required: false, reasons: [] };

  it("approves against a matching token", () => {
    const current = impact();
    const decision = decideApproval({
      alias: alias(),
      actor: "analyst-b",
      suppliedToken: impactToken(alias(), current),
      currentImpact: current,
      review
    });
    expect(decision.status).toBe("approved");
  });

  it("refuses a stale preview and returns the fresh counts", () => {
    const shown = impact({ fixturesAffected: 3 });
    const now = impact({ fixturesAffected: 403 });
    const decision = decideApproval({
      alias: alias(),
      actor: "analyst-b",
      suppliedToken: impactToken(alias(), shown),
      currentImpact: now,
      review
    });
    expect(decision.status).toBe("refused");
    expect(decision.status === "refused" && decision.freshImpact?.fixturesAffected).toBe(403);
  });

  it("refuses self-approval where review is required", () => {
    const current = impact({ officialPublicationsAffected: 1 });
    const required = reviewRequirements({
      alias: alias(),
      impact: current,
      providerAliasCount: 5,
      currentParserVersion: "v3",
      aliasParserVersion: "v3"
    });
    const decision = decideApproval({
      alias: alias(),
      actor: "analyst-a", // the creator
      suppliedToken: impactToken(alias(), current),
      currentImpact: current,
      review: required
    });
    expect(decision.status).toBe("refused");
    expect(decision.status === "refused" && decision.reason).toContain("second reader");
  });

  it("allows a different actor to approve the same mapping", () => {
    const current = impact({ officialPublicationsAffected: 1 });
    const required = reviewRequirements({
      alias: alias(),
      impact: current,
      providerAliasCount: 5,
      currentParserVersion: "v3",
      aliasParserVersion: "v3"
    });
    const decision = decideApproval({
      alias: alias(),
      actor: "analyst-b",
      suppliedToken: impactToken(alias(), current),
      currentImpact: current,
      review: required
    });
    expect(decision.status).toBe("approved");
  });

  it("checks the token before the reviewer, so a stale preview is never approved", () => {
    const decision = decideApproval({
      alias: alias(),
      actor: "analyst-b",
      suppliedToken: "0".repeat(32),
      currentImpact: impact(),
      review: { required: true, reasons: ["anything"] }
    });
    expect(decision.status === "refused" && decision.reason).toContain("stale");
  });
});

describe("the operator surface cannot rewrite published claims", () => {
  it("has no settlement or market library referencing publication claim columns as writes", () => {
    // The guarantee stated in settlement-exceptions.md, asserted rather than
    // trusted: an operator chooses a rule, never a verdict, and never a price.
    const files = [
      "src/lib/settlement/grade.ts",
      "src/lib/settlement/alerts.ts",
      "src/lib/markets/impact.ts",
      "src/lib/markets/alias.ts",
      "src/lib/markets/conversion.ts",
      "src/lib/closing/policy.ts",
      "src/lib/closing/clv.ts"
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} must not write op_publications`).not.toMatch(/from\(["']op_publications["']\)/);
      expect(source, `${file} must not assign odds_at_publication`).not.toMatch(/odds_at_publication\s*:/);
      expect(source, `${file} must not assign model_probability`).not.toMatch(/model_probability\s*:/);
      expect(source, `${file} must not assign published_at`).not.toMatch(/published_at\s*:/);
    }
  });
});
