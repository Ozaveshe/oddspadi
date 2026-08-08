import { describe, expect, it } from "vitest";
import {
  decideDisposition,
  MASS_NULL_SHARE,
  OVERROUND_CEILING,
  validateBatch,
  validateFixture,
  validateOdds,
  type FixtureCandidate,
  type OddsCandidate
} from "@/lib/features/ingestionValidation";

function fixture(overrides: Partial<FixtureCandidate> = {}): FixtureCandidate {
  return {
    externalId: "af-1",
    sport: "football",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    kickoffAt: "2026-08-08T19:00:00.000Z",
    season: "2026",
    homeScore: 2,
    awayScore: 1,
    observedAt: "2026-08-08T21:00:00.000Z",
    ...overrides
  };
}

function kinds(findings: { kind: string }[]): string[] {
  return findings.map((finding) => finding.kind);
}

describe("fixture validation", () => {
  it("accepts a plausible fixture", () => {
    expect(validateFixture(fixture())).toEqual([]);
  });

  it("rejects an impossible score", () => {
    const findings = validateFixture(fixture({ homeScore: 97 }));
    expect(kinds(findings)).toContain("impossible_score");
    expect(findings[0]?.disposition).toBe("reject");
  });

  it("scales plausibility by sport", () => {
    // 97 is absurd in football and unremarkable in basketball.
    expect(validateFixture(fixture({ sport: "basketball", homeScore: 97, awayScore: 94 }))).toEqual([]);
    expect(kinds(validateFixture(fixture({ sport: "tennis", homeScore: 9 })))).toContain("impossible_score");
  });

  it("rejects a negative or fractional score", () => {
    expect(kinds(validateFixture(fixture({ homeScore: -1 })))).toContain("impossible_score");
    expect(kinds(validateFixture(fixture({ awayScore: 1.5 })))).toContain("impossible_score");
  });

  it("rejects a fixture against itself", () => {
    // An identity failure upstream, not a fixture.
    const findings = validateFixture(fixture({ awayTeam: "Arsenal" }));
    expect(kinds(findings)).toContain("reversed_participants");
    expect(findings[0]?.disposition).toBe("reject");
  });

  it("quarantines a duplicate rather than rejecting it", () => {
    // Odds may be stranded on either row, so merging is an operator decision.
    const findings = validateFixture(fixture(), { knownExternalIds: new Set(["af-1"]) });
    expect(kinds(findings)).toContain("duplicate_fixture");
    expect(findings[0]?.disposition).toBe("quarantine");
  });

  it("quarantines a season that disagrees with the competition", () => {
    expect(kinds(validateFixture(fixture(), { expectedSeason: "2025" }))).toContain("inconsistent_season");
  });

  it("quarantines a score observed before kickoff", () => {
    const findings = validateFixture(
      fixture({ observedAt: "2026-08-08T18:00:00.000Z" })
    );
    expect(kinds(findings)).toContain("timestamp_after_event");
  });

  it("does not complain about a scoreless fixture observed before kickoff", () => {
    // A scheduled fixture legitimately has no score.
    expect(
      validateFixture(fixture({ homeScore: null, awayScore: null, observedAt: "2026-08-08T18:00:00.000Z" }))
    ).toEqual([]);
  });
});

