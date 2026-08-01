import { describe, expect, it } from "vitest";
import {
  buildMatchIntelligence,
  matchDataAvailability,
  EVIDENCE_DEFINITIONS,
  type MatchIntelligence,
  type MatchIntelligenceInput
} from "@/lib/match/matchIntelligence";

/**
 * Contradiction tests for the match page.
 *
 * The page previously derived the same state in several components, so it
 * could show stored odds beside "no odds available", or tell a reader to
 * "monitor before kickoff" on a match that finished hours earlier. These
 * scenarios cover the fixture states that exist in production, and the
 * assertions at the bottom run against *every* scenario so a new state cannot
 * be added without satisfying them.
 */
const NOW = "2026-08-01T18:00:00.000Z";
const KICKOFF = "2026-08-01T15:00:00.000Z";
const FUTURE_KICKOFF = "2026-08-02T15:00:00.000Z";

function quote(overrides: Partial<MatchIntelligenceInput["odds"]["current"][number]> = {}) {
  return {
    market: "match_winner",
    selection: "home",
    label: "Home win",
    decimalOdds: 2.1,
    bookmaker: "Consensus",
    observedAt: "2026-08-01T17:30:00.000Z",
    noVigProbability: 0.46,
    ...overrides
  };
}

function baseInput(overrides: Partial<MatchIntelligenceInput> = {}): MatchIntelligenceInput {
  return {
    fixture: {
      id: "api-football:1",
      status: "scheduled",
      kickoffAt: FUTURE_KICKOFF,
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      competition: "Premier League",
      country: "England",
      venue: "Emirates Stadium",
      homeScore: null,
      awayScore: null,
      minute: null,
      lastVerifiedAt: "2026-08-01T17:55:00.000Z",
      ...overrides.fixture
    },
    odds: {
      current: [quote()],
      historical: [],
      observedAt: "2026-08-01T17:30:00.000Z",
      bookmakerCount: 6,
      unavailableReason: null,
      ...overrides.odds
    },
    model: {
      run: {
        modelFamily: "Dixon-Coles",
        modelVersion: "football-v4",
        generatedAt: "2026-08-01T17:00:00.000Z",
        evidenceCutoffAt: "2026-08-01T16:55:00.000Z",
        calibrationState: "calibrated",
        probabilities: { home: 0.48, draw: 0.27, away: 0.25 },
        interval: { low: 0.43, high: 0.53 },
        isLiveRun: false
      },
      marketProbabilities: { home: 0.46, draw: 0.28, away: 0.26 },
      ...overrides.model
    },
    decision: {
      publicStatus: "no_clear_value",
      noPickReason: "The price does not offer a positive edge.",
      factors: [
        { kind: "strength", weight: 0.09, detail: "Arsenal rate higher on attack and defence this season." },
        { kind: "form", weight: 0.04, detail: "Four wins in six for the home side." },
        { kind: "availability", weight: -0.03, detail: "Two defenders are doubtful." },
        { kind: "market-move", weight: 0.01, detail: "The price drifted slightly overnight." },
        { kind: "rest", weight: -0.005, detail: "Both sides had a full week." },
        { kind: "evidence-gap", weight: -0.002, detail: "Lineups are not published yet." }
      ],
      ...overrides.decision
    },
    publication: overrides.publication ?? null,
    evidence: {
      fixtureIdentityConfidence: 0.95,
      teamDataCoverage: 0.8,
      lineupCoverage: 0.2,
      calibrationSupport: 0.7,
      sourceCoverage: 0.85,
      ...overrides.evidence
    },
    timelineEvents: overrides.timelineEvents ?? [
      { at: "2026-08-01T17:00:00.000Z", kind: "model-generated", summary: "Model view generated" },
      { at: "2026-08-01T17:30:00.000Z", kind: "odds-snapshot", summary: "Prices observed from 6 bookmakers" }
    ],
    now: overrides.now ?? NOW
  };
}

const publication = {
  publicationId: "pub-1",
  market: "match_winner",
  selection: "home",
  selectionLabel: "Arsenal to win",
  oddsAtPublication: 2.1,
  publishedAt: "2026-08-01T14:00:00.000Z",
  settlementStatus: "unsettled" as const,
  settledAt: null
};

