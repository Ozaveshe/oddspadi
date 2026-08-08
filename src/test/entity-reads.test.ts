import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: getSupabaseServerClientMock
}));

import {
  applyCurrentResult,
  deriveFormFromResults,
  readCompetitionFixtures,
  type EntityFixture
} from "@/lib/entities/entityReads";

const fixture = (extra: Partial<EntityFixture> = {}): EntityFixture => ({
  fixtureId: "api-football:1",
  sport: "football",
  leagueExternalId: "39",
  leagueName: "Premier League",
  country: "England",
  season: "2026",
  kickoffAt: "2026-08-01T15:00:00Z",
  status: "finished",
  homeTeamId: "api-football:33",
  homeTeamName: "Manchester United",
  awayTeamId: "api-football:42",
  awayTeamName: "Arsenal",
  homeScore: 1,
  awayScore: 2,
  scoreSource: "provider",
  hasModelCoverage: false,
  ...extra
});

describe("applyCurrentResult (result-correction propagation)", () => {
  it("a current verified result replaces the provider score", () => {
    const corrected = applyCurrentResult(fixture(), {
      isCurrent: true,
      verificationState: "verified",
      homeScore: 2,
      awayScore: 2
    });
    expect(corrected.homeScore).toBe(2);
    expect(corrected.awayScore).toBe(2);
    expect(corrected.scoreSource).toBe("verified-result");
  });

  it("a superseded correction propagates: only the NEW current row wins", () => {
    // The old (superseded) revision is not current and must not apply.
    const stale = applyCurrentResult(fixture(), {
      isCurrent: false,
      verificationState: "verified",
      homeScore: 9,
      awayScore: 9
    });
    expect(stale.homeScore).toBe(1);
    expect(stale.scoreSource).toBe("provider");
  });

  it("a provisional current row leaves the provider score in place", () => {
    const provisional = applyCurrentResult(fixture(), {
      isCurrent: true,
      verificationState: "provisional",
      homeScore: 3,
      awayScore: 0
    });
    expect(provisional.homeScore).toBe(1);
    expect(provisional.scoreSource).toBe("provider");
  });

  it("no result row keeps the provider score and source", () => {
    expect(applyCurrentResult(fixture(), null).scoreSource).toBe("provider");
    expect(applyCurrentResult(fixture({ homeScore: null, awayScore: null, scoreSource: null }), null).scoreSource).toBeNull();
  });
});

describe("deriveFormFromResults", () => {
  const results = [
    fixture({ fixtureId: "f1", homeTeamId: "team-a", awayTeamId: "team-b", homeScore: 2, awayScore: 0 }),
    fixture({ fixtureId: "f2", homeTeamId: "team-c", awayTeamId: "team-a", homeScore: 1, awayScore: 1 }),
    fixture({ fixtureId: "f3", homeTeamId: "team-a", awayTeamId: "team-d", homeScore: 0, awayScore: 3 }),
    fixture({ fixtureId: "f4", homeTeamId: "team-a", awayTeamId: "team-e", homeScore: null, awayScore: null })
  ];

  it("reads W/D/L from the team's perspective, newest first, skipping unscored fixtures", () => {
    expect(deriveFormFromResults("team-a", results)).toEqual(["W", "D", "L"]);
  });

  it("caps at the limit", () => {
    expect(deriveFormFromResults("team-a", results, 2)).toEqual(["W", "D"]);
  });
});

describe("readCompetitionFixtures", () => {
  function chain(listResult: { data: unknown; error: unknown } = { data: [], error: null }) {
    const c: Record<string, unknown> = {};
    for (const method of ["select", "eq", "in", "is", "gte", "lte", "order", "limit"]) c[method] = vi.fn(() => c);
    (c as { then: unknown }).then = (resolve: (value: unknown) => unknown) => Promise.resolve(listResult).then(resolve);
    return c as Record<string, ReturnType<typeof vi.fn>> & { then: unknown };
  }

  beforeEach(() => getSupabaseServerClientMock.mockReset());

  it("returns unavailable, never zeros-as-truth, without a client", async () => {
    getSupabaseServerClientMock.mockReturnValue(null);
    const read = await readCompetitionFixtures("39");
    expect(read.availability).toBe("unavailable");
    expect(read.upcoming).toEqual([]);
  });

  it("filters by league id and flags model coverage by external id", async () => {
    const fixtures = chain({
      data: [
        {
          id: "db-1",
          external_id: "api-football:100",
          sport: "football",
          league_external_id: "39",
          league_name: "Premier League",
          country: "England",
          season: "2026",
          kickoff_at: "2026-08-10T15:00:00Z",
          status: "scheduled",
          home_team_external_id: "api-football:33",
          home_team_name: "Manchester United",
          away_team_external_id: "api-football:42",
          away_team_name: "Arsenal",
          home_score: null,
          away_score: null
        }
      ],
      error: null
    });
    const coverage = chain({ data: [{ fixture_external_id: "api-football:100" }], error: null });
    const resultsChain = chain({ data: [], error: null });
    // The module issues three op_fixtures queries (upcoming, live, results);
    // only the first returns the row so each list stays distinct.
    const fixtureChains = [fixtures, chain(), chain()];
    const from = vi.fn((table: string) =>
      table === "op_fixture_decision_summaries" ? coverage : table === "op_fixture_results" ? resultsChain : fixtureChains.shift() ?? chain()
    );
    getSupabaseServerClientMock.mockReturnValue({ from });

    const read = await readCompetitionFixtures("39", { now: new Date("2026-08-09T12:00:00Z") });
    expect(read.availability).toBe("live");
    expect(fixtures.in).toHaveBeenCalledWith("league_external_id", ["39", "api-football:39"]);
    const covered = [...read.upcoming, ...read.liveNow, ...read.results].filter((f) => f.hasModelCoverage);
    expect(covered.map((f) => f.fixtureId)).toEqual(["api-football:100"]);
  });
});

describe("entity read indexes migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20260809120000_entity_read_indexes.sql"),
    "utf8"
  );
  it("indexes the league filters the entity reads use", () => {
    expect(migration).toContain("op_fixtures_league_kickoff_idx");
    expect(migration).toContain("op_fixtures_league_status_idx");
  });
});
