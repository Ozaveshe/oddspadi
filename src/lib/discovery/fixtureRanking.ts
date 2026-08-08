/**
 * How OddsPadi decides what to show first.
 *
 * The board is dominated by whatever the providers happen to return, which on
 * a normal day means hundreds of low-tier fixtures from one sport. The fix is
 * not to delete that coverage — it is legitimate, and someone follows every
 * one of those teams — but to rank intelligently and cap how much of the
 * default board any single competition can occupy.
 *
 * Two design rules matter more than the weights:
 *
 * 1. **Relevance is not "the model likes a bet".** A pass on a big match is
 *    more interesting than a pick on a match nobody is watching. Decision
 *    availability contributes, but the model's *verdict* does not: a `pass`
 *    scores the same as a `pick` on the coverage factor.
 * 2. **Every score is explainable.** Each fixture carries the contributions
 *    that produced it, so a curated board can always answer "why is this
 *    here?" — for a user, and for whoever has to debug it later.
 */
export type RankableFixture = {
  fixtureId: string;
  sport: string;
  competition: string;
  competitionSlug: string | null;
  country: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  /** The full fixture-status union; parity with the rest of the product is enforced by test. */
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "suspended" | "unknown";
  /** Tier of the competition, from the registry. Unknown competitions are lowest. */
  competitionTier: "global" | "continental" | "top-five" | "africa-primary" | "regional" | "unknown";
  /** A decision exists for this fixture, whatever its verdict. */
  hasModelCoverage: boolean;
  /** An official pick was published. Distinct from coverage. */
  hasOfficialDecision: boolean;
  /** Evidence completeness, 0..1, from the match evidence dimensions. */
  evidenceScore: number | null;
  /** When the decision or fixture data was last refreshed. */
  lastUpdatedAt: string | null;
  settledRecently: boolean;
};

export type ViewerContext = {
  followedTeams: string[];
  followedCompetitions: string[];
  preferredSports: string[];
  savedFixtureIds: string[];
  /** Drives regional relevance. OddsPadi's first audience is West Africa. */
  region: "africa" | "europe" | "americas" | "asia" | "global";
  now?: string;
};

export type RankingContribution = { factor: string; points: number; why: string };

export type RankedFixture = {
  fixture: RankableFixture;
  score: number;
  contributions: RankingContribution[];
  /** One-line answer to "why am I seeing this?" */
  reason: string;
};

const TIER_POINTS: Record<RankableFixture["competitionTier"], number> = {
  global: 30,
  continental: 24,
  "top-five": 26,
  // Deliberately close to top-five: OddsPadi's audience cares about these more
  // than a mid-table fixture in a European league they cannot watch.
  "africa-primary": 22,
  regional: 8,
  unknown: 4
};

const AFRICAN_COUNTRIES = new Set([
  "Nigeria", "Ghana", "Kenya", "South Africa", "Egypt", "Morocco", "Algeria", "Tunisia",
  "Senegal", "Cameroon", "Ivory Coast", "Côte d'Ivoire", "Zambia", "Tanzania", "Uganda"
]);

export function isAfricaRelevant(fixture: RankableFixture): boolean {
  if (fixture.country && AFRICAN_COUNTRIES.has(fixture.country)) return true;
  if (fixture.competitionTier === "africa-primary") return true;
  // Continental competitions involving African federations surface too.
  return /africa|caf|afcon/i.test(fixture.competition);
}

function minutesUntil(kickoffAt: string, nowMs: number): number {
  const kickoff = Date.parse(kickoffAt);
  return Number.isFinite(kickoff) ? (kickoff - nowMs) / 60_000 : Number.POSITIVE_INFINITY;
}

