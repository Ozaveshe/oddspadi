import { describe, expect, it } from "vitest";
import type { BandEvidence } from "@/lib/accumulator/calibratedBands";
import { buildPublicDecision } from "@/lib/domain/buildPublicDecision";
import type { PublicationRecord } from "@/lib/domain/publication";
import { isContradictory, supportsValueClaim } from "@/lib/domain/publicDecision";
import type { PublicationCandidate } from "@/lib/publication/selectForPublication";
import { SPORT_DECISION_THRESHOLDS } from "@/lib/sports/prediction/canonicalDecision";
import type { DecisionAuditSummary, DecisionMarketAnalysis, DecisionSummary } from "@/lib/sports/types";

const NOW = new Date("2026-08-06T12:00:00.000Z");

function analysisFixture(overrides: Partial<DecisionMarketAnalysis> = {}): DecisionMarketAnalysis {
  return {
    marketId: "match_winner",
    selectionId: "home",
    label: "Home win",
    modelProbability: 0.55,
    // Vigged: 1 / 1.92.
    rawImpliedProbability: 0.5208,
    noVigImpliedProbability: 0.49,
    // The trap. This field holds the DE-VIGGED number in memory while the
    // column of the same name holds the vigged one. A deliberately impossible
    // sentinel so any read of it shows up in an assertion.
    impliedProbability: 0.1234,
    bookmakerMargin: 0.045,
    edge: 0.06,
    expectedValue: 0.056,
    // Byte-identical alias of expectedValue at source; poisoned here so any
    // read of it is visible.
    expectedRoi: -9.99,
    odds: 1.92,
    bookmaker: { id: "book-one", name: "Book One" },
    priceObservedAt: "2026-08-06T11:40:00.000Z",
    consensusBookmakerCount: 6,
    consensusMaxProbabilitySpread: 0.02,
    economicConfidence: {
      status: "verified",
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95,
      sampleSize: 420,
      source: "football-calibration-2026-07",
      probabilityLow: 0.51,
      probabilityHigh: 0.59,
      edgeLow: 0.05,
      expectedValueLow: 0.04,
      detail: "Wilson lower bound over 420 settled outcomes in this bucket."
    },
    confidence: "high",
    risk: "low",
    analysisStatus: "published_value_pick",
    oddsSnapshotId: "snapshot-1",
    oddsCapturedAt: "2026-08-06T11:40:00.000Z",
    expiresAt: "2026-08-06T12:40:00.000Z",
    dataQuality: 0.81,
    evidenceQuality: "strong",
    publicationEligible: true,
    blockers: [],
    ...overrides
  };
}

function auditFixture(overrides: Partial<DecisionAuditSummary> = {}): DecisionAuditSummary {
  return {
    thresholdProfile: "football",
    thresholds: SPORT_DECISION_THRESHOLDS.football,
    marketsAnalysed: 3,
    publishedCandidates: 1,
    leanCandidates: 0,
    watchlistCandidates: 1,
    staleCandidates: 0,
    enginePublicationAllowed: true,
    providerBacked: true,
    contextSignalsSeen: 7,
    blockers: [],
    publicInvariantPassed: true,
    modelVersion: "football-model-v7",
    engineVersion: "decision-engine-2026-07-19",
    ...overrides
  };
}

function summaryFixture(overrides: Partial<DecisionSummary> = {}): DecisionSummary {
  const analysis = overrides.allMarketAnalyses?.[0] ?? analysisFixture();
  return {
    fixtureId: "fixture-1",
    bestPublishedPick: analysis,
    bestLean: null,
    bestDisplayCandidate: analysis,
    noPickReason: null,
    allMarketAnalyses: [analysis],
    publicStatus: "value_pick",
    engineStatus: "published",
    dataQuality: 0.81,
    evidenceQuality: "strong",
    confidence: "high",
    risk: "low",
    generatedAt: "2026-08-06T11:45:00.000Z",
    expiresAt: "2026-08-06T12:40:00.000Z",
    auditSummary: auditFixture(),
    ...overrides
  };
}