/** Every production fixture state, built once and asserted over collectively. */
const SCENARIOS: Array<{ name: string; intelligence: MatchIntelligence }> = [
  {
    name: "upcoming with a published pick",
    intelligence: buildMatchIntelligence(baseInput({ decision: { ...baseInput().decision, publicStatus: "value_pick" }, publication }))
  },
  { name: "upcoming with a pass", intelligence: buildMatchIntelligence(baseInput()) },
  {
    name: "upcoming with incomplete odds",
    intelligence: buildMatchIntelligence(
      baseInput({
        odds: { current: [], historical: [], observedAt: null, bookmakerCount: 0, unavailableReason: null },
        decision: { ...baseInput().decision, publicStatus: "needs_data" }
      })
    )
  },
  {
    name: "live with only a pre-match model",
    intelligence: buildMatchIntelligence(
      baseInput({
        fixture: { ...baseInput().fixture, status: "live", kickoffAt: KICKOFF, homeScore: 1, awayScore: 0, minute: 63 }
      })
    )
  },
  {
    name: "live with an approved live model",
    intelligence: buildMatchIntelligence(
      baseInput({
        fixture: { ...baseInput().fixture, status: "live", kickoffAt: KICKOFF, homeScore: 1, awayScore: 0, minute: 63 },
        model: {
          run: { ...baseInput().model.run!, isLiveRun: true, generatedAt: "2026-08-01T17:50:00.000Z" },
          marketProbabilities: baseInput().model.marketProbabilities
        }
      })
    )
  },
  {
    name: "finished with a winning pick",
    intelligence: buildMatchIntelligence(
      baseInput({
        fixture: { ...baseInput().fixture, status: "finished", kickoffAt: KICKOFF, homeScore: 2, awayScore: 0 },
        publication: { ...publication, settlementStatus: "won", settledAt: "2026-08-01T17:00:00.000Z" },
        decision: { ...baseInput().decision, publicStatus: "value_pick" }
      })
    )
  },
  {
    name: "finished with a losing pick",
    intelligence: buildMatchIntelligence(
      baseInput({
        fixture: { ...baseInput().fixture, status: "finished", kickoffAt: KICKOFF, homeScore: 0, awayScore: 2 },
        publication: { ...publication, settlementStatus: "lost", settledAt: "2026-08-01T17:00:00.000Z" },
        decision: { ...baseInput().decision, publicStatus: "value_pick" }
      })
    )
  },
  {
    name: "void match",
    intelligence: buildMatchIntelligence(
      baseInput({
        fixture: { ...baseInput().fixture, status: "cancelled", kickoffAt: KICKOFF },
        publication: { ...publication, settlementStatus: "void", settledAt: "2026-08-01T16:00:00.000Z" }
      })
    )
  },
  {
    name: "postponed match",
    intelligence: buildMatchIntelligence(
      baseInput({ fixture: { ...baseInput().fixture, status: "postponed", kickoffAt: KICKOFF } })
    )
  },
  {
    name: "historical odds but no current odds",
    intelligence: buildMatchIntelligence(
      baseInput({
        odds: {
          current: [],
          historical: [quote({ observedAt: "2026-07-31T09:00:00.000Z" })],
          observedAt: "2026-07-31T09:00:00.000Z",
          bookmakerCount: 1,
          unavailableReason: null
        }
      })
    )
  },
  {
    name: "stale model state",
    intelligence: buildMatchIntelligence(
      baseInput({
        model: {
          run: { ...baseInput().model.run!, generatedAt: "2026-07-31T02:00:00.000Z" },
          marketProbabilities: baseInput().model.marketProbabilities
        }
      })
    )
  },
  {
    name: "unavailable data state",
    intelligence: buildMatchIntelligence(
      baseInput({
        odds: { current: [], historical: [], observedAt: null, bookmakerCount: 0, unavailableReason: "statement timeout" },
        model: { run: null, marketProbabilities: null },
        decision: { publicStatus: null, noPickReason: null, factors: [] }
      })
    )
  }
];