export function scoreFixture(fixture: RankableFixture, viewer: ViewerContext, nowMs: number): RankedFixture {
  const contributions: RankingContribution[] = [];
  const add = (factor: string, points: number, why: string) => {
    if (points !== 0) contributions.push({ factor, points, why });
  };

  // Personal signals dominate. A followed team's fixture outranks a marquee
  // match the viewer has shown no interest in — that is the whole point of
  // personalisation, and it must not be drowned by generic importance.
  const follows = viewer.followedTeams.map((team) => team.toLowerCase());
  if (follows.includes(fixture.homeTeam.toLowerCase()) || follows.includes(fixture.awayTeam.toLowerCase())) {
    add("followed-team", 60, "You follow one of these teams");
  }
  if (fixture.competitionSlug && viewer.followedCompetitions.includes(fixture.competitionSlug)) {
    add("followed-competition", 35, "You follow this competition");
  }
  if (viewer.savedFixtureIds.includes(fixture.fixtureId)) {
    add("saved", 45, "You saved this match");
  }
  if (viewer.preferredSports.length && viewer.preferredSports.includes(fixture.sport)) {
    add("preferred-sport", 12, "One of your sports");
  }

  add("competition-tier", TIER_POINTS[fixture.competitionTier], "Competition importance");

  if (viewer.region === "africa" && isAfricaRelevant(fixture)) {
    add("region", 18, "Relevant to your region");
  }

  if (fixture.status === "live") {
    add("live", 40, "Live now");
  } else if (fixture.status === "scheduled") {
    const minutes = minutesUntil(fixture.kickoffAt, nowMs);
    if (minutes >= 0 && minutes <= 90) add("starting-soon", 28, "Starting soon");
    else if (minutes > 90 && minutes <= 360) add("today", 14, "Later today");
    else if (minutes < 0) add("kickoff-passed", -20, "Kickoff has passed without a live update");
  } else if (fixture.status === "finished" && fixture.settledRecently) {
    add("recently-settled", 16, "Just finished");
  } else if (fixture.status === "postponed" || fixture.status === "cancelled" || fixture.status === "suspended") {
    add("not-playing", -40, "This match is not being played");
  }

  // Coverage counts; the verdict does not. A pass is a legitimate product
  // state and must not push a fixture down the board.
  if (fixture.hasModelCoverage) add("model-coverage", 14, "OddsPadi has analysed this match");
  if (fixture.hasOfficialDecision) add("official-decision", 12, "An official pick is published");

  if (fixture.evidenceScore !== null) {
    add("evidence", Math.round(fixture.evidenceScore * 10), "Evidence completeness");
  }

  if (fixture.lastUpdatedAt) {
    const ageHours = (nowMs - Date.parse(fixture.lastUpdatedAt)) / 3_600_000;
    if (Number.isFinite(ageHours) && ageHours > 24) add("stale-data", -8, "Data has not refreshed recently");
  }

  const score = contributions.reduce((sum, contribution) => sum + contribution.points, 0);
  const leading = [...contributions].sort((left, right) => right.points - left.points)[0];
  return { fixture, score, contributions, reason: leading?.why ?? "Part of today's catalogue" };
}

export type CurationOptions = {
  /** Max fixtures from one competition on the default board. */
  maxPerCompetition?: number;
  /** Max fixtures from one sport, so a busy tennis day cannot own the board. */
  maxPerSport?: number;
  limit?: number;
};

export type CuratedBoard = {
  items: RankedFixture[];
  /**
   * Every fixture, ranked, before the diversity caps.
   *
   * The caps exist to protect the first screen. Classification and counting
   * must read this instead: capping before the board split shrinks the
   * evidence-archive count, which under-reports how much the engine analysed —
   * and a wrong count is worse than a long list, because it reads as a fact.
   */
  ranked: RankedFixture[];
  /** What the diversity caps held back, so nothing disappears silently. */
  heldBack: { competition: Record<string, number>; sport: Record<string, number>; total: number };
  /** Total catalogue size, so the UI can offer "see all". */
  catalogueSize: number;
};