function candidateFixture(overrides: Partial<PublicationCandidate> = {}): PublicationCandidate {
  return {
    fixtureId: "fixture-1",
    fixtureExternalId: "provider-99",
    sport: "football",
    competition: "Premier League",
    kickoffAt: "2026-08-06T14:00:00.000Z",
    market: "match_winner",
    selection: "home",
    selectionLabel: "Home win",
    marketLine: null,
    modelProbability: 0.55,
    impliedProbability: 0.5208,
    noVigProbability: 0.49,
    decimalOdds: 1.92,
    oddsSnapshotId: "snapshot-1",
    oddsSnapshotAt: "2026-08-06T11:40:00.000Z",
    evidenceCutoffAt: "2026-08-06T11:44:00.000Z",
    dataQuality: "complete",
    modelVersion: "football-model-v7",
    featureSetVersion: "features-v3",
    calibrationVersion: "calibration-2026-07",
    decisionPolicyVersion: "policy-v4",
    bookmakerCount: 6,
    ...overrides
  };
}

function publicationFixture(overrides: Partial<PublicationRecord> = {}): PublicationRecord {
  return {
    publicationId: "pub-1",
    fixtureId: "fixture-1",
    sport: "football",
    competition: "Premier League",
    market: "match_winner",
    selection: "home",
    selectionLabel: "Home win",
    marketLine: null,
    modelVersion: "football-model-v7",
    featureSetVersion: "features-v3",
    calibrationVersion: "calibration-2026-07",
    decisionPolicyVersion: "policy-v4",
    modelProbability: 0.55,
    oddsAtPublication: 1.92,
    impliedProbability: 0.5208,
    publishedAt: "2026-08-06T11:46:00.000Z",
    kickoffAt: "2026-08-06T14:00:00.000Z",
    evidenceCutoffAt: "2026-08-06T11:44:00.000Z",
    oddsSnapshotAt: "2026-08-06T11:40:00.000Z",
    oddsSnapshotId: "snapshot-1",
    dataQuality: "complete",
    decisionStatus: "pick",
    publicCopyRef: null,
    publicationStatus: "published",
    settlementStatus: "unsettled",
    settledAt: null,
    correctionReason: null,
    supersedesPublicationId: null,
    recordClass: "official_public_pick",
    ...overrides
  };
}

function build(overrides: Parameters<typeof buildPublicDecision>[0] extends infer T ? Partial<T> : never = {}) {
  const analysis = overrides.analysis ?? analysisFixture();
  return buildPublicDecision({
    analysis,
    summary: summaryFixture({ allMarketAnalyses: [analysis] }),
    now: NOW,
    ...overrides
  });
}

describe("the three probabilities that were named wrong", () => {
  it("takes the market probability from the vigged field and the fair one from the no-vig field", () => {
    const decision = build({ consensusMethod: "median-shin-no-vig-v2" });

    expect(decision.marketProbability).toBe(0.5208);
    expect(decision.fairProbability).toBe(0.49);
    // The sentinel proves `impliedProbability` was never consulted.
    expect(decision.marketProbability).not.toBe(0.1234);
    expect(decision.fairProbability).not.toBe(0.1234);
  });

  it("refuses a no-vig number that is degenerately 1.0", () => {
    const decision = build({
      analysis: analysisFixture({ noVigImpliedProbability: 1 }),
      consensusMethod: "median-shin-no-vig-v2"
    });

    expect(decision.fairProbability).toBeNull();
    expect(decision.fairMethod).toBeNull();
    expect(decision.fairOdds).toBeNull();
    expect(decision.rawEdge).toBeNull();
    expect([decision.mainReason, decision.primaryRisk, ...decision.factors].map((factor) => factor?.code)).toContain(
      "market.fair_price_unknown"
    );
  });

  it("refuses a plausible-looking no-vig number when only one selection backed the market", () => {
    const decision = build({
      analysis: analysisFixture({ noVigImpliedProbability: 0.52 }),
      consensusMethod: "median-shin-no-vig-v2",
      marketSelectionCount: 1
    });

    expect(decision.fairProbability).toBeNull();
    expect(decision.fairMethod).toBeNull();
  });

  it("names the estimator when the caller knows it", () => {
    expect(build({ consensusMethod: "median-shin-no-vig-v2" }).fairMethod).toBe("shin");
    expect(build({ consensusMethod: "median-no-vig-v1" }).fairMethod).toBe("proportional");
  });

  it("reports no fair price when a consensus was used but its estimator was not recorded", () => {
    // Shin and proportional disagree; an unattributed number is not reportable.
    const decision = build({ consensusMethod: null });

    expect(decision.fairProbability).toBeNull();
    expect(decision.fairMethod).toBeNull();
  });

  it("knows the single-quote path is proportional without being told", () => {
    const decision = build({
      analysis: analysisFixture({ consensusMaxProbabilitySpread: null, consensusBookmakerCount: 1 })
    });

    expect(decision.fairMethod).toBe("proportional");
    expect(decision.fairProbability).toBe(0.49);
  });
});