describe("scenario behaviour", () => {
  it("labels an upcoming published pick as actionable with its ledger link", () => {
    const { decision, actionLanguageAllowed } = SCENARIOS[0]!.intelligence;
    expect(decision.status).toBe("pick");
    expect(decision.historical).toBe(false);
    expect(decision.publication?.ledgerHref).toContain("pub-1");
    expect(actionLanguageAllowed).toBe(true);
  });

  it("says a pre-match model is pre-match during live play", () => {
    const model = SCENARIOS[3]!.intelligence.model;
    expect(model.state).toBe("available");
    if (model.state !== "available") return;
    expect(model.basis).toBe("pre-match");
    expect(model.basisNote).toContain("no approved in-play model");
  });

  it("marks an approved live run as live", () => {
    const model = SCENARIOS[4]!.intelligence.model;
    if (model.state !== "available") throw new Error("expected a model");
    expect(model.basis).toBe("live");
    expect(model.basisNote).toBeNull();
  });

  it("turns a finished match's prices into a labelled historical record", () => {
    const odds = SCENARIOS[5]!.intelligence.odds;
    expect(odds.state).toBe("historical-only");
    if (odds.state !== "historical-only") return;
    expect(odds.note).toContain("not current");
  });

  it("shows settlement on a finished published pick", () => {
    expect(SCENARIOS[5]!.intelligence.decision.publication?.settlementStatus).toBe("won");
    expect(SCENARIOS[6]!.intelligence.decision.publication?.settlementStatus).toBe("lost");
    expect(SCENARIOS[7]!.intelligence.decision.publication?.settlementStatus).toBe("void");
  });

  it("distinguishes historical-only odds from no odds", () => {
    expect(SCENARIOS[9]!.intelligence.odds.state).toBe("historical-only");
    expect(SCENARIOS[2]!.intelligence.odds.state).toBe("none");
    expect(SCENARIOS[11]!.intelligence.odds.state).toBe("unavailable");
  });

  it("flags a stale model without hiding it", () => {
    const model = SCENARIOS[10]!.intelligence.model;
    if (model.state !== "available") throw new Error("expected a model");
    expect(model.stale).toBe(true);
    expect(matchDataAvailability(SCENARIOS[10]!.intelligence)).toBe("stale");
  });

  it("reports unavailable when neither odds nor model can be read", () => {
    expect(matchDataAvailability(SCENARIOS[11]!.intelligence)).toBe("unavailable");
    expect(SCENARIOS[11]!.intelligence.decision.status).toBe("unavailable");
  });

  it("keeps at most five factors, strongest first, with direction", () => {
    const factors = SCENARIOS[1]!.intelligence.factors;
    expect(factors.length).toBeLessThanOrEqual(5);
    expect(factors[0]!.kind).toBe("strength");
    expect(factors[0]!.direction).toBe("supports");
    expect(factors.some((factor) => factor.direction === "against")).toBe(true);
  });

  it("derives readiness as the weakest dimension, not an average", () => {
    const evidence = SCENARIOS[1]!.intelligence.evidence;
    const readiness = evidence.find((dimension) => dimension.id === "readiness")!;
    const others = evidence.filter((dimension) => dimension.id !== "readiness").map((dimension) => dimension.score!);
    expect(readiness.score).toBe(Math.min(...others));
  });

  it("keeps the timeline in order and never rewrites it after the result", () => {
    const timeline = SCENARIOS[5]!.intelligence.timeline;
    const times = timeline.map((event) => Date.parse(event.at));
    expect([...times].sort((left, right) => left - right)).toEqual(times);
    // Pre-match events survive the result.
    expect(timeline.some((event) => event.kind === "model-generated")).toBe(true);
  });
});

