/**
 * Walk-forward training and per-market calibration of the football engine on
 * the standard corpus.
 *
 *   npm run training:football-corpus
 *   npm run training:football-corpus -- --csv path/to/matches.csv --rho -0.06
 *
 * Two questions, answered on real history rather than assumed:
 *
 * 1. TEAM STRENGTHS (step 2). Online stochastic-gradient fit of a Dixon-Coles
 *    style model: per-team log attack/defense, per-competition scoring rate,
 *    and a global home advantage. Every prediction is made BEFORE that match's
 *    result updates any parameter, so the evaluation is walk-forward by
 *    construction — nothing a fixture's own future leaks into its forecast.
 *
 * 2. GOAL-LINE CALIBRATION (step 1). Market probabilities are derived through
 *    the SAME `buildScoreMatrix` + `applyDixonColesAdjustment` code the runtime
 *    uses — imported, not reimplemented — so a hot or cold O/U line here is the
 *    product's line, not a lookalike's. 1X2 is additionally benchmarked against
 *    the corpus's no-vig closing prices; the corpus carries no totals odds, so
 *    goal lines are judged on predicted-vs-actual frequency, which is the
 *    calibration question anyway.
 *
 * The first season is treated as burn-in (parameters warming from zero) and
 * excluded from evaluation. Nothing here writes to any database.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { applyDixonColesAdjustment, buildScoreMatrix, probabilityFromScoreMatrix, topScorelines } from "@/lib/sports/prediction/poisson";

function arg(name: string, fallback: string | null = null): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const csvPath = arg("csv", "training-data/expanded-v2/standard-v2/datasets/football_matches_multileague_3_seasons.csv")!;
const oddsPath = arg("odds", "training-data/expanded-v2/standard-v2/datasets/football_odds_multileague_3_seasons.csv")!;
const outPath = arg("out", null);
const fixedRho = arg("rho", null);

/** Minimal RFC4180 reader; some team names carry quoted commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (char === "\r") continue;
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

type CorpusMatch = {
  matchId: string;
  season: string;
  competition: string;
  date: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
};

function loadMatches(): CorpusMatch[] {
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const header = rows[0];
  const col = Object.fromEntries(header.map((name, index) => [name, index]));
  return rows
    .slice(1)
    .filter((row) => row.length === header.length && row[col.status] === "finished")
    .map((row) => ({
      matchId: row[col.match_id],
      season: row[col.season],
      competition: row[col.competition_code],
      date: row[col.match_date],
      home: row[col.home_team],
      away: row[col.away_team],
      homeGoals: Number(row[col.home_score]),
      awayGoals: Number(row[col.away_score])
    }))
    .filter((match) => Number.isFinite(match.homeGoals) && Number.isFinite(match.awayGoals))
    .sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
}

/** Closing no-vig 1X2 by match id, for the market benchmark. */
function loadClosingNoVig(): Map<string, { home: number; draw: number; away: number }> {
  const rows = parseCsv(readFileSync(oddsPath, "utf8"));
  const header = rows[0];
  const col = Object.fromEntries(header.map((name, index) => [name, index]));
  const byMatch = new Map<string, Record<string, number>>();
  for (const row of rows.slice(1)) {
    if (row.length !== header.length) continue;
    if (row[col.market] !== "h2h_3way" || row[col.is_closing] !== "true") continue;
    const odds = Number(row[col.decimal_odds]);
    if (!Number.isFinite(odds) || odds <= 1) continue;
    const entry = byMatch.get(row[col.match_id]) ?? {};
    // Several books can close; keep the median-ish by averaging implieds.
    const key = row[col.selection];
    entry[key] = entry[key] === undefined ? 1 / odds : (entry[key] + 1 / odds) / 2;
    byMatch.set(row[col.match_id], entry);
  }
  const result = new Map<string, { home: number; draw: number; away: number }>();
  for (const [matchId, implied] of byMatch) {
    const { home, draw, away } = implied as { home?: number; draw?: number; away?: number };
    if (!home || !draw || !away) continue;
    const total = home + draw + away;
    if (total <= 0) continue;
    result.set(matchId, { home: home / total, draw: draw / total, away: away / total });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Online walk-forward fit
// ---------------------------------------------------------------------------

type FitParams = {
  /** SGD step for team attack/defense (Poisson log-likelihood gradient). */
  teamRate: number;
  /** Slower steps for shared parameters so one wild match cannot move them. */
  competitionRate: number;
  homeRate: number;
  rho: number;
};

type Prediction = {
  match: CorpusMatch;
  lambdaHome: number;
  lambdaAway: number;
  teamMatchCounts: number;
};

function runFit(matches: CorpusMatch[], params: FitParams): Prediction[] {
  const attack = new Map<string, number>();
  const defense = new Map<string, number>();
  const seen = new Map<string, number>();
  // Per-competition log of half the mean total, initialised to the global
  // football prior (~2.6 goals a match).
  const competitionMu = new Map<string, number>();
  let homeAdvantage = 0.22;
  const predictions: Prediction[] = [];

  for (const match of matches) {
    const key = (team: string) => `${match.competition}:${team}`;
    const homeKey = key(match.home);
    const awayKey = key(match.away);
    const mu = competitionMu.get(match.competition) ?? Math.log(2.6 / 2);
    const aH = attack.get(homeKey) ?? 0;
    const dH = defense.get(homeKey) ?? 0;
    const aA = attack.get(awayKey) ?? 0;
    const dA = defense.get(awayKey) ?? 0;

    const lambdaHome = Math.min(6, Math.exp(mu + aH - dA + homeAdvantage));
    const lambdaAway = Math.min(6, Math.exp(mu + aA - dH));
    const matchesSeen = Math.min(seen.get(homeKey) ?? 0, seen.get(awayKey) ?? 0);
    predictions.push({ match, lambdaHome, lambdaAway, teamMatchCounts: matchesSeen });

    // Poisson log-likelihood gradients w.r.t. the log-parameters are simply
    // (goals - lambda); bound them so a 7-0 does not detonate a rating.
    const gradHome = Math.max(-2.5, Math.min(2.5, match.homeGoals - lambdaHome));
    const gradAway = Math.max(-2.5, Math.min(2.5, match.awayGoals - lambdaAway));
    // New teams move faster until they have a record of their own.
    const warmup = (count: number) => (count < 6 ? 2.5 : count < 12 ? 1.5 : 1);
    const homeWarm = warmup(seen.get(homeKey) ?? 0);
    const awayWarm = warmup(seen.get(awayKey) ?? 0);

    attack.set(homeKey, aH + params.teamRate * homeWarm * gradHome);
    defense.set(awayKey, dA - params.teamRate * awayWarm * gradHome);
    attack.set(awayKey, aA + params.teamRate * awayWarm * gradAway);
    defense.set(homeKey, dH - params.teamRate * homeWarm * gradAway);
    competitionMu.set(match.competition, mu + params.competitionRate * (gradHome + gradAway));
    homeAdvantage += params.homeRate * gradHome - params.homeRate * gradAway;
    seen.set(homeKey, (seen.get(homeKey) ?? 0) + 1);
    seen.set(awayKey, (seen.get(awayKey) ?? 0) + 1);
  }

  return predictions;
}

// ---------------------------------------------------------------------------
// Per-market evaluation through the production matrix
// ---------------------------------------------------------------------------

type Sample = { p: number; won: 0 | 1 };

function summarise(samples: Sample[]) {
  const n = samples.length;
  if (!n) return null;
  const baseRate = samples.reduce((sum, sample) => sum + sample.won, 0) / n;
  const brier = samples.reduce((sum, sample) => sum + (sample.p - sample.won) ** 2, 0) / n;
  const reference = samples.reduce((sum, sample) => sum + (baseRate - sample.won) ** 2, 0) / n;
  const buckets = Array.from({ length: 10 }, (_, index) => {
    const inBucket = samples.filter((sample) => sample.p >= index / 10 && sample.p < (index + 1) / 10 + (index === 9 ? 0.01 : 0));
    if (!inBucket.length) return null;
    const predicted = inBucket.reduce((sum, sample) => sum + sample.p, 0) / inBucket.length;
    const actual = inBucket.reduce((sum, sample) => sum + sample.won, 0) / inBucket.length;
    return { label: `${(index / 10).toFixed(1)}`, n: inBucket.length, predicted, actual, gap: predicted - actual };
  }).filter((bucket): bucket is NonNullable<typeof bucket> => bucket !== null);
  const ece = buckets.reduce((sum, bucket) => sum + (bucket.n / n) * Math.abs(bucket.gap), 0);
  return { n, baseRate, brier, reference, skill: reference > 0 ? 1 - brier / reference : 0, ece, buckets };
}

function evaluate(predictions: Prediction[], rho: number, closing: Map<string, { home: number; draw: number; away: number }>) {
  const perMarket = new Map<string, Sample[]>();
  const add = (market: string, p: number, won: boolean) => {
    if (!perMarket.has(market)) perMarket.set(market, []);
    perMarket.get(market)!.push({ p, won: won ? 1 : 0 });
  };
  const marketBrier: number[] = [];
  const modelBrierVsMarket: number[] = [];
  let logLossModel = 0;
  let logLossMarket = 0;
  let benchmarked = 0;
  let correctScoreTopHits = 0;
  let correctScoreTotal = 0;

  for (const prediction of predictions) {
    const { match, lambdaHome, lambdaAway } = prediction;
    const matrix = applyDixonColesAdjustment(buildScoreMatrix(lambdaHome, lambdaAway), lambdaHome, lambdaAway, rho);
    const total = match.homeGoals + match.awayGoals;
    const pHome = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > cell.awayGoals);
    const pDraw = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals === cell.awayGoals);
    const pAway = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals < cell.awayGoals);

    add("1x2_home", pHome, match.homeGoals > match.awayGoals);
    add("1x2_draw", pDraw, match.homeGoals === match.awayGoals);
    add("1x2_away", pAway, match.homeGoals < match.awayGoals);
    for (const line of [0.5, 1.5, 2.5, 3.5, 4.5]) {
      add(`over_${line}`, probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals + cell.awayGoals > line), total > line);
    }
    add("btts_yes", probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > 0 && cell.awayGoals > 0), match.homeGoals > 0 && match.awayGoals > 0);
    add("home_over_1.5", probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > 1.5), match.homeGoals > 1.5);
    add("away_over_1.5", probabilityFromScoreMatrix(matrix, (cell) => cell.awayGoals > 1.5), match.awayGoals > 1.5);
    add("clean_sheet_home", probabilityFromScoreMatrix(matrix, (cell) => cell.awayGoals === 0), match.awayGoals === 0);

    const leaders = topScorelines(matrix, 1);
    if (leaders.length) {
      correctScoreTotal += 1;
      if (leaders[0].homeGoals === match.homeGoals && leaders[0].awayGoals === match.awayGoals) correctScoreTopHits += 1;
    }

    const market = closing.get(match.matchId);
    if (market) {
      benchmarked += 1;
      const won = { home: match.homeGoals > match.awayGoals ? 1 : 0, draw: match.homeGoals === match.awayGoals ? 1 : 0, away: match.homeGoals < match.awayGoals ? 1 : 0 };
      marketBrier.push((market.home - won.home) ** 2 + (market.draw - won.draw) ** 2 + (market.away - won.away) ** 2);
      modelBrierVsMarket.push((pHome - won.home) ** 2 + (pDraw - won.draw) ** 2 + (pAway - won.away) ** 2);
      const clamp = (value: number) => Math.min(1 - 1e-9, Math.max(1e-9, value));
      const actual = won.home ? "home" : won.draw ? "draw" : "away";
      logLossModel -= Math.log(clamp(actual === "home" ? pHome : actual === "draw" ? pDraw : pAway));
      logLossMarket -= Math.log(clamp(market[actual]));
    }
  }

  return { perMarket, marketBrier, modelBrierVsMarket, benchmarked, logLossModel, logLossMarket, correctScoreTopHits, correctScoreTotal };
}