describe("prices", () => {
  it("derives fair odds from the fair probability only", () => {
    const decision = build({ consensusMethod: "median-shin-no-vig-v2" });

    expect(decision.fairOdds).toBeCloseTo(1 / 0.49, 10);
  });

  it("never derives fair odds from the model probability", () => {
    const decision = build({
      analysis: analysisFixture({ modelProbability: 0.9, noVigImpliedProbability: 1 })
    });

    expect(decision.fairOdds).toBeNull();
    // 1 / 0.9 is what a surface computed today. It must not appear.
    expect(decision.fairOdds).not.toBeCloseTo(1 / 0.9, 6);
  });

  it("prefers a fair price that was already stored", () => {
    const decision = build({ consensusMethod: "median-shin-no-vig-v2", storedFairOdds: 2.11 });

    expect(decision.fairOdds).toBe(2.11);
  });

  it("treats odds of 1.0 or less as no price at all, not as a price of one", () => {
    const decision = build({ analysis: analysisFixture({ odds: 1, expectedValue: -1 }) });

    expect(decision.quotedOdds).toBeNull();
    // −1 is the sentinel `calculateExpectedValue` returns for unusable odds.
    expect(decision.expectedValue).toBeNull();
  });

  it("ignores expectedRoi, which is a byte-identical alias of expectedValue", () => {
    const decision = build();

    expect(decision.expectedValue).toBe(0.056);
    expect(decision.expectedValue).not.toBe(-9.99);
  });

  it("takes the capture time from the snapshot, then the quote, then the publication candidate", () => {
    expect(build().oddsCapturedAt).toBe("2026-08-06T11:40:00.000Z");
    expect(build({ analysis: analysisFixture({ oddsCapturedAt: null }) }).oddsCapturedAt).toBe(
      "2026-08-06T11:40:00.000Z"
    );
    expect(
      build({
        analysis: analysisFixture({ oddsCapturedAt: null, priceObservedAt: null }),
        candidate: candidateFixture({ oddsSnapshotAt: "2026-08-06T11:30:00.000Z" })
      }).oddsCapturedAt
    ).toBe("2026-08-06T11:30:00.000Z");
    expect(
      build({ analysis: analysisFixture({ oddsCapturedAt: "not a date", priceObservedAt: null }) }).oddsCapturedAt
    ).toBeNull();
  });
});

