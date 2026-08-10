import { describe, expect, it } from "vitest";
import {
  reconcile,
  detectUnsettledFinalFixtures,
  detectNewsPublicationMismatch,
  detectStaleCurrentDecisions,
  detectMissingClosingPrices,
  detectResultConflicts,
  detectOrphanedCommunitySelections,
  detectProjectionAgeBreaches,
  detectModelVersionMismatch,
  EMPTY_RECONCILER_INPUT,
  type ReconcilerInput
} from "@/lib/reconciliation/detections";

const NOW = new Date("2026-08-09T18:00:00.000Z");
const input = (overrides: Partial<ReconcilerInput>): ReconcilerInput => ({ ...EMPTY_RECONCILER_INPUT, ...overrides });

describe("unsettled final fixture", () => {
  it("flags a finished fixture unsettled beyond the 60-minute SLA", () => {
    const findings = detectUnsettledFinalFixtures(
      input({
        fixtures: [{ id: "f1", externalId: "api-football:1", status: "finished", lastSyncedAt: "2026-08-09T16:00:00.000Z" }],
        publications: [{ id: "p1", fixtureId: "f1", fixtureExternalId: "api-football:1", settlementStatus: "unsettled", modelVersion: null, hasCurrentClose: true, kickoffAt: "2026-08-09T14:00:00.000Z", publicationStatus: "published" }]
      }),
      NOW
    );
    expect(findings.map((f) => f.kind)).toEqual(["unsettled_final_fixture"]);
    expect(findings[0].severity).toBe("critical");
  });

  it("flags a settlement recorded before the fixture ended", () => {
    const findings = detectUnsettledFinalFixtures(
      input({
        fixtures: [{ id: "f1", externalId: null, status: "live", lastSyncedAt: null }],
        publications: [{ id: "p1", fixtureId: "f1", fixtureExternalId: null, settlementStatus: "won", modelVersion: null, hasCurrentClose: true, kickoffAt: null, publicationStatus: "published" }]
      }),
      NOW
    );
    expect(findings.some((f) => f.detail.includes("live"))).toBe(true);
  });

  it("does not flag a promptly-settled finished fixture", () => {
    const findings = detectUnsettledFinalFixtures(
      input({
        fixtures: [{ id: "f1", externalId: null, status: "finished", lastSyncedAt: "2026-08-09T17:50:00.000Z" }],
        publications: [{ id: "p1", fixtureId: "f1", fixtureExternalId: null, settlementStatus: "won", modelVersion: null, hasCurrentClose: true, kickoffAt: null, publicationStatus: "published" }]
      }),
      NOW
    );
    expect(findings).toEqual([]);
  });
});

describe("news/publication mismatch", () => {
  it("flags a pick count with no cited ids and an unknown cited id", () => {
    const findings = detectNewsPublicationMismatch(
      input({
        publications: [{ id: "p1", fixtureId: "f1", fixtureExternalId: null, settlementStatus: null, modelVersion: null, hasCurrentClose: true, kickoffAt: null, publicationStatus: "published" }],
        stories: [
          { slug: "recap", claimsACount: true, citedPublicationIds: [] },
          { slug: "recap2", claimsACount: true, citedPublicationIds: ["p1", "ghost"] }
        ]
      })
    );
    expect(findings.length).toBe(2);
    expect(findings.every((f) => f.kind === "news_publication_mismatch")).toBe(true);
  });
});

describe("stale current decision", () => {
  it("flags a current decision older than the freshness window, skipping superseded ones", () => {
    const findings = detectStaleCurrentDecisions(
      input({
        decisions: [
          { fixtureExternalId: "api-football:1", generatedAt: "2026-08-09T17:00:00.000Z", supersededBy: null },
          { fixtureExternalId: "api-football:2", generatedAt: "2026-08-09T10:00:00.000Z", supersededBy: "newer" }
        ]
      }),
      NOW
    );
    expect(findings.map((f) => f.entity)).toEqual(["api-football:1"]);
  });
});

