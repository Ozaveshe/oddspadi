import { describe, expect, it } from "vitest";
import { buildMarketTiles, buildCommunityTiles } from "@/lib/ops/dashboardTiles";

const labels = (tiles: { label: string }[]) => tiles.map((t) => t.label);
const byLabel = (tiles: { label: string; value: unknown; status?: string; target?: number | null }[]) =>
  Object.fromEntries(tiles.map((t) => [t.label, t]));

describe("market dashboard tiles", () => {
  it("enumerates the eight named operations metrics", () => {
    const tiles = buildMarketTiles({
      openCritical: 3,
      reconciliationErrorsOpen: 0,
      reconciliationComplete: true,
      directDatabaseEdits: null
    });
    expect(tiles).toHaveLength(8);
    expect(labels(tiles)).toEqual([
      "Stale-card rate",
      "Verified-result SLA",
      "Settlement SLA",
      "Closing-price coverage",
      "Mapping accuracy",
      "Unresolved high-priority cases",
      "Direct database edits",
      "Reconciliation completion"
    ]);
  });

  it("computes the case-derived tiles and targets the integrity ones at zero", () => {
    const t = byLabel(
      buildMarketTiles({ openCritical: 2, reconciliationErrorsOpen: 1, reconciliationComplete: false, directDatabaseEdits: null })
    );
    expect(t["Unresolved high-priority cases"].value).toBe(2);
    expect(t["Direct database edits"].target).toBe(0);
    expect(t["Direct database edits"].status).toBe("unknown"); // null value
    expect(t["Reconciliation completion"].value).toBe("incomplete");
    expect(t["Reconciliation completion"].status).toBe("page"); // 1 open reconciliation error
    // Named-but-unmeasured metrics carry a target and a null value (→ "—").
    expect(t["Settlement SLA"].value).toBeNull();
    expect(t["Settlement SLA"].target).toBe(60);
    expect(t["Closing-price coverage"].target).toBe(90);
  });

  it("classifies a supplied closing-price coverage", () => {
    const t = byLabel(
      buildMarketTiles({
        openCritical: 0,
        reconciliationErrorsOpen: 0,
        reconciliationComplete: true,
        closingLineCoveragePercent: 95
      })
    );
    expect(t["Closing-price coverage"].value).toBe(95);
    expect(t["Closing-price coverage"].status).toBe("ok");
  });
});

describe("community dashboard tiles", () => {
  it("enumerates the seven named community metrics", () => {
    const tiles = buildCommunityTiles({ moderationBacklog: 5 });
    expect(tiles).toHaveLength(7);
    expect(labels(tiles)).toEqual([
      "Canonical-content usage",
      "Correction rate",
      "Unsupported-claim rate",
      "Referral traffic",
      "Response time",
      "Moderation backlog",
      "Community growth (excl. demo/staff)"
    ]);
  });

  it("classifies moderation backlog, targets unsupported-claim at zero, passes correction rate through", () => {
    const t = byLabel(
      buildCommunityTiles({ moderationBacklog: 25, correctionRatePercent: 4, unsupportedClaimRatePercent: null })
    );
    expect(t["Moderation backlog"].value).toBe(25);
    expect(t["Moderation backlog"].status).toBe("warn"); // 20 <= 25 < 100
    expect(t["Correction rate"].value).toBe(4);
    expect(t["Unsupported-claim rate"].target).toBe(0);
    expect(t["Unsupported-claim rate"].status).toBe("unknown"); // null value
    expect(t["Community growth (excl. demo/staff)"].value).toBeNull();
  });
});