describe("null is not zero", () => {
  it("distinguishes a zero edge from an unestablished one", () => {
    const zero = build({
      analysis: analysisFixture({ modelProbability: 0.49, noVigImpliedProbability: 0.49 }),
      consensusMethod: "median-shin-no-vig-v2"
    });
    const unknown = build({ consensusMethod: null });

    expect(zero.rawEdge).toBe(0);
    expect(unknown.rawEdge).toBeNull();
    expect(zero.rawEdge).not.toBeNull();
    // The two must not collapse into the same rendering input.
    expect(Object.is(zero.rawEdge, unknown.rawEdge)).toBe(false);
  });

  it("leaves every unestablished number null rather than zero", () => {
    const decision = build({
      analysis: analysisFixture({
        modelProbability: Number.NaN,
        rawImpliedProbability: Number.NaN,
        noVigImpliedProbability: Number.NaN,
        bookmakerMargin: Number.NaN,
        edge: Number.NaN,
        expectedValue: Number.NaN,
        odds: Number.NaN,
        dataQuality: Number.NaN,
        consensusBookmakerCount: undefined,
        consensusMaxProbabilitySpread: null,
        economicConfidence: undefined,
        evidenceQuality: "missing"
      })
    });

    for (const value of [
      decision.modelProbability,
      decision.conservativeProbability,
      decision.quotedOdds,
      decision.marketProbability,
      decision.fairProbability,
      decision.fairOdds,
      decision.rawEdge,
      decision.expectedValue,
      decision.uncertainty.model,
      decision.uncertainty.market
    ]) {
      expect(value).toBeNull();
    }
  });

  it("leaves conservativeProbability null when there is no economic confidence receipt", () => {
    const decision = build({ analysis: analysisFixture({ economicConfidence: undefined }) });

    expect(decision.conservativeProbability).toBeNull();
    expect(decision.uncertainty.model).toBeNull();
    expect(supportsValueClaim(decision)).toBe(false);
  });

  it("leaves conservativeProbability null when the receipt exists but was never measured", () => {
    const decision = build({
      analysis: analysisFixture({
        economicConfidence: {
          status: "unavailable",
          method: "unavailable",
          confidenceLevel: null,
          sampleSize: null,
          source: null,
          probabilityLow: null,
          probabilityHigh: null,
          edgeLow: null,
          expectedValueLow: null,
          detail: "No calibration profile has been promoted for this runtime."
        }
      })
    });

    expect(decision.conservativeProbability).toBeNull();
    expect(decision.uncertainty.model).toBeNull();
    expect([decision.mainReason, decision.primaryRisk, ...decision.factors].map((factor) => factor?.code)).toContain(
      "value.floor_unverified"
    );
  });
});

