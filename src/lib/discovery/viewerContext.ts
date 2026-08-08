import type { ViewerContext } from "@/lib/discovery/fixtureRanking";

/**
 * The viewer the ranker personalises for.
 *
 * Server components cannot read the follow and save shelves, which live in
 * localStorage so the product works signed out. So this returns the honest
 * server-side view: no follows, no saves, and whatever the request itself
 * says.
 *
 * That is deliberately a floor rather than a guess. Inventing follows to make
 * the ranking look personal would put fixtures at the top of a board for
 * reasons the reader never asked for, and they would have no way to tell.
 * Personalisation belongs in a client pass over the same ranked list.
 */
export function readViewerContext(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return {
    followedTeams: [],
    followedCompetitions: [],
    preferredSports: [],
    savedFixtureIds: [],
    // OddsPadi's first audience. Stated rather than inferred from a header,
    // because a VPN should not change which fixtures a reader is shown.
    region: "africa",
    ...overrides
  };
}
