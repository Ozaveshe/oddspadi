import { describe, expect, it } from "vitest";
import {
  buildTodayRails,
  curateBoard,
  isAfricaRelevant,
  scoreFixture,
  type RankableFixture,
  type ViewerContext
} from "@/lib/discovery/fixtureRanking";
import { EMPTY_FILTERS, applyFilters, parseFilters, type DiscoveryFilters } from "@/lib/discovery/filters";
import { assertTablesSeparate, buildOfficialTable, projectionDisclosure, type ProjectedTable, type StandingRow } from "@/lib/discovery/tableState";
import { buildMatchIntelligence } from "@/lib/match/matchIntelligence";

const NOW = "2026-08-01T12:00:00.000Z";

function fixture(overrides: Partial<RankableFixture> = {}): RankableFixture {
  return {
    fixtureId: overrides.fixtureId ?? "api-football:1",
    sport: "football",
    competition: "Premier League",
    competitionSlug: "premier-league",
    country: "England",
    homeTeam: "Arsenal",
    awayTeam: "Chelsea",
    kickoffAt: "2026-08-01T13:00:00.000Z",
    status: "scheduled",
    competitionTier: "top-five",
    hasModelCoverage: true,
    hasOfficialDecision: false,
    evidenceScore: 0.8,
    lastUpdatedAt: "2026-08-01T11:30:00.000Z",
    settledRecently: false,
    ...overrides
  };
}

const viewer: ViewerContext = {
  followedTeams: [],
  followedCompetitions: [],
  preferredSports: [],
  savedFixtureIds: [],
  region: "africa",
  now: NOW
};

describe("ranking is personal before it is generic", () => {
  it("puts a followed team above a bigger unfollowed match", () => {
    const big = fixture({ fixtureId: "big", competition: "Champions League", competitionTier: "global" });
    const mine = fixture({
      fixtureId: "mine",
      competition: "Nigeria Premier Football League",
      competitionSlug: "npfl",
      country: "Nigeria",
      competitionTier: "regional",
      homeTeam: "Enyimba",
      awayTeam: "Kano Pillars"
    });
    const board = curateBoard([big, mine], { ...viewer, followedTeams: ["Enyimba"] });
    expect(board.items[0]!.fixture.fixtureId).toBe("mine");
    expect(board.items[0]!.reason).toContain("follow");
  });

  it("explains why every fixture is on the board", () => {
    const ranked = scoreFixture(fixture(), viewer, Date.parse(NOW));
    expect(ranked.contributions.length).toBeGreaterThan(0);
    expect(ranked.reason).toBeTruthy();
    // The score must be the sum of its stated parts, or the explanation lies.
    expect(ranked.score).toBe(ranked.contributions.reduce((sum, entry) => sum + entry.points, 0));
  });

  it("does not rank on the model's verdict — a pass ranks like a pick", () => {
    const withPick = fixture({ fixtureId: "pick", hasOfficialDecision: true });
    const withPass = fixture({ fixtureId: "pass", hasOfficialDecision: false });
    const pickScore = scoreFixture(withPick, viewer, Date.parse(NOW)).score;
    const passScore = scoreFixture(withPass, viewer, Date.parse(NOW)).score;
    // Publication adds a modest amount; it must not dominate importance.
    expect(pickScore - passScore).toBeLessThanOrEqual(12);
  });

  it("lifts live fixtures and demotes matches that are not being played", () => {
    const live = scoreFixture(fixture({ status: "live" }), viewer, Date.parse(NOW)).score;
    const postponed = scoreFixture(fixture({ status: "postponed" }), viewer, Date.parse(NOW)).score;
    expect(live).toBeGreaterThan(postponed);
  });

  it("recognises Africa relevance by country, tier and competition name", () => {
    expect(isAfricaRelevant(fixture({ country: "Nigeria" }))).toBe(true);
    expect(isAfricaRelevant(fixture({ country: null, competitionTier: "africa-primary" }))).toBe(true);
    expect(isAfricaRelevant(fixture({ country: "Spain", competition: "CAF Champions League", competitionTier: "continental" }))).toBe(true);
    expect(isAfricaRelevant(fixture({ country: "England" }))).toBe(false);
  });
});