describe("candidate state is arithmetic, not policy", () => {
  it("keeps a withheld positive candidate positive", () => {
    const analysis = analysisFixture({
      analysisStatus: "watchlist",
      publicationEligible: false,
      blockers: ["kickoff is too close for a new published pick"]
    });
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({ allMarketAnalyses: [analysis], publicStatus: "watchlist", engineStatus: "watch" }),
      consensusMethod: "median-shin-no-vig-v2",
      now: NOW
    });

    expect(decision.candidateState).toBe("positive_candidate");
    expect(decision.decisionState).toBe("watch");
    expect(decision.publicationState).toBe("unpublished");
    // A positive candidate under a withhold is the separation working.
    expect(isContradictory(decision)).toBe(false);
    expect(supportsValueClaim(decision)).toBe(false);
  });

  it("calls a stale-priced positive candidate stale", () => {
    const decision = build({
      analysis: analysisFixture({
        oddsCapturedAt: "2026-08-06T08:00:00.000Z",
        priceObservedAt: "2026-08-06T08:00:00.000Z",
        expiresAt: "2026-08-06T09:00:00.000Z"
      }),
      consensusMethod: "median-shin-no-vig-v2"
    });

    expect(decision.candidateState).toBe("stale_candidate");
  });

  it("calls a price with no capture time stale, as the engine does", () => {
    const decision = build({
      analysis: analysisFixture({ oddsCapturedAt: null, priceObservedAt: null, expiresAt: null }),
      consensusMethod: "median-shin-no-vig-v2"
    });

    expect(decision.candidateState).toBe("stale_candidate");
  });

  it("lets a published pick outlive its price without calling the record wrong", () => {
    // Same payload, read four hours later. The engine's verdict has not
    // changed; the price it depended on has expired.
    //
    // This is NOT a contradiction. A publication is an immutable historical
    // record — a pick published at 09:00 legitimately has a dead price by
    // 21:00, and flagging that would fire on almost every published pick and
    // train everyone to ignore the signal. It is old, not wrong.
    const analysis = analysisFixture();
    const later = new Date("2026-08-06T16:00:00.000Z");
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({ allMarketAnalyses: [analysis] }),
      publication: publicationFixture(),
      consensusMethod: "median-shin-no-vig-v2",
      now: later
    });

    expect(decision.decisionState).toBe("pick");
    expect(decision.candidateState).toBe("stale_candidate");
    expect(isContradictory(decision)).toBe(false);
    // Staleness is caught here instead, and more precisely: the record stays
    // truthful about what was decided, but cannot back a claim made now.
    expect(supportsValueClaim(decision)).toBe(false);
  });

  it("still calls a published pick wrong when the arithmetic was never positive", () => {
    // The case isContradictory does exist for: not a question of age.
    const analysis = analysisFixture({ modelProbability: 0.2, noVigImpliedProbability: 0.5 });
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({ allMarketAnalyses: [analysis] }),
      publication: publicationFixture(),
      consensusMethod: "median-shin-no-vig-v2",
      now: new Date("2026-08-06T12:05:00.000Z")
    });

    expect(decision.candidateState).toBe("negative_candidate");
    expect(isContradictory(decision)).toBe(true);
  });

  it("stays negative when the arithmetic is negative, however fresh the price", () => {
    const decision = build({
      analysis: analysisFixture({ modelProbability: 0.4, edge: -0.09, expectedValue: -0.232 }),
      consensusMethod: "median-shin-no-vig-v2"
    });

    expect(decision.rawEdge).toBeCloseTo(-0.09, 10);
    expect(decision.candidateState).toBe("negative_candidate");
  });

  it("calls a positive candidate on thin evidence unsupported", () => {
    const decision = build({
      analysis: analysisFixture({ evidenceQuality: "thin" }),
      consensusMethod: "median-shin-no-vig-v2"
    });

    expect(decision.candidateState).toBe("unsupported_candidate");
  });

  it("calls a positive candidate below the sport's data-quality bar unsupported", () => {
    const decision = build({
      analysis: analysisFixture({ dataQuality: 0.4 }),
      consensusMethod: "median-shin-no-vig-v2"
    });

    expect(decision.candidateState).toBe("unsupported_candidate");
  });

  it("calls an unestablishable candidate unsupported rather than negative", () => {
    const decision = build({
      analysis: analysisFixture({ noVigImpliedProbability: 1, odds: 1, expectedValue: -1 })
    });

    expect(decision.rawEdge).toBeNull();
    expect(decision.expectedValue).toBeNull();
    expect(decision.candidateState).toBe("unsupported_candidate");
  });

  it("supports a value claim only when every leg agrees", () => {
    const analysis = analysisFixture();
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({ allMarketAnalyses: [analysis] }),
      publication: publicationFixture(),
      consensusMethod: "median-shin-no-vig-v2",
      now: NOW
    });

    expect(decision.candidateState).toBe("positive_candidate");
    expect(decision.decisionState).toBe("pick");
    expect(decision.publicationState).toBe("published");
    expect(supportsValueClaim(decision)).toBe(true);
    expect(isContradictory(decision)).toBe(false);
  });
});

describe("decision state", () => {
  const cases: Array<[DecisionMarketAnalysis["analysisStatus"], string]> = [
    ["published_value_pick", "pick"],
    ["lean", "lean"],
    ["watchlist", "watch"],
    ["no_clear_value", "pass"],
    ["needs_data", "withheld"],
    ["stale", "withheld"],
    ["suspended", "unavailable"]
  ];

  for (const [analysisStatus, expected] of cases) {
    it(`maps ${analysisStatus} to ${expected}`, () => {
      const analysis = analysisFixture({ analysisStatus });
      const decision = buildPublicDecision({
        analysis,
        summary: summaryFixture({ allMarketAnalyses: [analysis], publicStatus: "watchlist" }),
        now: NOW
      });

      expect(decision.decisionState).toBe(expected);
    });
  }

  it("lets a suspended fixture override a market that still looks publishable", () => {
    const analysis = analysisFixture();
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({ allMarketAnalyses: [analysis], publicStatus: "suspended" }),
      now: NOW
    });

    expect(decision.decisionState).toBe("unavailable");
  });

  it("reads publication state from the ledger row and nothing else", () => {
    const analysis = analysisFixture();
    const summary = summaryFixture({ allMarketAnalyses: [analysis] });
    const at = (publication: PublicationRecord | null) =>
      buildPublicDecision({ analysis, summary, publication, now: NOW }).publicationState;

    expect(at(null)).toBe("unpublished");
    expect(at(publicationFixture({ publicationStatus: "draft" }))).toBe("unpublished");
    expect(at(publicationFixture({ publicationStatus: "published" }))).toBe("published");
    expect(at(publicationFixture({ publicationStatus: "corrected" }))).toBe("corrected");
    expect(at(publicationFixture({ publicationStatus: "retracted" }))).toBe("retracted");
  });

  it("does not treat a publication candidate as a publication", () => {
    expect(build({ candidate: candidateFixture() }).publicationState).toBe("unpublished");
  });
});