describe("contradictions are impossible across every scenario", () => {
  it("never allows action language on a terminal fixture", () => {
    for (const { name, intelligence } of SCENARIOS) {
      const terminal = ["finished", "void", "postponed"].includes(intelligence.phase);
      if (terminal) {
        expect(intelligence.actionLanguageAllowed, `${name} must not invite action`).toBe(false);
        expect(intelligence.decision.historical, `${name} decision must be historical`).toBe(true);
      }
    }
  });

  it("never shows odds and 'no odds' at the same time", () => {
    for (const { name, intelligence } of SCENARIOS) {
      const odds = intelligence.odds;
      const hasQuotes = odds.state === "current" || odds.state === "historical-only";
      const claimsNone = odds.state === "none" || odds.state === "in-play-unpriced" || odds.state === "unavailable";
      expect(hasQuotes && claimsNone, `${name} cannot both have and lack odds`).toBe(false);
      if (hasQuotes) expect(odds.quotes.length, `${name} claims quotes but has none`).toBeGreaterThan(0);
    }
  });

  it("never presents a pre-match probability as current during play", () => {
    for (const { name, intelligence } of SCENARIOS) {
      if (intelligence.phase !== "live" || intelligence.model.state !== "available") continue;
      if (intelligence.model.basis === "pre-match") {
        expect(intelligence.model.basisNote, `${name} must disclose the pre-match basis`).toBeTruthy();
      }
    }
  });

  it("never claims a live model without a live run", () => {
    for (const { name, intelligence } of SCENARIOS) {
      if (intelligence.model.state !== "available") continue;
      if (intelligence.model.basis === "live") {
        expect(intelligence.phase, `${name} claims a live model off a live fixture`).toBe("live");
      }
    }
  });

  it("never reports an official pick without a publication timestamp", () => {
    for (const { name, intelligence } of SCENARIOS) {
      const publication = intelligence.decision.publication;
      if (!publication) {
        expect(intelligence.decision.status, `${name} claims a pick with no publication`).not.toBe("pick");
        continue;
      }
      expect(publication.publishedAt, `${name} publication needs a timestamp`).toBeTruthy();
      expect(Number.isFinite(Date.parse(publication.publishedAt))).toBe(true);
    }
  });

  it("never reports settlement without a publication", () => {
    for (const { name, intelligence } of SCENARIOS) {
      const publication = intelligence.decision.publication;
      if (publication?.settlementStatus && publication.settlementStatus !== "unsettled") {
        expect(publication.publicationId, `${name} settled something unpublished`).toBeTruthy();
      }
    }
  });

  it("grades each evidence dimension exactly once, with one shared definition", () => {
    for (const { name, intelligence } of SCENARIOS) {
      const ids = intelligence.evidence.map((dimension) => dimension.id);
      expect(new Set(ids).size, `${name} grades a dimension twice`).toBe(ids.length);
      for (const dimension of intelligence.evidence) {
        expect(dimension.definition, `${name}/${dimension.id} must use the shared definition`).toBe(
          EVIDENCE_DEFINITIONS[dimension.id].definition
        );
      }
    }
  });

  it("never leaks internal machinery into consumer copy", () => {
    // The words that made the old page read as an engineering console.
    const banned = [
      "agent", "protocol", "prompt", "chain-of-thought", "tool execution", "queue",
      "job id", "run id", "supabase", "postgres", "stack trace", "mock", "repair",
      "committee", "self-critique", "reasoning graph", "statement timeout"
    ];
    for (const { name, intelligence } of SCENARIOS) {
      const copy = [
        intelligence.header.stateLabel,
        intelligence.decision.headline,
        intelligence.decision.reason ?? "",
        intelligence.model.state === "available" ? intelligence.model.basisNote ?? "" : intelligence.model.note,
        "note" in intelligence.odds ? intelligence.odds.note : "",
        ...intelligence.factors.map((factor) => `${factor.label} ${factor.detail}`),
        ...intelligence.evidence.map((dimension) => `${dimension.label} ${dimension.definition}`),
        ...intelligence.timeline.map((event) => event.summary)
      ]
        .join(" ")
        .toLowerCase();
      for (const word of banned) {
        expect(copy.includes(word), `${name} leaks "${word}" into consumer copy`).toBe(false);
      }
    }
  });

  it("never shows a score for a fixture that has not produced one", () => {
    for (const { name, intelligence } of SCENARIOS) {
      if (intelligence.phase === "upcoming" || intelligence.phase === "postponed") {
        expect(intelligence.header.score, `${name} shows a score before kickoff`).toBeNull();
      }
      // A minute only makes sense while the match is running.
      if (intelligence.phase !== "live") expect(intelligence.header.minute, `${name} shows a clock`).toBeNull();
    }
  });
});
