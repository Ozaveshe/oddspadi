import type { SlateFixture } from "@/lib/sports/intelligence/types";
import type { RankableFixture } from "@/lib/discovery/fixtureRanking";
import type { CardInput } from "@/lib/discovery/fixtureCard";
import { footballLeagueRegistry } from "@/lib/sports/footballLeagues";
import { displayedSlateDecision } from "@/lib/sports/prediction/presentation";

/**
 * The seam between what the slate read returns and what discovery consumes.
 *
 * The ranking engine, the board split and the card were all built against
 * their own contracts and had no consumers, because nothing turned a
 * `SlateFixture` into either shape. This is that function, and it is the only
 * place the mapping lives — two surfaces adapting independently is how one of
 * them ends up ranking on a field the other does not populate.
 *
 * Deliberately lossy in one direction: the slate row carries gate receipts,
 * price signals and evidence detail that a discovery card must not show. None
 * of it crosses.
 */

/** Statuses that mean a claim was actually published. */
const OFFICIAL_STATUSES = new Set<SlateFixture["publicStatus"]>(["value_pick", "lean"]);

/** Statuses whose price is still live enough to act on. */
const ACTIONABLE_STATUSES = new Set<SlateFixture["publicStatus"]>(["value_pick", "lean", "watchlist"]);

/**
 * The slate's fixture status in the card's vocabulary.
 *
 * `suspended` has no card state of its own. It maps to `unknown` rather than
 * to `live` or `cancelled`, because a suspended match is genuinely undecided
 * and guessing either way puts a wrong label on a real fixture.
 */
function cardFixtureStatus(status: SlateFixture["fixture"]["status"]): CardInput["fixtureStatus"] {
  return status === "suspended" ? "unknown" : status;
}

const TIER_BY_SLUG = new Map(footballLeagueRegistry.map((league) => [league.slug, league.tier]));
const TIER_BY_NAME = new Map(footballLeagueRegistry.map((league) => [league.name.toLowerCase(), league.tier]));

/**
 * Competition tier, from the registry rather than guessed from the name.
 *
 * Unknown is the honest default and it ranks lowest — a competition we have not
 * classified is not thereby important, and treating unknown as mid-tier would
 * let every unrecognised feed dominate the board.
 */
export function competitionTier(fixture: SlateFixture): RankableFixture["competitionTier"] {
  const league = fixture.fixture.league?.toLowerCase() ?? "";
  const byName = TIER_BY_NAME.get(league);
  if (byName) return byName;
  const bySlug = TIER_BY_SLUG.get(fixture.fixture.leagueId ?? "");
  return bySlug ?? "unknown";
}

/** The slate's status vocabulary is wider than the ranker's; map, never cast. */
function rankableStatus(status: SlateFixture["fixture"]["status"]): RankableFixture["status"] {
  switch (status) {
    case "scheduled":
    case "live":
    case "finished":
    case "postponed":
    case "cancelled":
    case "suspended":
      return status;
    case "abandoned":
      // The ranker has no abandoned state; it behaves like a cancelled fixture
      // for ordering purposes, and the card still says what actually happened.
      return "cancelled";
    default:
      return "unknown";
  }
}

export function toRankableFixture(row: SlateFixture, options: { settledRecently?: boolean } = {}): RankableFixture {
  const { fixture, decisionSummary } = row;
  const decision = displayedSlateDecision(row);

  return {
    fixtureId: fixture.fixtureId,
    sport: fixture.sport,
    competition: fixture.league,
    competitionSlug: fixture.leagueId ?? null,
    country: fixture.country ?? null,
    homeTeam: fixture.homeTeam.name,
    awayTeam: fixture.awayTeam.name,
    kickoffAt: fixture.kickoffAt,
    status: rankableStatus(fixture.status),
    competitionTier: competitionTier(row),
    // Coverage is "a decision exists", whatever it concluded. A pass counts:
    // relevance is not "the model likes a bet".
    hasModelCoverage: row.decisions.length > 0,
    hasOfficialDecision: OFFICIAL_STATUSES.has(row.publicStatus),
    evidenceScore: typeof fixture.dataQuality === "number" ? fixture.dataQuality : null,
    lastUpdatedAt: decisionSummary?.generatedAt ?? fixture.lastSyncedAt ?? null,
    settledRecently: options.settledRecently ?? false
  };
}

/**
 * Whether the stored price is still worth acting on.
 *
 * The card refuses to show a stale price, so this is the gate that decides
 * whether a pick reads as a pick or as "waiting for current odds". Freshness
 * comes from the slate's own status rather than being recomputed here — two
 * definitions of fresh is how a card and a match page disagree.
 */
function oddsAreCurrent(row: SlateFixture): boolean {
  if (row.fixture.status !== "scheduled") return false;
  return ACTIONABLE_STATUSES.has(row.publicStatus);
}

export function toCardInput(row: SlateFixture): CardInput {
  const decision = displayedSlateDecision(row);
  const status = row.fixture.status;

  return {
    fixtureStatus: cardFixtureStatus(status),
    decision: decisionStatusFor(row),
    hasOfficialPick: OFFICIAL_STATUSES.has(row.publicStatus),
    settlement: null,
    oddsAreCurrent: oddsAreCurrent(row),
    // A fixture with stored quotes but no current ones is exactly the
    // "historical only" state, and the card labels it rather than hiding it.
    hasHistoricalOdds: row.odds.length > 0,
    decimalOdds: decision?.odds ?? null,
    modelProbability: decision?.modelProbability ?? null,
    // Never the engine's own reason string: the card checks for engine
    // vocabulary and would replace it, so passing it is wasted work that
    // occasionally leaks.
    reason: null
  };
}

/**
 * The slate's public status, in the card's decision vocabulary.
 *
 * `settled`, `suspended` and `needs_review` map to `unavailable` rather than to
 * a verdict: none of them is a conclusion about the market, and the card's
 * lifecycle precedence will override the decision on those fixtures anyway.
 */
function decisionStatusFor(row: SlateFixture): CardInput["decision"] {
  switch (row.publicStatus) {
    case "value_pick":
      return "pick";
    case "lean":
      return "lean";
    case "watchlist":
      return "watch";
    case "no_clear_value":
      return "pass";
    case "stale":
      return "withheld";
    case "preliminary":
    case "ready":
    case "needs_data":
    case "suspended":
    case "settled":
    case "needs_review":
      return "unavailable";
  }
}