describe("breadth is preserved, the board is not flooded", () => {
  const flood: RankableFixture[] = Array.from({ length: 40 }, (_, index) =>
    fixture({
      fixtureId: `itf-${index}`,
      sport: "tennis",
      competition: "ITF Futures",
      competitionSlug: "itf-futures",
      competitionTier: "regional",
      country: "Tunisia",
      homeTeam: `Player ${index}A`,
      awayTeam: `Player ${index}B`
    })
  );
  const marquee = [
    fixture({ fixtureId: "epl-1", homeTeam: "Arsenal", awayTeam: "Chelsea" }),
    fixture({ fixtureId: "epl-2", homeTeam: "Liverpool", awayTeam: "Everton" })
  ];

  it("caps a single competition so it cannot own the default board", () => {
    const board = curateBoard([...flood, ...marquee], viewer, { maxPerCompetition: 3 });
    const itfCount = board.items.filter((entry) => entry.fixture.competition === "ITF Futures").length;
    expect(itfCount).toBeLessThanOrEqual(3);
    expect(board.items.some((entry) => entry.fixture.fixtureId.startsWith("epl"))).toBe(true);
  });

  it("reports what the caps held back instead of hiding it", () => {
    const board = curateBoard([...flood, ...marquee], viewer, { maxPerCompetition: 3 });
    expect(board.heldBack.total).toBeGreaterThan(0);
    expect(board.heldBack.competition["ITF Futures"]).toBeGreaterThan(0);
    // The full catalogue is still countable, so "see all" can be offered.
    expect(board.catalogueSize).toBe(42);
  });

  it("never deletes coverage — every held-back fixture is still filterable", () => {
    const all = [...flood, ...marquee];
    const filtered = applyFilters(all, { ...EMPTY_FILTERS, sports: ["tennis"] }, {
      savedFixtureIds: [],
      followedTeams: [],
      followedCompetitions: []
    });
    expect(filtered.length).toBe(40);
  });

  it("lets a followed team bypass the diversity cap", () => {
    const board = curateBoard([...flood, ...marquee], { ...viewer, followedTeams: ["Player 20A"] }, { maxPerCompetition: 1 });
    expect(board.items.some((entry) => entry.fixture.fixtureId === "itf-20")).toBe(true);
  });
});

describe("today rails are complementary, not repetitive", () => {
  it("splits the same ranked board into named rails", () => {
    // Distinct competitions: sharing one would let the diversity cap decide
    // which rails get populated, which is not what this test is about.
    const fixtures = [
      fixture({ fixtureId: "live-1", status: "live", competition: "Serie A", competitionSlug: "serie-a" }),
      fixture({ fixtureId: "soon-1", kickoffAt: "2026-08-01T12:45:00.000Z", competition: "La Liga", competitionSlug: "la-liga" }),
      fixture({ fixtureId: "mine-1", homeTeam: "Enyimba", country: "Nigeria", competition: "NPFL", competitionSlug: "npfl" }),
      fixture({ fixtureId: "done-1", status: "finished", settledRecently: true, competition: "Bundesliga", competitionSlug: "bundesliga" }),
      fixture({ fixtureId: "pick-1", hasOfficialDecision: true, competition: "Ligue 1", competitionSlug: "ligue-1" })
    ];
    const board = curateBoard(fixtures, { ...viewer, followedTeams: ["Enyimba"] });
    const rails = buildTodayRails(board, { ...viewer, followedTeams: ["Enyimba"] });

    expect(rails.liveNow.map((entry) => entry.fixture.fixtureId)).toContain("live-1");
    expect(rails.startingSoon.map((entry) => entry.fixture.fixtureId)).toContain("soon-1");
    expect(rails.followed.map((entry) => entry.fixture.fixtureId)).toContain("mine-1");
    expect(rails.recentlySettled.map((entry) => entry.fixture.fixtureId)).toContain("done-1");
    expect(rails.officialDecisions.map((entry) => entry.fixture.fixtureId)).toContain("pick-1");
    // "Top matches" excludes what is already personal, so rails complement.
    expect(rails.topMatches.map((entry) => entry.fixture.fixtureId)).not.toContain("mine-1");
  });
});