/**
 * Rank, then enforce diversity.
 *
 * Applying the caps after scoring keeps the two concerns separate: the score
 * says what is most relevant, the caps stop one competition's 40 fixtures
 * occupying the whole board even when each individually outranks the
 * alternatives. Held-back counts are returned rather than dropped, because a
 * board that quietly hides coverage is the failure this system is meant to
 * avoid.
 */
export function curateBoard(
  fixtures: RankableFixture[],
  viewer: ViewerContext,
  { maxPerCompetition = 3, maxPerSport = 12, limit = 40 }: CurationOptions = {}
): CuratedBoard {
  const nowMs = viewer.now ? Date.parse(viewer.now) : Date.now();
  const ranked = fixtures
    .map((fixture) => scoreFixture(fixture, viewer, nowMs))
    .sort((left, right) => right.score - left.score || Date.parse(left.fixture.kickoffAt) - Date.parse(right.fixture.kickoffAt));

  const perCompetition = new Map<string, number>();
  const perSport = new Map<string, number>();
  const heldBackCompetition: Record<string, number> = {};
  const heldBackSport: Record<string, number> = {};
  const items: RankedFixture[] = [];

  for (const entry of ranked) {
    if (items.length >= limit) break;
    const { competition, sport } = entry.fixture;

    // A fixture the viewer personally follows or saved bypasses the caps:
    // those are explicit interest, not algorithmic guesses.
    const personal = entry.contributions.some(
      (contribution) => contribution.factor === "followed-team" || contribution.factor === "saved" || contribution.factor === "followed-competition"
    );
    const competitionCount = perCompetition.get(competition) ?? 0;
    const sportCount = perSport.get(sport) ?? 0;

    if (!personal && competitionCount >= maxPerCompetition) {
      heldBackCompetition[competition] = (heldBackCompetition[competition] ?? 0) + 1;
      continue;
    }
    if (!personal && sportCount >= maxPerSport) {
      heldBackSport[sport] = (heldBackSport[sport] ?? 0) + 1;
      continue;
    }

    items.push(entry);
    perCompetition.set(competition, competitionCount + 1);
    perSport.set(sport, sportCount + 1);
  }

  const total =
    Object.values(heldBackCompetition).reduce((sum, count) => sum + count, 0) +
    Object.values(heldBackSport).reduce((sum, count) => sum + count, 0);

  return {
    items,
    ranked,
    heldBack: { competition: heldBackCompetition, sport: heldBackSport, total },
    catalogueSize: fixtures.length
  };
}

/** Named rails for the Today board, all drawn from one ranked list. */
export type TodayRails = {
  liveNow: RankedFixture[];
  startingSoon: RankedFixture[];
  followed: RankedFixture[];
  topMatches: RankedFixture[];
  africaRelevant: RankedFixture[];
  officialDecisions: RankedFixture[];
  recentlySettled: RankedFixture[];
};

export function buildTodayRails(board: CuratedBoard, viewer: ViewerContext): TodayRails {
  const nowMs = viewer.now ? Date.parse(viewer.now) : Date.now();
  const items = board.items;
  const personal = (entry: RankedFixture) =>
    entry.contributions.some((contribution) => contribution.factor.startsWith("followed") || contribution.factor === "saved");

  return {
    liveNow: items.filter((entry) => entry.fixture.status === "live"),
    startingSoon: items.filter((entry) => {
      const minutes = minutesUntil(entry.fixture.kickoffAt, nowMs);
      return entry.fixture.status === "scheduled" && minutes >= 0 && minutes <= 90;
    }),
    followed: items.filter(personal),
    // "Top" excludes what is already surfaced as live or personal, so the
    // rails complement each other instead of repeating.
    topMatches: items.filter((entry) => entry.fixture.status === "scheduled" && !personal(entry)).slice(0, 8),
    africaRelevant: items.filter((entry) => isAfricaRelevant(entry.fixture)),
    officialDecisions: items.filter((entry) => entry.fixture.hasOfficialDecision),
    recentlySettled: items.filter((entry) => entry.fixture.status === "finished" && entry.fixture.settledRecently)
  };
}