// ---------------------------------------------------------------------------

const matches = loadMatches();
const closing = loadClosingNoVig();
const seasons = [...new Set(matches.map((match) => match.season))].sort();
const burnInSeason = seasons[0];
console.log(`corpus: ${matches.length} finished matches, seasons ${seasons.join(", ")}; burn-in ${burnInSeason}`);
console.log(`closing 1X2 prices for ${closing.size} matches`);

// Modest grids; the tuning split is the burn-in season itself so the
// evaluation seasons stay untouched by any selection decision.
const teamRates = [0.03, 0.05, 0.08];
// The per-competition scoring rate is the level knob: too slow and every total
// runs cold in leagues that score more than the prior, which is exactly what
// the first run measured (overs 2-3 points under across the ladder).
const competitionRates = [0.01, 0.03, 0.06];
const rhoGrid = fixedRho !== null ? [Number(fixedRho)] : [-0.04, -0.06, -0.09];

let best: { teamRate: number; competitionRate: number; rho: number; logLoss: number } | null = null;
for (const teamRate of teamRates) {
  for (const competitionRate of competitionRates) {
  const fitted = runFit(matches, { teamRate, competitionRate, homeRate: 0.004, rho: -0.06 });
  const tuning = fitted.filter((prediction) => prediction.match.season === burnInSeason && prediction.teamMatchCounts >= 8);
  for (const rho of rhoGrid) {
    let logLoss = 0;
    let counted = 0;
    for (const prediction of tuning) {
      const matrix = applyDixonColesAdjustment(buildScoreMatrix(prediction.lambdaHome, prediction.lambdaAway), prediction.lambdaHome, prediction.lambdaAway, rho);
      const pHome = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > cell.awayGoals);
      const pDraw = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals === cell.awayGoals);
      const pAway = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals < cell.awayGoals);
      const clamp = (value: number) => Math.min(1 - 1e-9, Math.max(1e-9, value));
      const actual = prediction.match.homeGoals > prediction.match.awayGoals ? pHome : prediction.match.homeGoals === prediction.match.awayGoals ? pDraw : pAway;
      logLoss -= Math.log(clamp(actual));
      counted += 1;
    }
    const mean = counted ? logLoss / counted : Number.POSITIVE_INFINITY;
    if (!best || mean < best.logLoss) best = { teamRate, competitionRate, rho, logLoss: mean };
  }
  }
}
console.log(`tuned on burn-in season: teamRate=${best!.teamRate} competitionRate=${best!.competitionRate} rho=${best!.rho} (log-loss ${best!.logLoss.toFixed(4)})`);