describe("filters", () => {
  const context = { savedFixtureIds: ["saved-1"], followedTeams: ["Arsenal"], followedCompetitions: ["npfl"] };
  // Only one fixture may carry the followed team, or the followed filter is
  // untestable — the default fixture's home team is Arsenal.
  const fixtures = [
    fixture({ fixtureId: "saved-1", homeTeam: "Spurs", awayTeam: "Fulham" }),
    fixture({ fixtureId: "followed-team", homeTeam: "Arsenal", awayTeam: "Brentford" }),
    fixture({ fixtureId: "no-model", homeTeam: "Leeds", awayTeam: "Burnley", hasModelCoverage: false, evidenceScore: null }),
    fixture({ fixtureId: "live", homeTeam: "Brighton", awayTeam: "Palace", status: "live" })
  ];

  it("filters by saved, followed, coverage and status", () => {
    const only = (filters: Partial<DiscoveryFilters>) =>
      applyFilters(fixtures, { ...EMPTY_FILTERS, ...filters }, context).map((entry) => entry.fixtureId);
    expect(only({ saved: true })).toEqual(["saved-1"]);
    expect(only({ followed: true })).toEqual(["followed-team"]);
    expect(only({ modelCovered: true })).not.toContain("no-model");
    expect(only({ status: ["live"] })).toEqual(["live"]);
  });

  it("treats unknown evidence as not complete", () => {
    const result = applyFilters(fixtures, { ...EMPTY_FILTERS, evidenceComplete: true }, context);
    expect(result.map((entry) => entry.fixtureId)).not.toContain("no-model");
  });

  it("survives a corrupt or hand-edited stored value", () => {
    expect(parseFilters(null)).toEqual(EMPTY_FILTERS);
    expect(parseFilters({ sports: "football", status: ["nonsense"], date: "not-a-date" })).toEqual(EMPTY_FILTERS);
    const parsed = parseFilters({ sports: ["football"], status: ["live"], date: "2026-08-01", saved: true });
    expect(parsed.sports).toEqual(["football"]);
    expect(parsed.status).toEqual(["live"]);
    expect(parsed.date).toBe("2026-08-01");
    expect(parsed.saved).toBe(true);
  });
});

describe("official table versus projection", () => {
  const preSeason: StandingRow[] = ["Wolves", "Arsenal", "Chelsea"].map((teamName) => ({
    teamId: teamName,
    teamName,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0
  }));

  it("refuses to rank a pre-season table", () => {
    const table = buildOfficialTable(preSeason);
    expect(table.state).toBe("season-not-started");
    if (table.state !== "season-not-started") return;
    // Alphabetical, and crucially no position field exists to be misread.
    expect(table.rows.map((row) => row.teamName)).toEqual(["Arsenal", "Chelsea", "Wolves"]);
    expect(table.rows[0]).not.toHaveProperty("position");
    expect(table.label).toBe("Season not started");
  });

  it("ranks properly once matches have been played", () => {
    const table = buildOfficialTable([
      { ...preSeason[0]!, played: 1, won: 1, points: 3, goalsFor: 2 },
      { ...preSeason[1]!, played: 1, lost: 1, points: 0, goalsAgainst: 2 },
      { ...preSeason[2]!, played: 1, drawn: 1, points: 1 }
    ]);
    expect(table.state).toBe("in-progress");
    if (table.state !== "in-progress") return;
    expect(table.rows[0]!.position).toBe(1);
    expect(table.rows[0]!.teamName).toBe("Wolves");
  });

  it("reports unavailable rather than an empty table when standings cannot be read", () => {
    const table = buildOfficialTable(null);
    expect(table.state).toBe("unavailable");
  });

  it("keeps projections labelled as simulations and out of the official table", () => {
    const projection: ProjectedTable = {
      kind: "simulation",
      competition: "Premier League",
      modelVersion: "football-v4",
      evidenceDate: "2026-07-31",
      simulationCount: 10000,
      knownMissingInputs: ["confirmed lineups"],
      lastUpdatedAt: "2026-08-01T06:00:00.000Z",
      rows: [{ teamName: "Arsenal", titleProbability: 0.24, top4Probability: 0.71, relegationProbability: 0.01 }]
    };
    expect(assertTablesSeparate(buildOfficialTable(preSeason), projection)).toEqual([]);
    const disclosure = projectionDisclosure(projection);
    expect(disclosure).toContain("Simulated 10,000 times");
    expect(disclosure).toContain("not standings");
    expect(disclosure).toContain("confirmed lineups");
  });

  it("flags a projection missing its provenance", () => {
    const bad = {
      kind: "simulation" as const,
      competition: "x",
      modelVersion: "",
      evidenceDate: "",
      simulationCount: 1,
      knownMissingInputs: [],
      lastUpdatedAt: "",
      rows: []
    };
    expect(assertTablesSeparate(buildOfficialTable(preSeason), bad)).toContain(
      "projection is missing its model version or evidence date"
    );
  });
});

