import { describe, expect, it } from "vitest";
import { findDuplicateFixtures } from "@/lib/sports/intelligence/duplicateFixtures";

/**
 * One real match, stored twice under two providers. Measured 2026-08-03:
 * "Lanus vs Instituto de Córdoba" (the-odds-api-events) ended `abandoned` with
 * no reachable result, while "Lanus vs Instituto Cordoba" (api-football) at the
 * same kickoff finished 0-1.
 */
function row(overrides: Partial<Parameters<typeof findDuplicateFixtures>[0][number]> = {}) {
  return {
    id: "row-1",
    sport: "football",
    provider: "api-football",
    externalId: "api-football:1",
    kickoffAt: "2026-08-03T00:30:00.000Z",
    status: "finished",
    homeTeamName: "Lanus",
    awayTeamName: "Instituto Cordoba",
    homeScore: 0 as number | null,
    awayScore: 1 as number | null,
    ...overrides
  };
}

describe("cross-provider fixture duplicate detection", () => {
  it("groups two providers' rows for the same match and makes the results-backed one canonical", () => {
    const oddsOnly = row({
      id: "row-2",
      provider: "the-odds-api-events",
      externalId: "the-odds-api:25b07fc0",
      status: "abandoned",
      awayTeamName: "Instituto de Córdoba",
      homeScore: null,
      awayScore: null
    });

    const { groups } = findDuplicateFixtures([oddsOnly, row()]);

    expect(groups).toHaveLength(1);
    expect(groups[0].canonical.id).toBe("row-1");
    expect(groups[0].duplicates.map((duplicate) => duplicate.id)).toEqual(["row-2"]);
  });

  // The safety property. `teamNamesAlign` discards tokens under three
  // characters, so "Barcelona W" aligns with "Barcelona" on its own. Merging on
  // that alone would fold a women's fixture into the men's one and settle a pick
  // from the wrong match.
  it("refuses a pair where only one side carries the women's qualifier", () => {
    const mixed = row({ id: "row-2", provider: "the-odds-api-events", externalId: "the-odds-api:a", homeTeamName: "Lanus W" });

    const { groups } = findDuplicateFixtures([mixed, row()]);

    expect(groups).toHaveLength(0);
  });

  /**
   * The Odds API never states the qualifier; api-basketball always does. Measured
   * 2026-08-03: "Golden State Valkyries vs Toronto Tempo" at 00:34 and
   * "Golden State Valkyries W vs Toronto Tempo W" at 00:30 are one WNBA game.
   * The qualifier moves on both sides together, so it says which provider is
   * speaking, not which match this is.
   */
  it("accepts a pair whose qualifier moves on both sides together", () => {
    const wnba = {
      sport: "basketball",
      kickoffAt: "2026-08-03T00:30:00.000Z",
      homeTeamName: "Golden State Valkyries W",
      awayTeamName: "Toronto Tempo W"
    };
    const oddsOnly = row({
      ...wnba,
      id: "row-2",
      provider: "the-odds-api-events",
      externalId: "the-odds-api:b69cd4ef",
      kickoffAt: "2026-08-03T00:34:00.000Z",
      status: "abandoned",
      homeTeamName: "Golden State Valkyries",
      awayTeamName: "Toronto Tempo",
      homeScore: null,
      awayScore: null
    });

    const { groups } = findDuplicateFixtures([oddsOnly, row({ ...wnba, provider: "api-basketball", homeScore: 51, awayScore: 56 })]);

    expect(groups).toHaveLength(1);
    expect(groups[0].canonical.provider).toBe("api-basketball");
  });

  /**
   * The qualifier rule is only safe while the pairing is forced. A club fielding
   * two squads at one kickoff gives a provider that states no qualifier two
   * indistinguishable rows, and nothing in the names says which is which — so
   * report the cluster and merge none of it.
   */
  it("refuses a cluster a provider covers more than once and reports it for review", () => {
    const kickoff = { kickoffAt: "2026-08-03T18:00:00.000Z" };
    const { groups, review } = findDuplicateFixtures([
      row({ ...kickoff, id: "row-1", provider: "api-football", externalId: "api-football:1" }),
      row({ ...kickoff, id: "row-2", provider: "api-football", externalId: "api-football:2", homeTeamName: "Lanus W", awayTeamName: "Instituto Cordoba W" }),
      row({ ...kickoff, id: "row-3", provider: "the-odds-api-events", externalId: "the-odds-api:a", homeScore: null, awayScore: null })
    ]);

    expect(groups).toHaveLength(0);
    expect(review).toHaveLength(1);
    expect(review[0].rows.map((entry) => entry.id).sort()).toEqual(["row-1", "row-2", "row-3"]);
  });

  // A merge justified by identical names is stronger evidence than one that had
  // to cross a qualifier, so the two are counted apart rather than summed.
  it("labels whether the pairing needed the qualifier rule", () => {
    const kickoff = "2026-08-03T00:30:00.000Z";
    const identical = findDuplicateFixtures([
      row({ id: "row-2", provider: "the-odds-api-events", externalId: "the-odds-api:a", awayTeamName: "Instituto de Córdoba", homeScore: null, awayScore: null }),
      row()
    ]);
    const crossed = findDuplicateFixtures([
      row({ id: "row-4", sport: "basketball", provider: "the-odds-api-events", externalId: "the-odds-api:b", kickoffAt: kickoff, homeTeamName: "Golden State Valkyries", awayTeamName: "Toronto Tempo", homeScore: null, awayScore: null }),
      row({ id: "row-3", sport: "basketball", provider: "api-basketball", externalId: "api-basketball:1", kickoffAt: kickoff, homeTeamName: "Golden State Valkyries W", awayTeamName: "Toronto Tempo W" })
    ]);

    expect(identical.groups[0].qualifierMatch).toBe("exact");
    expect(crossed.groups[0].qualifierMatch).toBe("uniform");
  });

  // Two rows, no results-backed provider, same evidence: the choice still has to
  // be the same on every run, or the slate changes shape between reads.
  it("chooses the same canonical row whichever order the rows arrive in", () => {
    const left = row({ id: "row-1", provider: "the-odds-api-events", externalId: "the-odds-api:a", homeScore: null, awayScore: null });
    const right = row({ id: "row-2", provider: "betfair-events", externalId: "betfair:b", homeScore: null, awayScore: null });

    const forward = findDuplicateFixtures([left, right]);
    const reverse = findDuplicateFixtures([right, left]);

    expect(forward.groups[0].canonical.id).toBe(reverse.groups[0].canonical.id);
  });
});