const fitted = runFit(matches, { teamRate: best!.teamRate, competitionRate: best!.competitionRate, homeRate: 0.004, rho: best!.rho });
// Evaluation: later seasons only, and only once both teams have a track record
// the online fit could actually have learned from.
const evaluated = fitted.filter((prediction) => prediction.match.season !== burnInSeason && prediction.teamMatchCounts >= 8);
console.log(`evaluating ${evaluated.length} predictions across ${new Set(evaluated.map((prediction) => prediction.match.season)).size} held-out seasons\n`);

// GOAL-LEVEL CALIBRATION (step 1's correction). The uncorrected fit under-
// predicted every over line and BTTS by 2-3 points in the same direction —
// a level bias in expected goals, not noise. The scale is fitted on the
// burn-in season only (actual goals per predicted goal) so the held-out
// seasons never inform their own correction.
const burnIn = fitted.filter((prediction) => prediction.match.season === burnInSeason && prediction.teamMatchCounts >= 8);
const actualBurnInGoals = burnIn.reduce((sum, prediction) => sum + prediction.match.homeGoals + prediction.match.awayGoals, 0);
const predictedBurnInGoals = burnIn.reduce((sum, prediction) => sum + prediction.lambdaHome + prediction.lambdaAway, 0);
const goalScale = predictedBurnInGoals > 0 ? actualBurnInGoals / predictedBurnInGoals : 1;
console.log(`goal-level scale fitted on burn-in: ${goalScale.toFixed(4)} (actual/predicted goals)\n`);
const scaled = evaluated.map((prediction) => ({
  ...prediction,
  lambdaHome: prediction.lambdaHome * goalScale,
  lambdaAway: prediction.lambdaAway * goalScale
}));

