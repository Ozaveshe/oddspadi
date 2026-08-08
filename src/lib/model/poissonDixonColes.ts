/**
 * Dixon–Coles Poisson model for football 1X2.
 *
 * Each team carries an attack and a defence strength; expected goals for the
 * home side are exp(attack_home − defence_away + homeAdvantage), away are
 * exp(attack_away − defence_home). Score probabilities come from the product
 * of two Poissons, with the Dixon–Coles tau correction to the four low-score
 * cells (0-0, 1-0, 0-1, 1-1) — independent Poissons systematically misprice
 * exactly those, and those cells decide most draw probability.
 *
 * Fitting is penalised maximum likelihood by gradient ascent with exponential
 * time decay, so last season's matches inform but do not dominate. The decay
 * is a parameter of the *fit*, not something learned from the holdout.
 *
 * 1X2 coherence is by construction: the three probabilities are sums over an
 * exhaustive score grid, so they cannot fail to sum to one.
 */

export type DcMatch = {
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  /** Days before the fit's reference date, for time decay. */
  daysAgo: number;
};

export type DcParams = {
  attack: Map<string, number>;
  defence: Map<string, number>;
  homeAdvantage: number;
  rho: number;
};

export type DcFitOptions = {
  /** Exponential decay per day; 0.0065 halves a match's weight in ~107 days. */
  decayPerDay?: number;
  iterations?: number;
  learningRate?: number;
  /** L2 pull of strengths toward zero — the league mean. */
  ridge?: number;
};

const MAX_GOALS = 8;

function tau(homeGoals: number, awayGoals: number, lambdaHome: number, lambdaAway: number, rho: number): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaHome * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaAway * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

function poisson(k: number, lambda: number): number {
  let result = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) result *= lambda / i;
  return result;
}

export function fitDixonColes(matches: DcMatch[], options: DcFitOptions = {}): DcParams {
  const decay = options.decayPerDay ?? 0.0065;
  const iterations = options.iterations ?? 250;
  const learningRate = options.learningRate ?? 0.02;
  const ridge = options.ridge ?? 0.02;

  const teams = [...new Set(matches.flatMap((match) => [match.homeTeam, match.awayTeam]))];
  const attack = new Map(teams.map((team) => [team, 0]));
  const defence = new Map(teams.map((team) => [team, 0]));
  let homeAdvantage = 0.25;
  let rho = -0.05;

  const weights = matches.map((match) => Math.exp(-decay * Math.max(0, match.daysAgo)));

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const gradAttack = new Map(teams.map((team) => [team, 0]));
    const gradDefence = new Map(teams.map((team) => [team, 0]));
    let gradHome = 0;
    let gradRho = 0;

    for (let index = 0; index < matches.length; index += 1) {
      const match = matches[index]!;
      const weight = weights[index]!;
      const lambdaHome = Math.exp(attack.get(match.homeTeam)! - defence.get(match.awayTeam)! + homeAdvantage);
      const lambdaAway = Math.exp(attack.get(match.awayTeam)! - defence.get(match.homeTeam)!);

      // Poisson log-likelihood gradients: d/dlogλ = (k − λ).
      const dHome = weight * (match.homeGoals - lambdaHome);
      const dAway = weight * (match.awayGoals - lambdaAway);

      gradAttack.set(match.homeTeam, gradAttack.get(match.homeTeam)! + dHome);
      gradDefence.set(match.awayTeam, gradDefence.get(match.awayTeam)! - dHome);
      gradAttack.set(match.awayTeam, gradAttack.get(match.awayTeam)! + dAway);
      gradDefence.set(match.homeTeam, gradDefence.get(match.homeTeam)! - dAway);
      gradHome += dHome;

      // Numerical gradient for rho on the tau term only — the closed form is
      // fiddly per cell, the parameter is one-dimensional, and the fit runs
      // offline where a central difference is cheap and obviously right.
      const t0 = tau(match.homeGoals, match.awayGoals, lambdaHome, lambdaAway, rho - 1e-4);
      const t1 = tau(match.homeGoals, match.awayGoals, lambdaHome, lambdaAway, rho + 1e-4);
      if (t0 > 0 && t1 > 0) {
        gradRho += (weight * (Math.log(t1) - Math.log(t0))) / 2e-4;
      }
    }

    const scale = learningRate / Math.sqrt(matches.length);
    for (const team of teams) {
      attack.set(team, attack.get(team)! + scale * (gradAttack.get(team)! - ridge * attack.get(team)!));
      defence.set(team, defence.get(team)! + scale * (gradDefence.get(team)! - ridge * defence.get(team)!));
    }
    homeAdvantage += scale * gradHome;
    rho = Math.max(-0.2, Math.min(0.2, rho + scale * gradRho));

    // Identifiability: strengths are only defined relative to the league mean,
    // so recentre every pass or the whole surface drifts while fitting nothing.
    const meanAttack = teams.reduce((sum, team) => sum + attack.get(team)!, 0) / teams.length;
    const meanDefence = teams.reduce((sum, team) => sum + defence.get(team)!, 0) / teams.length;
    for (const team of teams) {
      attack.set(team, attack.get(team)! - meanAttack);
      defence.set(team, defence.get(team)! - meanDefence);
    }
  }

  return { attack, defence, homeAdvantage, rho };
}

export type DcPrediction = {
  /** [home, draw, away] — sums to one by construction. */
  probabilities: [number, number, number];
  lambdaHome: number;
  lambdaAway: number;
  /** True when either team was unseen in training; the output is league-mean. */
  usedFallback: boolean;
};

export function predictDixonColes(params: DcParams, homeTeam: string, awayTeam: string): DcPrediction {
  const knownHome = params.attack.has(homeTeam);
  const knownAway = params.attack.has(awayTeam);
  const attackHome = params.attack.get(homeTeam) ?? 0;
  const defenceHome = params.defence.get(homeTeam) ?? 0;
  const attackAway = params.attack.get(awayTeam) ?? 0;
  const defenceAway = params.defence.get(awayTeam) ?? 0;

  const lambdaHome = Math.exp(attackHome - defenceAway + params.homeAdvantage);
  const lambdaAway = Math.exp(attackAway - defenceHome);

  let home = 0;
  let draw = 0;
  let away = 0;
  for (let hg = 0; hg <= MAX_GOALS; hg += 1) {
    for (let ag = 0; ag <= MAX_GOALS; ag += 1) {
      const p =
        poisson(hg, lambdaHome) *
        poisson(ag, lambdaAway) *
        Math.max(0, tau(hg, ag, lambdaHome, lambdaAway, params.rho));
      if (hg > ag) home += p;
      else if (hg === ag) draw += p;
      else away += p;
    }
  }
  const total = home + draw + away;
  return {
    probabilities: [home / total, draw / total, away / total],
    lambdaHome,
    lambdaAway,
    usedFallback: !knownHome || !knownAway
  };
}