describe("one fixture identity across every state", () => {
  /**
   * The same fixture id must carry through scheduled → live → finished with
   * its pre-match model record intact. A second identity for the live version
   * is how saved state and history get lost.
   */
  const baseInput = (status: "scheduled" | "live" | "finished", score: { home: number; away: number } | null) => ({
    fixture: {
      id: "api-football:99",
      status,
      kickoffAt: "2026-08-01T11:00:00.000Z",
      homeTeam: "Arsenal",
      awayTeam: "Chelsea",
      competition: "Premier League",
      country: "England",
      venue: "Emirates",
      homeScore: score?.home ?? null,
      awayScore: score?.away ?? null,
      minute: status === "live" ? 55 : null,
      lastVerifiedAt: NOW
    },
    odds: { current: [], historical: [], observedAt: null, bookmakerCount: 0, unavailableReason: null },
    model: {
      run: {
        modelFamily: "Dixon-Coles score model",
        modelVersion: "football-v4",
        generatedAt: "2026-08-01T10:00:00.000Z",
        evidenceCutoffAt: "2026-08-01T09:55:00.000Z",
        calibrationState: "calibrated" as const,
        probabilities: { home: 0.5, draw: 0.27, away: 0.23 },
        interval: null,
        isLiveRun: false
      },
      marketProbabilities: null
    },
    decision: { publicStatus: "no_clear_value", noPickReason: null, factors: [] },
    publication: null,
    evidence: {
      fixtureIdentityConfidence: 0.95,
      teamDataCoverage: 0.8,
      lineupCoverage: 1,
      calibrationSupport: 0.7,
      sourceCoverage: 0.9
    },
    timelineEvents: [{ at: "2026-08-01T10:00:00.000Z", kind: "model-generated" as const, summary: "Model view generated" }],
    now: NOW
  });

  it("keeps the same identity and pre-match record from scheduled to live to finished", () => {
    const scheduled = buildMatchIntelligence(baseInput("scheduled", null));
    const live = buildMatchIntelligence(baseInput("live", { home: 1, away: 0 }));
    const finished = buildMatchIntelligence(baseInput("finished", { home: 2, away: 1 }));

    // One canonical identity.
    for (const view of [scheduled, live, finished]) {
      expect(view.header.homeTeam).toBe("Arsenal");
      // The pre-match model survives every transition, unchanged.
      expect(view.model.state).toBe("available");
      if (view.model.state === "available") {
        expect(view.model.generatedAt).toBe("2026-08-01T10:00:00.000Z");
        expect(view.model.probabilities.home).toBe(0.5);
      }
      // The pre-match record is never rewritten by the result.
      expect(view.timeline.some((event) => event.kind === "model-generated")).toBe(true);
    }

    expect(scheduled.phase).toBe("upcoming");
    expect(live.phase).toBe("live");
    expect(finished.phase).toBe("finished");
    expect(live.header.score).toEqual({ home: 1, away: 0 });
    expect(finished.header.score).toEqual({ home: 2, away: 1 });

    // Action language exists before the match and disappears after it.
    expect(scheduled.actionLanguageAllowed).toBe(true);
    expect(live.actionLanguageAllowed).toBe(true);
    expect(finished.actionLanguageAllowed).toBe(false);

    // A live fixture shown a pre-match model must say so.
    if (live.model.state === "available") expect(live.model.basisNote).toContain("pre-match");
  });
});
