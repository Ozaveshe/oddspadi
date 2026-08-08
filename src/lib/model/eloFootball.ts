/**
 * Elo with a Davidson draw parameter — the transparent football baseline.
 *
 * This exists to be beaten. If Dixon–Coles cannot beat a two-parameter rating
 * update on walk-forward folds, that is a finding about Dixon–Coles, and the
 * finding only means something if the baseline is honestly built: sequential
 * updates in match order, no peeking, margin-of-victory scaling, and a draw
 * model fitted rather than assumed.
 *
 * Davidson (1970) extends Bradley–Terry with a draw parameter nu:
 *   P(draw)  ∝ nu * sqrt(pHome' * pAway')
 * where pHome', pAway' are the two-way Elo expectancies. nu is fitted on the
 * training window by one-dimensional search — one parameter, one curve, no
 * optimiser to mistrust.
 */

export type EloMatch = {
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
};

export type EloParams = {
  ratings: Map<string, number>;
  homeAdvantageElo: number;
  nu: number;
  kFactor: number;
};

export type EloOptions = {
  kFactor?: number;
  homeAdvantageElo?: number;
  initialRating?: number;
};

function expectedHome(ratingHome: number, ratingAway: number, homeAdvantageElo: number): number {
  return 1 / (1 + 10 ** ((ratingAway - ratingHome - homeAdvantageElo) / 400));
}

/** Margin multiplier, FiveThirtyEight-style: bigger wins move ratings more, sublinearly. */
function marginFactor(goalDiff: number): number {
  return Math.log(Math.abs(goalDiff) + 1) + 1;
}

export function fitElo(matches: EloMatch[], options: EloOptions = {}): EloParams {
  const kFactor = options.kFactor ?? 20;
  const homeAdvantageElo = options.homeAdvantageElo ?? 60;
  const initial = options.initialRating ?? 1500;
  const ratings = new Map<string, number>();

  // Sequential in the order given — the caller supplies chronological order,
  // and the update for match n must not see match n+1.
  for (const match of matches) {
    const ratingHome = ratings.get(match.homeTeam) ?? initial;
    const ratingAway = ratings.get(match.awayTeam) ?? initial;
    const expected = expectedHome(ratingHome, ratingAway, homeAdvantageElo);
    const actual = match.homeGoals > match.awayGoals ? 1 : match.homeGoals === match.awayGoals ? 0.5 : 0;
    const delta = kFactor * marginFactor(match.homeGoals - match.awayGoals) * (actual - expected);
    ratings.set(match.homeTeam, ratingHome + delta);
    ratings.set(match.awayTeam, ratingAway - delta);
  }

  // Fit nu on the same window: choose the value whose implied draw share
  // matches the observed one. Monotone in nu, so bisection suffices.
  const observedDrawShare = matches.filter((match) => match.homeGoals === match.awayGoals).length / Math.max(1, matches.length);
  let low = 0.1;
  let high = 3;
  for (let step = 0; step < 40; step += 1) {
    const mid = (low + high) / 2;
    let drawMass = 0;
    for (const match of matches) {
      const ratingHome = ratings.get(match.homeTeam) ?? initial;
      const ratingAway = ratings.get(match.awayTeam) ?? initial;
      drawMass += predictWithNu(ratingHome, ratingAway, homeAdvantageElo, mid)[1];
    }
    if (drawMass / Math.max(1, matches.length) < observedDrawShare) low = mid;
    else high = mid;
  }

  return { ratings, homeAdvantageElo, nu: (low + high) / 2, kFactor };
}

function predictWithNu(
  ratingHome: number,
  ratingAway: number,
  homeAdvantageElo: number,
  nu: number
): [number, number, number] {
  const pHome2 = expectedHome(ratingHome, ratingAway, homeAdvantageElo);
  const pAway2 = 1 - pHome2;
  const drawTerm = nu * Math.sqrt(pHome2 * pAway2);
  const total = pHome2 + pAway2 + drawTerm;
  return [pHome2 / total, drawTerm / total, pAway2 / total];
}

export function predictElo(params: EloParams, homeTeam: string, awayTeam: string): {
  probabilities: [number, number, number];
  usedFallback: boolean;
} {
  const knownHome = params.ratings.has(homeTeam);
  const knownAway = params.ratings.has(awayTeam);
  const ratingHome = params.ratings.get(homeTeam) ?? 1500;
  const ratingAway = params.ratings.get(awayTeam) ?? 1500;
  return {
    probabilities: predictWithNu(ratingHome, ratingAway, params.homeAdvantageElo, params.nu),
    usedFallback: !knownHome || !knownAway
  };
}