const uncorrected = evaluate(evaluated, best!.rho, closing);
console.log("BEFORE goal-level correction (totals family only):");
for (const market of ["over_1.5", "over_2.5", "over_3.5", "btts_yes"]) {
  const summary = summarise(uncorrected.perMarket.get(market)!)!;
  const predicted = uncorrected.perMarket.get(market)!.reduce((sum, sample) => sum + sample.p, 0) / summary.n;
  console.log(`  ${market.padEnd(10)} predicted=${predicted.toFixed(3)}  actual=${summary.baseRate.toFixed(3)}  ECE=${summary.ece.toFixed(4)}`);
}
console.log("");

const result = evaluate(scaled, best!.rho, closing);

console.log("PER-MARKET CALIBRATION (held-out, walk-forward)");
for (const [market, samples] of [...result.perMarket.entries()]) {
  const summary = summarise(samples)!;
  const flag = summary.ece > 0.05 ? "  <-- miscalibrated" : "";
  console.log(
    `  ${market.padEnd(16)} n=${String(summary.n).padStart(6)}  predicted=${(samples.reduce((sum, sample) => sum + sample.p, 0) / samples.length).toFixed(3)}  actual=${summary.baseRate.toFixed(3)}  Brier=${summary.brier.toFixed(4)}  skill=${summary.skill >= 0 ? "+" : ""}${summary.skill.toFixed(4)}  ECE=${summary.ece.toFixed(4)}${flag}`
  );
}