describe("provenance versions", () => {
  it("passes through what the publication path supplies", () => {
    const decision = build({ candidate: candidateFixture() });

    expect(decision.modelVersion).toBe("football-model-v7");
    expect(decision.calibrationVersion).toBe("calibration-2026-07");
    expect(decision.decisionPolicyVersion).toBe("policy-v4");
  });

  it("falls back to engineVersion for the decision policy, and says so by not inventing one", () => {
    const decision = build();

    expect(decision.decisionPolicyVersion).toBe("decision-engine-2026-07-19");
    // No producer exists anywhere in src/lib for a calibration version.
    expect(decision.calibrationVersion).toBeNull();
  });

  it("prefers the named decision-policy version over engineVersion when both exist", () => {
    const decision = build({ candidate: candidateFixture({ decisionPolicyVersion: "policy-v9" }) });

    expect(decision.decisionPolicyVersion).toBe("policy-v9");
  });

  it("returns null for every absent version rather than an empty string", () => {
    const analysis = analysisFixture();
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({
        allMarketAnalyses: [analysis],
        auditSummary: auditFixture({ modelVersion: undefined, engineVersion: undefined })
      }),
      now: NOW
    });

    expect(decision.modelVersion).toBeNull();
    expect(decision.calibrationVersion).toBeNull();
    expect(decision.decisionPolicyVersion).toBeNull();
  });

  it("treats a placeholder version as the unknown it is", () => {
    const decision = build({
      candidate: candidateFixture({ calibrationVersion: "legacy-unknown", modelVersion: "   " })
    });

    expect(decision.calibrationVersion).toBeNull();
    expect(decision.modelVersion).toBe("football-model-v7"); // audit summary still has one
  });
});

