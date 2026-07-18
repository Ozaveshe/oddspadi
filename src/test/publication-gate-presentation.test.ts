import { describe, expect, it } from "vitest";
import { buildPublicationGatePresentation } from "@/lib/sports/prediction/publicationGatePresentation";

describe("publication gate presentation", () => {
  it("makes a public-value claim only for a canonically eligible pick", () => {
    expect(buildPublicationGatePresentation({
      analysisStatus: "published_value_pick",
      publicationEligible: true,
      blockers: [],
      expiresAt: "2026-07-18T09:00:00Z"
    })).toMatchObject({
      state: "cleared",
      label: "Publication gates cleared",
      shortLabel: "Publishable"
    });
  });

  it("puts the first canonical blocker directly beside a positive EV case", () => {
    expect(buildPublicationGatePresentation({
      analysisStatus: "watchlist",
      publicationEligible: false,
      blockers: ["decimal odds are outside the publication range"],
      expiresAt: "2026-07-18T09:00:00Z"
    })).toMatchObject({
      state: "watch",
      label: "Analysis only — publication blocked",
      detail: "Decimal odds are outside the publication range.",
      shortLabel: "Watchlist"
    });
  });

  it("does not invent a verdict when the canonical receipt is absent", () => {
    expect(buildPublicationGatePresentation(null)).toMatchObject({
      state: "missing",
      label: "Publication gate unavailable"
    });
  });
});