describe("odds validation", () => {
  function odds(overrides: Partial<OddsCandidate> = {}): OddsCandidate {
    return {
      market: "match_winner",
      selections: [
        { selection: "home", decimalOdds: 2.1 },
        { selection: "draw", decimalOdds: 3.4 },
        { selection: "away", decimalOdds: 3.8 }
      ],
      expectedSelections: 3,
      observedAt: "2026-08-08T18:00:00.000Z",
      kickoffAt: "2026-08-08T19:00:00.000Z",
      ...overrides
    };
  }

  it("accepts a complete, sanely priced market", () => {
    expect(validateOdds(odds())).toEqual([]);
  });

  it("rejects odds of 1.0 or below", () => {
    // Implies no return on a winning bet.
    const findings = validateOdds(
      odds({ selections: [{ selection: "home", decimalOdds: 1 }, { selection: "draw", decimalOdds: 3.4 }, { selection: "away", decimalOdds: 3.8 }] })
    );
    expect(kinds(findings)).toContain("odds_below_evens");
    expect(findings[0]?.disposition).toBe("reject");
  });

  it("quarantines an incomplete market", () => {
    const findings = validateOdds(
      odds({ selections: [{ selection: "home", decimalOdds: 2.1 }, { selection: "away", decimalOdds: 3.8 }] })
    );
    expect(kinds(findings)).toContain("incomplete_market");
    expect(findings[0]?.detail).toContain("de-vigged");
  });

  it("quarantines an excessive overround", () => {
    const findings = validateOdds(
      odds({ selections: [{ selection: "home", decimalOdds: 1.5 }, { selection: "draw", decimalOdds: 2.5 }, { selection: "away", decimalOdds: 2.5 }] })
    );
    expect(kinds(findings)).toContain("excessive_overround");
  });

  it("does not compute an overround on an incomplete market", () => {
    // Two of three prices always sum below the ceiling; reporting that as a
    // healthy overround would hide the missing selection.
    const findings = validateOdds(
      odds({ selections: [{ selection: "home", decimalOdds: 1.1 }, { selection: "draw", decimalOdds: 1.1 }] })
    );
    expect(kinds(findings)).toContain("incomplete_market");
    expect(kinds(findings)).not.toContain("excessive_overround");
  });

  it("accepts a normal bookmaker margin", () => {
    const overround = [2.1, 3.4, 3.8].reduce((sum, o) => sum + 1 / o, 0);
    expect(overround).toBeLessThan(OVERROUND_CEILING);
    expect(validateOdds(odds())).toEqual([]);
  });
});

describe("batch validation", () => {
  it("catches a field that went mostly null", () => {
    const findings = validateBatch({
      source: "api-football",
      rows: 100,
      nullCounts: { lineup: 80, score: 2 },
      currentFields: ["lineup", "score"]
    });
    expect(kinds(findings)).toEqual(["suspicious_mass_nulls"]);
    expect(findings[0]?.detail).toContain("lineup");
  });

  it("does not fire below the threshold", () => {
    const findings = validateBatch({
      source: "api-football",
      rows: 100,
      nullCounts: { lineup: MASS_NULL_SHARE * 100 - 1 },
      currentFields: ["lineup"]
    });
    expect(findings).toEqual([]);
  });

  it("catches a parser that stopped producing a field", () => {
    // The quietest failure of the set: nothing errors and rows keep arriving.
    const findings = validateBatch({
      source: "api-tennis",
      rows: 50,
      nullCounts: {},
      previousFields: ["sets", "games", "surface"],
      currentFields: ["sets", "games"]
    });
    expect(kinds(findings)).toContain("parser_drift");
    expect(findings[0]?.detail).toContain("surface");
  });

  it("does not treat a new field as drift", () => {
    const findings = validateBatch({
      source: "api-tennis",
      rows: 50,
      nullCounts: {},
      previousFields: ["sets"],
      currentFields: ["sets", "games"]
    });
    expect(findings).toEqual([]);
  });

  it("says nothing about an empty batch", () => {
    expect(validateBatch({ source: "x", rows: 0, nullCounts: { a: 0 }, currentFields: [] })).toEqual([]);
  });
});

describe("disposition", () => {
  it("accepts when there is nothing to say", () => {
    expect(decideDisposition([]).disposition).toBe("accept");
  });

  it("lets the worst finding win", () => {
    // A row both duplicated and impossible is rejected, not quarantined.
    const decision = decideDisposition([
      { kind: "duplicate_fixture", disposition: "quarantine", detail: "" },
      { kind: "impossible_score", disposition: "reject", detail: "" }
    ]);
    expect(decision.disposition).toBe("reject");
    expect(decision.findings[0]?.kind).toBe("impossible_score");
  });

  it("is never rescued by an accept among findings", () => {
    const decision = decideDisposition([
      { kind: "parser_drift", disposition: "accept", detail: "" },
      { kind: "excessive_overround", disposition: "quarantine", detail: "" }
    ]);
    expect(decision.disposition).toBe("quarantine");
  });

  it("names every finding in the summary", () => {
    const decision = decideDisposition([
      { kind: "duplicate_fixture", disposition: "quarantine", detail: "" },
      { kind: "inconsistent_season", disposition: "quarantine", detail: "" }
    ]);
    expect(decision.summary).toContain("duplicate_fixture");
    expect(decision.summary).toContain("inconsistent_season");
  });

  it("has no disposition that repairs", () => {
    // A repair looks like a fix and behaves like a fabrication.
    const dispositions = ["accept", "quarantine", "reject"];
    expect(dispositions).not.toContain("correct");
    expect(dispositions).not.toContain("repair");
  });
});