describe("reasons", () => {
  it("keeps blocker wording verbatim and adds a stable code", () => {
    const decision = build({
      analysis: analysisFixture({
        analysisStatus: "watchlist",
        publicationEligible: false,
        blockers: ["data quality is below the sport threshold", "kickoff is too close for a new published pick"]
      })
    });

    const all = [decision.mainReason, decision.primaryRisk, ...decision.factors].filter(Boolean);
    const byCode = new Map(all.map((factor) => [factor!.code, factor!.text]));

    expect(byCode.get("evidence.insufficient_data")).toBe("data quality is below the sport threshold");
    expect(byCode.get("timing.kickoff_close")).toBe("kickoff is too close for a new published pick");
  });

  it("chooses the most fundamental blocker as the main reason", () => {
    const decision = build({
      analysis: analysisFixture({
        analysisStatus: "watchlist",
        publicationEligible: false,
        blockers: [
          "kickoff is too close for a new published pick",
          "fixture is not provider-backed",
          "confidence is below the value-pick threshold"
        ]
      })
    });

    expect(decision.mainReason.code).toBe("fixture.not_provider_backed");
    expect(decision.mainReason.polarity).toBe("blocking");
    expect(decision.primaryRisk?.code).toBe("model.low_confidence");
  });

  it("explains a pick by its value and still names a risk", () => {
    const decision = build({
      analysis: analysisFixture({ evidenceQuality: "acceptable", risk: "high" }),
      consensusMethod: "median-shin-no-vig-v2"
    });

    expect(decision.mainReason.polarity).toBe("supporting");
    expect(decision.mainReason.code).toBe("value.edge_over_fair_price");
    expect(decision.mainReason.text).toContain("6.0%");
    expect(decision.primaryRisk?.code).toBe("model.high_risk");
  });

  it("never repeats the main reason or the primary risk in the advanced fold", () => {
    const decision = build({
      analysis: analysisFixture({
        analysisStatus: "watchlist",
        publicationEligible: false,
        evidenceQuality: "thin",
        blockers: ["fixture is not provider-backed", "confidence is below the value-pick threshold"]
      })
    });

    const codes = decision.factors.map((factor) => factor.code);
    expect(codes).not.toContain(decision.mainReason.code);
    expect(codes).not.toContain(decision.primaryRisk?.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("falls back to the fixture's no-pick reason when nothing was blocked", () => {
    const analysis = analysisFixture({
      analysisStatus: "no_clear_value",
      publicationEligible: false,
      modelProbability: Number.NaN,
      odds: Number.NaN,
      expectedValue: Number.NaN,
      blockers: []
    });
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({
        allMarketAnalyses: [analysis],
        publicStatus: "no_clear_value",
        noPickReason: "No market cleared the value threshold for this fixture."
      }),
      now: NOW
    });

    expect(decision.mainReason.code).toBe("decision.no_pick_reason");
    expect(decision.mainReason.text).toBe("No market cleared the value threshold for this fixture.");
  });

  it("always produces a main reason, even with nothing to say", () => {
    const analysis = analysisFixture({
      analysisStatus: "no_clear_value",
      publicationEligible: false,
      modelProbability: Number.NaN,
      odds: Number.NaN,
      expectedValue: Number.NaN,
      noVigImpliedProbability: Number.NaN,
      blockers: []
    });
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({ allMarketAnalyses: [analysis], publicStatus: "no_clear_value", noPickReason: "  " }),
      now: NOW
    });

    expect(decision.mainReason.code).toBe("decision.unexplained");
  });

  it("passes an unrecognised blocker through instead of dropping it", () => {
    const decision = build({
      analysis: analysisFixture({
        analysisStatus: "watchlist",
        publicationEligible: false,
        blockers: ["some brand new gate tripped"]
      })
    });

    expect(decision.mainReason.code).toBe("blocker.unclassified");
    expect(decision.mainReason.text).toBe("some brand new gate tripped");
  });
});

