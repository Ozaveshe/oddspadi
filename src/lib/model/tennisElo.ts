/**
 * Tennis Elo with surface blending and rank-prior initialisation.
 *
 * Two design decisions carry this file, and both exist because of traps in
 * the training corpus:
 *
 * 1. **The corpus is winner-canonicalised.** Every row of
 *    tennis_matches_with_scores has winner_side=player_1, and the odds file's
 *    source columns are literally W/L (winner odds, loser odds). Any model or
 *    evaluation that consumes the files as-is "learns" that player_1 wins —
 *    100% accuracy, zero content. `orientationFlip` is the antidote: a
 *    deterministic hash of the match id decides, per match, whether the pair
 *    is presented as (player_1, player_2) or swapped. Both the match file and
 *    the odds file share match ids, so one function orients both identically
 *    and the market prior stays attached to the right player.
 *
 * 2. **Cold starts are the norm.** Tennis draws churn; new names appear every
 *    week. A flat 1500 start throws away the one thing we do know about an
 *    unseen player — their ranking — so initial ratings come from a log curve
 *    on rank, and `usedFallback` is only raised when we had neither history
 *    nor a rank to lean on.
 *
 * Rating structure follows the FiveThirtyEight tennis convention: one overall
 * rating updated on every match, plus a per-surface rating updated only on
 * that surface, blended at prediction time. The blend weight is a parameter
 * of the *fit interface*, selected on validation by the harness — never here,
 * and never on holdout.
 */

export type TennisMatch = {
  matchId: string;
  /** ISO date, for chronological ordering by the caller. */
  date: string;
  surface: string;
  playerA: string;
  playerB: string;
  /** 0 when playerA won, 1 when playerB won. */
  outcome: 0 | 1;
  rankA: number | null;
  rankB: number | null;
};

export type TennisEloParams = {
  overall: Map<string, number>;
  bySurface: Map<string, Map<string, number>>;
  matchCounts: Map<string, number>;
  /** Weight on the surface-specific rating at prediction time, 0..1. */
  surfaceBlend: number;
};

/**
 * FNV-1a over the match id, parity of the low bit.
 *
 * Deterministic (same match always flips the same way, so reruns and the odds
 * join agree), and unkeyed by anything the model could exploit. Roughly half
 * the corpus flips, which is exactly the point: after this, "pick player A"
 * is a coin, and only actual skill moves a metric.
 */
export function orientationFlip(matchId: string): boolean {
  let hash = 0x811c9dc5;
  for (let index = 0; index < matchId.length; index += 1) {
    hash ^= matchId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // Avalanche before taking a bit: multiplying by an odd constant preserves
  // parity, so FNV-1a's raw low bit is just the XOR of the input's character
  // parities — ids differing only in balanced ways would all flip the same
  // direction. Mixing the high bits down first breaks that.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  hash ^= hash >>> 16;
  return ((hash >>> 0) & 1) === 1;
}

/**
 * Rank-prior initial rating: ~2000 for #1, ~1720 for #10, ~1450 for #100,
 * floored at 1200. Unranked players start below the ranked floor's
 * neighbourhood — in this corpus "no rank" almost always means a qualifier
 * or a wildcard, not a hidden champion.
 */
export function rankPriorRating(rank: number | null): number {
  if (rank === null || !Number.isFinite(rank) || rank < 1) return 1400;
  return Math.max(1200, 2000 - 120 * Math.log(rank));
}

function expectedA(ratingA: number, ratingB: number): number {
  return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

/** FiveThirtyEight decay: new players move fast, veterans settle. */
function kFactor(matchesPlayed: number): number {
  return 250 / (matchesPlayed + 5) ** 0.4;
}

export type TennisEloOptions = {
  surfaceBlend?: number;
};

/**
 * Sequential fit in the order given — the caller supplies chronological
 * order, and the update for match n must not see match n+1.
 */
export function fitTennisElo(matches: TennisMatch[], options: TennisEloOptions = {}): TennisEloParams {
  const surfaceBlend = options.surfaceBlend ?? 0.3;
  const overall = new Map<string, number>();
  const bySurface = new Map<string, Map<string, number>>();
  const matchCounts = new Map<string, number>();

  const surfaceMap = (surface: string): Map<string, number> => {
    let map = bySurface.get(surface);
    if (!map) {
      map = new Map();
      bySurface.set(surface, map);
    }
    return map;
  };

  for (const match of matches) {
    const surface = surfaceMap(match.surface);
    const ratingA = overall.get(match.playerA) ?? rankPriorRating(match.rankA);
    const ratingB = overall.get(match.playerB) ?? rankPriorRating(match.rankB);
    const surfaceA = surface.get(match.playerA) ?? ratingA;
    const surfaceB = surface.get(match.playerB) ?? ratingB;
    const countA = matchCounts.get(match.playerA) ?? 0;
    const countB = matchCounts.get(match.playerB) ?? 0;

    const actualA = match.outcome === 0 ? 1 : 0;

    // Overall ratings update on the overall expectation; surface ratings on
    // the surface expectation. Two ledgers, each self-consistent.
    const deltaOverall = (actualA - expectedA(ratingA, ratingB));
    overall.set(match.playerA, ratingA + kFactor(countA) * deltaOverall);
    overall.set(match.playerB, ratingB - kFactor(countB) * deltaOverall);

    const deltaSurface = (actualA - expectedA(surfaceA, surfaceB));
    surface.set(match.playerA, surfaceA + kFactor(countA) * deltaSurface);
    surface.set(match.playerB, surfaceB - kFactor(countB) * deltaSurface);

    matchCounts.set(match.playerA, countA + 1);
    matchCounts.set(match.playerB, countB + 1);
  }

  return { overall, bySurface, matchCounts, surfaceBlend };
}

export type TennisPrediction = {
  /** [P(playerA wins), P(playerB wins)] — sums to one by construction. */
  probabilities: [number, number];
  /** True when either player had neither match history nor a rank. */
  usedFallback: boolean;
};

export function predictTennisElo(
  params: TennisEloParams,
  playerA: string,
  playerB: string,
  surface: string,
  ranks: { rankA?: number | null; rankB?: number | null } = {}
): TennisPrediction {
  const seenA = params.overall.has(playerA);
  const seenB = params.overall.has(playerB);
  const ratingA = params.overall.get(playerA) ?? rankPriorRating(ranks.rankA ?? null);
  const ratingB = params.overall.get(playerB) ?? rankPriorRating(ranks.rankB ?? null);
  const surfaceRatings = params.bySurface.get(surface);
  const surfaceA = surfaceRatings?.get(playerA) ?? ratingA;
  const surfaceB = surfaceRatings?.get(playerB) ?? ratingB;

  const blend = params.surfaceBlend;
  const effectiveA = (1 - blend) * ratingA + blend * surfaceA;
  const effectiveB = (1 - blend) * ratingB + blend * surfaceB;
  const pA = expectedA(effectiveA, effectiveB);

  const blindA = !seenA && (ranks.rankA === undefined || ranks.rankA === null);
  const blindB = !seenB && (ranks.rankB === undefined || ranks.rankB === null);
  return { probabilities: [pA, 1 - pA], usedFallback: blindA || blindB };
}
