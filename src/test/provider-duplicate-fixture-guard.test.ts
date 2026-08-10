import { describe, expect, it } from "vitest";
import { oddsOnlyMatchesToAppend } from "@/lib/sports/providers/providerBackedProvider";
import { personNamesAlign, teamNamesAlign } from "@/lib/sports/providers/teamNameAlignment";

/**
 * Odds-only entries exist to cover matches the fixture provider does not list.
 * Football already refuses to append one that aligns with a fixture it holds;
 * basketball and tennis compared exact event keys only, so every WNBA game
 * arrived twice — measured 2026-08-03, `api-basketball | Golden State Valkyries
 * W vs Toronto Tempo W` sat beside `the-odds-api-events | Golden State Valkyries
 * vs Toronto Tempo` four minutes apart.
 */
function identity(homeName: string, awayName: string, kickoffTime = "2026-08-03T00:30:00.000Z") {
  return { kickoffTime, homeTeam: { name: homeName }, awayTeam: { name: awayName } };
}

describe("odds-only fixtures that duplicate a stored provider fixture", () => {
  it("drops an odds event whose qualifier the fixture provider states on both sides", () => {
    const fixtures = [identity("Golden State Valkyries W", "Toronto Tempo W")];
    const oddsEvents = [identity("Golden State Valkyries", "Toronto Tempo", "2026-08-03T00:34:00.000Z")];

    expect(oddsOnlyMatchesToAppend(fixtures, oddsEvents, teamNamesAlign)).toEqual([]);
  });

  it("keeps an odds event for a match the fixture provider does not list", () => {
    const fixtures = [identity("Golden State Valkyries W", "Toronto Tempo W")];
    const oddsEvents = [identity("Seattle Storm", "Las Vegas Aces")];

    expect(oddsOnlyMatchesToAppend(fixtures, oddsEvents, teamNamesAlign)).toHaveLength(1);
  });

  // Without the qualifier rule this drops a real women's fixture's prices on the
  // grounds that the men's team is already covered.
  it("keeps an odds event whose qualifier moves on one side only", () => {
    const fixtures = [identity("Barcelona W", "Espanyol")];
    const oddsEvents = [identity("Barcelona", "Espanyol")];

    expect(oddsOnlyMatchesToAppend(fixtures, oddsEvents, teamNamesAlign)).toHaveLength(1);
  });

  it("keeps an odds event kicking off outside the alignment tolerance", () => {
    const fixtures = [identity("Golden State Valkyries W", "Toronto Tempo W")];
    const oddsEvents = [identity("Golden State Valkyries", "Toronto Tempo", "2026-08-03T02:00:00.000Z")];

    expect(oddsOnlyMatchesToAppend(fixtures, oddsEvents, teamNamesAlign)).toHaveLength(1);
  });

  // Tennis joins on people, where the club matcher's three-character floor makes
  // every "Zverev" the same player.
  it("uses the person matcher to separate players who share a surname", () => {
    const fixtures = [identity("A. Zverev", "C. Alcaraz")];
    const oddsEvents = [identity("M. Zverev", "C. Alcaraz")];

    expect(oddsOnlyMatchesToAppend(fixtures, oddsEvents, personNamesAlign)).toHaveLength(1);
  });
});