describe("uncertainty profile", () => {
  const bands: BandEvidence[] = [
    { lowerBound: 0.5, upperBound: 0.6, settledSize: 221, calibrationGap: 0.024 },
    { lowerBound: 0.8, upperBound: 0.9, settledSize: 7, calibrationGap: 0.259 }
  ];

  it("sources only the dimensions it can, and leaves the rest null", () => {
    const decision = build({ calibrationBands: bands });

    expect(decision.uncertainty.model).toBeCloseTo(0.08, 6);
    expect(decision.uncertainty.dataCoverage).toBeCloseTo(0.19, 6);
    expect(decision.uncertainty.market).toBeCloseTo(0.3, 6);
    expect(decision.uncertainty.calibration).toBeCloseTo(0.024 / 0.05, 6);
    // Nothing in the pipeline scores either of these.
    expect(decision.uncertainty.identity).toBeNull();
    expect(decision.uncertainty.context).toBeNull();
  });

  it("takes the worse of the numeric data score and the evidence verdict", () => {
    const decision = build({ analysis: analysisFixture({ dataQuality: 0.95, evidenceQuality: "missing" }) });

    expect(decision.uncertainty.dataCoverage).toBe(1);
  });

  it("treats a probability no promoted cohort covers as maximally uncalibrated", () => {
    const decision = build({ analysis: analysisFixture({ modelProbability: 0.25 }), calibrationBands: bands });

    expect(decision.uncertainty.calibration).toBe(1);
  });

  it("treats an unsupported band as maximally uncalibrated", () => {
    const decision = build({ analysis: analysisFixture({ modelProbability: 0.85 }), calibrationBands: bands });

    expect(decision.uncertainty.calibration).toBe(1);
  });

  it("leaves calibration null when no bands were supplied at all", () => {
    expect(build().uncertainty.calibration).toBeNull();
  });

  it("charges a single-book panel the full market uncertainty", () => {
    const decision = build({
      analysis: analysisFixture({ bookmakerMargin: 0.01, consensusBookmakerCount: 1, consensusMaxProbabilitySpread: 0 })
    });

    expect(decision.uncertainty.market).toBe(1);
  });

  it("treats books that disagree beyond the credible spread as maximally uncertain", () => {
    const decision = build({
      analysis: analysisFixture({ bookmakerMargin: 0.01, consensusBookmakerCount: 8, consensusMaxProbabilitySpread: 0.2 })
    });

    expect(decision.uncertainty.market).toBe(1);
  });

  it("rescales the engine's 0-100 evidence-risk index into readiness", () => {
    const decision = build({ evidenceRiskIndex: 76 });

    expect(decision.uncertainty.overallReadiness).toBeCloseTo(0.24, 6);
  });

  it("falls back to the mean of the sourced dimensions when no index is supplied", () => {
    const decision = build({ calibrationBands: bands });
    const sourced = [
      decision.uncertainty.model!,
      decision.uncertainty.dataCoverage!,
      decision.uncertainty.market!,
      decision.uncertainty.calibration!
    ];

    expect(decision.uncertainty.overallReadiness).toBeCloseTo(
      1 - sourced.reduce((sum, value) => sum + value, 0) / sourced.length,
      6
    );
  });

  it("nulls each unsourceable dimension without letting it drag readiness", () => {
    const decision = build({
      analysis: analysisFixture({
        dataQuality: Number.NaN,
        bookmakerMargin: Number.NaN,
        consensusBookmakerCount: undefined,
        consensusMaxProbabilitySpread: null,
        economicConfidence: undefined,
        evidenceQuality: "acceptable"
      })
    });

    expect(decision.uncertainty.model).toBeNull();
    expect(decision.uncertainty.market).toBeNull();
    expect(decision.uncertainty.calibration).toBeNull();
    // `evidenceQuality` is a required field, so data coverage is the one
    // dimension always sourceable — readiness is its inverse alone here, not a
    // mean diluted by dimensions we know nothing about.
    expect(decision.uncertainty.dataCoverage).toBeCloseTo(0.15, 6);
    expect(decision.uncertainty.overallReadiness).toBeCloseTo(0.85, 6);
  });
});

describe("purity and identity", () => {
  it("returns the same payload for the same inputs", () => {
    const analysis = analysisFixture();
    const summary = summaryFixture({ allMarketAnalyses: [analysis] });
    const once = buildPublicDecision({ analysis, summary, now: NOW });
    const twice = buildPublicDecision({ analysis, summary, now: NOW });

    expect(once).toStrictEqual(twice);
  });

  it("depends on the injected clock, not the wall clock", () => {
    const analysis = analysisFixture();
    const summary = summaryFixture({ allMarketAnalyses: [analysis] });
    const fresh = buildPublicDecision({ analysis, summary, consensusMethod: "median-no-vig-v1", now: NOW });
    const stale = buildPublicDecision({
      analysis,
      summary,
      consensusMethod: "median-no-vig-v1",
      now: new Date("2026-08-07T00:00:00.000Z")
    });

    expect(fresh.candidateState).toBe("positive_candidate");
    expect(stale.candidateState).toBe("stale_candidate");
  });

  it("carries the identity of the selection it describes", () => {
    const decision = build();

    expect(decision.contractVersion).toBe(1);
    expect(decision.fixtureId).toBe("fixture-1");
    expect(decision.marketId).toBe("match_winner");
    expect(decision.selectionId).toBe("home");
    expect(decision.generatedAt).toBe("2026-08-06T11:45:00.000Z");
    expect(decision.expiresAt).toBe("2026-08-06T12:40:00.000Z");
  });

  it("falls back to the assembly time when the summary timestamp is unusable", () => {
    const analysis = analysisFixture();
    const decision = buildPublicDecision({
      analysis,
      summary: summaryFixture({ allMarketAnalyses: [analysis], generatedAt: "" }),
      now: NOW
    });

    expect(decision.generatedAt).toBe(NOW.toISOString());
  });
});