console.log(`\n1X2 VS CLOSING MARKET (n=${result.benchmarked})`);
const meanModel = result.modelBrierVsMarket.reduce((sum, value) => sum + value, 0) / Math.max(1, result.modelBrierVsMarket.length);
const meanMarket = result.marketBrier.reduce((sum, value) => sum + value, 0) / Math.max(1, result.marketBrier.length);
console.log(`  model multi-Brier  ${meanModel.toFixed(4)}   log-loss ${(result.logLossModel / Math.max(1, result.benchmarked)).toFixed(4)}`);
console.log(`  market multi-Brier ${meanMarket.toFixed(4)}   log-loss ${(result.logLossMarket / Math.max(1, result.benchmarked)).toFixed(4)}`);
console.log(`  model ${meanModel <= meanMarket ? "MATCHES OR BEATS" : "trails"} the closing market by ${(meanMarket - meanModel).toFixed(4)} Brier`);
console.log(`\n  top-scoreline hit rate: ${(result.correctScoreTopHits / Math.max(1, result.correctScoreTotal) * 100).toFixed(1)}% of ${result.correctScoreTotal}`);

if (outPath) {
  mkdirSync(outPath.replace(/[\\/][^\\/]+$/, ""), { recursive: true });
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        corpus: csvPath,
        matches: matches.length,
        evaluated: evaluated.length,
        tuned: best,
        markets: Object.fromEntries([...result.perMarket.entries()].map(([market, samples]) => [market, summarise(samples)]))
      },
      null,
      2
    )
  );
  console.log(`\nartifact written to ${outPath}`);
}