describe("missing closing price", () => {
  it("flags a kicked-off publication with no current close, not a pre-kickoff one", () => {
    const findings = detectMissingClosingPrices(
      input({
        publications: [
          { id: "p1", fixtureId: "f1", fixtureExternalId: null, settlementStatus: null, modelVersion: null, hasCurrentClose: false, kickoffAt: "2026-08-09T14:00:00.000Z", publicationStatus: "published" },
          { id: "p2", fixtureId: "f2", fixtureExternalId: null, settlementStatus: null, modelVersion: null, hasCurrentClose: false, kickoffAt: "2026-08-10T14:00:00.000Z", publicationStatus: "published" }
        ]
      }),
      NOW
    );
    expect(findings.map((f) => f.entity)).toEqual(["p1"]);
  });
});

describe("result conflict", () => {
  it("flags a current, conflicted result verification", () => {
    const findings = detectResultConflicts(
      input({ results: [{ fixtureId: "f1", verificationState: "conflicted", isCurrent: true }, { fixtureId: "f2", verificationState: "conflicted", isCurrent: false }] })
    );
    expect(findings.map((f) => f.entity)).toEqual(["f1"]);
  });
});

describe("orphaned community selection", () => {
  it("flags a tip whose fixture is gone, but a deleted/moderated tip on an existing fixture is not an orphan", () => {
    const findings = detectOrphanedCommunitySelections(
      input({
        fixtures: [{ id: "f1", externalId: null, status: "finished", lastSyncedAt: null }],
        tips: [
          { id: "t1", fixtureId: "ghost", deletedAt: null, moderatedAt: null },
          { id: "t2", fixtureId: "f1", deletedAt: "2026-08-09T00:00:00.000Z", moderatedAt: null }
        ]
      })
    );
    expect(findings.map((f) => f.entity)).toEqual(["t1"]);
  });
});

describe("projection age breach", () => {
  it("flags a stale current projection but not a past-dated slate scope", () => {
    const findings = detectProjectionAgeBreaches(
      input({
        projections: [
          { name: "daily_fixture_slate", scope: "2026-08-09", builtAt: "2026-08-09T17:40:00.000Z" },
          { name: "daily_fixture_slate", scope: "2026-08-01", builtAt: "2026-08-01T00:00:00.000Z" }
        ]
      }),
      NOW
    );
    expect(findings.map((f) => f.entity)).toEqual(["daily_fixture_slate/2026-08-09"]);
  });
});

describe("model version mismatch", () => {
  it("flags a publication under a non-approved model version", () => {
    const findings = detectModelVersionMismatch(
      input({
        approvedModelVersions: ["football-1x2-dc-v2"],
        publications: [
          { id: "p1", fixtureId: "f1", fixtureExternalId: null, settlementStatus: null, modelVersion: "football-1x2-dc-v1", hasCurrentClose: true, kickoffAt: null, publicationStatus: "published" },
          { id: "p2", fixtureId: "f2", fixtureExternalId: null, settlementStatus: null, modelVersion: "football-1x2-dc-v2", hasCurrentClose: true, kickoffAt: null, publicationStatus: "published" }
        ]
      })
    );
    expect(findings.map((f) => f.entity)).toEqual(["p1"]);
  });
});

describe("reconcile roll-up", () => {
  it("returns clean on empty input", () => {
    expect(reconcile(EMPTY_RECONCILER_INPUT, NOW).status).toBe("clean");
  });

  it("an unreadable source makes the status could_not_check, never a false clean", () => {
    const report = reconcile(EMPTY_RECONCILER_INPUT, NOW, ["op_publications"]);
    expect(report.status).toBe("could_not_check");
    expect(report.couldNotCheck).toEqual(["op_publications"]);
  });

  it("findings never carry raw error/SQL text", () => {
    const report = reconcile(
      input({ results: [{ fixtureId: "f1", verificationState: "conflicted", isCurrent: true }] }),
      NOW
    );
    expect(report.status).toBe("findings");
    for (const finding of report.findings) {
      expect(finding.detail).not.toMatch(/\$\{|select |from op_|error:|::/i);
    }
  });
});
