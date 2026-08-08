#!/usr/bin/env node
/**
 * The model lab's football evaluation run.
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/model-lab-run.ts
 *
 * Chronological, with an untouched holdout:
 *
 *   train      2023-08 → 2025-05   (two full seasons)
 *   validation 2025-08 → 2025-12   (first half of 2025-26)
 *   holdout    2026-01 → end       (touched once, at the end, by everything)
 *
 * Everything selectable — calibration method, blend weight — is selected on
 * validation. The holdout is scored exactly once per contender and the
 * numbers land in docs/model-evaluation-report.md with paired-bootstrap CIs.
 *
 * The market baseline is the Shin-de-vigged closing consensus with Pinnacle
 * given double weight — the strongest honest opponent this corpus can field.
 * Beating a weaker market average would be a result about the average.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { brier, logLoss, pairedBootstrapDiff, summarise, type Forecast } from "@/lib/model/evalMetrics";
import { fitDixonColes, predictDixonColes, type DcMatch } from "@/lib/model/poissonDixonColes";
import { fitElo, predictElo, type EloMatch } from "@/lib/model/eloFootball";
import { fitBlendWeight, selectCalibrator } from "@/lib/model/calibrationFit";
import { shinNoVigProbabilities } from "@/lib/sports/prediction/odds";

const DATA = "training-data/standard-v1/datasets";
const OUTCOME_INDEX: Record<string, number> = { H: 0, D: 1, A: 2 };

type Row = Record<string, string>;

function parseCsv(path: string): Row[] {
  const [headerLine, ...lines] = readFileSync(path, "utf8").split("\n").filter((line) => line.trim());
  const headers = splitCsvLine(headerLine!);
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
  });
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}

type Match = {
  id: string;
  date: string;
  competition: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  outcome: number;
};

const matches: Match[] = parseCsv(`${DATA}/football_matches_2023_24_to_2025_26.csv`)
  .filter((row) => row.status === "finished" && row.result_1x2 in OUTCOME_INDEX)
  .map((row) => ({
    id: row.match_id!,
    date: row.match_date!,
    competition: row.competition_code!,
    home: row.home_team!,
    away: row.away_team!,
    homeGoals: Number(row.home_score),
    awayGoals: Number(row.away_score),
    outcome: OUTCOME_INDEX[row.result_1x2!]!
  }))
  .sort((a, b) => a.date.localeCompare(b.date));

// Closing quotes per match: bookmaker → [home, draw, away].
const closingByMatch = new Map<string, Map<string, [number, number, number]>>();
for (const row of parseCsv(`${DATA}/football_odds_opening_closing_2023_24_to_2025_26.csv`)) {
  if (row.is_closing !== "true" || row.market !== "h2h_3way") continue;
  const byBook = closingByMatch.get(row.match_id!) ?? new Map();
  const quote = byBook.get(row.bookmaker!) ?? ([0, 0, 0] as [number, number, number]);
  const index = row.selection === "home" ? 0 : row.selection === "draw" ? 1 : 2;
  quote[index] = Number(row.decimal_odds);
  byBook.set(row.bookmaker!, quote);
  closingByMatch.set(row.match_id!, byBook);
}

/**
 * The market prior: per-book Shin de-vig, then a weighted average with
 * Pinnacle counted twice. "Market Average"/"Market Maximum" are derived
 * columns, not books, and averaging an average back in double-counts it.
 */
function marketPrior(matchId: string): [number, number, number] | null {
  const byBook = closingByMatch.get(matchId);
  if (!byBook) return null;
  const weighted: Array<{ probabilities: number[]; weight: number }> = [];
  for (const [book, odds] of byBook) {
    if (book === "Market Average" || book === "Market Maximum") continue;
    if (odds.some((value) => !Number.isFinite(value) || value <= 1)) continue;
    const implied = odds.map((value) => 1 / value);
    weighted.push({ probabilities: shinNoVigProbabilities(implied), weight: book === "Pinnacle" ? 2 : 1 });
  }
  if (!weighted.length) return null;
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const combined: [number, number, number] = [0, 0, 0];
  for (const entry of weighted) {
    for (let k = 0; k < 3; k += 1) combined[k] += (entry.weight / total) * entry.probabilities[k]!;
  }
  return combined;
}

const TRAIN_TO = "2025-06-30";
const VALID_TO = "2025-12-31";

const train = matches.filter((match) => match.date <= TRAIN_TO);
const validation = matches.filter((match) => match.date > TRAIN_TO && match.date <= VALID_TO);
const holdout = matches.filter((match) => match.date > VALID_TO);

console.log(`train ${train.length}, validation ${validation.length}, holdout ${holdout.length}`);

const referenceDate = (upTo: string) => new Date(upTo).getTime();
function toDcMatches(rows: Match[], upTo: string): DcMatch[] {
  const reference = referenceDate(upTo);
  return rows.map((match) => ({
    homeTeam: match.home,
    awayTeam: match.away,
    homeGoals: match.homeGoals,
    awayGoals: match.awayGoals,
    daysAgo: (reference - new Date(match.date).getTime()) / 86_400_000
  }));
}
const toEloMatches = (rows: Match[]): EloMatch[] =>
  rows.map((match) => ({ homeTeam: match.home, awayTeam: match.away, homeGoals: match.homeGoals, awayGoals: match.awayGoals }));

type Scored = { forecasts: Forecast[]; matched: Match[] };

function scoreWindow(
  fitRows: Match[],
  scoreRows: Match[],
  upTo: string
): { dc: Scored; elo: Scored; market: Scored } {
  // Per-competition fits: attack/defence strengths only compare within a
  // league, and pooling them asserts Burnley and Bochum share a goal scale.
  const competitions = [...new Set(scoreRows.map((match) => match.competition))];
  const dcForecasts: Forecast[] = [];
  const dcMatched: Match[] = [];
  const eloForecasts: Forecast[] = [];
  const eloMatched: Match[] = [];
  const marketForecasts: Forecast[] = [];
  const marketMatched: Match[] = [];

  for (const competition of competitions) {
    const trainRows = fitRows.filter((match) => match.competition === competition);
    const evalRows = scoreRows.filter((match) => match.competition === competition);
    if (trainRows.length < 100) continue;
    const dcParams = fitDixonColes(toDcMatches(trainRows, upTo));
    const eloParams = fitElo(toEloMatches(trainRows));

    for (const match of evalRows) {
      const market = marketPrior(match.id);
      // Score every model on the same matches: the paired bootstrap requires
      // it, and a model scored on matches the market skipped is not compared,
      // it is flattered.
      if (!market) continue;
      const dc = predictDixonColes(dcParams, match.home, match.away);
      const elo = predictElo(eloParams, match.home, match.away);
      if (dc.usedFallback || elo.usedFallback) continue;

      dcForecasts.push({ probabilities: dc.probabilities, outcome: match.outcome });
      dcMatched.push(match);
      eloForecasts.push({ probabilities: elo.probabilities, outcome: match.outcome });
      eloMatched.push(match);
      marketForecasts.push({ probabilities: market, outcome: match.outcome });
      marketMatched.push(match);
    }
  }
  return {
    dc: { forecasts: dcForecasts, matched: dcMatched },
    elo: { forecasts: eloForecasts, matched: eloMatched },
    market: { forecasts: marketForecasts, matched: marketMatched }
  };
}

// --- Validation pass: fit calibrators and the blend weight -----------------
const validationScored = scoreWindow(train, validation, TRAIN_TO);
const dcCalibrator = selectCalibrator(validationScored.dc.forecasts);
const blend = fitBlendWeight(
  validationScored.dc.forecasts.map((forecast) => ({
    ...forecast,
    probabilities: dcCalibrator.apply(forecast.probabilities)
  })),
  validationScored.market.forecasts
);
console.log(`calibrator: ${dcCalibrator.describe}; blend weight on model: ${blend.weight.toFixed(2)}`);

// --- Holdout pass: train on train+validation, score 2026 -------------------
const holdoutScored = scoreWindow([...train, ...validation], holdout, VALID_TO);
const dcHoldout = holdoutScored.dc.forecasts;
const dcCalibrated = dcHoldout.map((forecast) => ({ ...forecast, probabilities: dcCalibrator.apply(forecast.probabilities) }));
const ensemble = dcCalibrated.map((forecast, index) => ({
  outcome: forecast.outcome,
  probabilities: blend.blend(forecast.probabilities, holdoutScored.market.forecasts[index]!.probabilities)
}));

const contenders: Array<{ name: string; forecasts: Forecast[] }> = [
  { name: "Closing market (Shin, Pinnacle 2x)", forecasts: holdoutScored.market.forecasts },
  { name: "Elo + Davidson draw", forecasts: holdoutScored.elo.forecasts },
  { name: "Dixon-Coles (raw)", forecasts: dcHoldout },
  { name: `Dixon-Coles + ${dcCalibrator.method}`, forecasts: dcCalibrated },
  { name: `Ensemble (w=${blend.weight.toFixed(2)})`, forecasts: ensemble }
];

const lines: string[] = [];
lines.push("# Model evaluation report — football 1X2");
lines.push("");
lines.push(`*Generated by \`scripts/model-lab-run.ts\`. Corpus: ${matches.length} top-five-league matches,`);
lines.push(`2023-08 → 2026-05, 100% closing-odds coverage. Splits: train ${train.length} (→ ${TRAIN_TO}),`);
lines.push(`validation ${validation.length} (→ ${VALID_TO}), holdout ${holdout.length} (2026). The holdout was scored once.*`);
lines.push("");
lines.push(`Calibration selected on validation: **${dcCalibrator.describe}**. Blend weight on the model: **${blend.weight.toFixed(2)}** (0 = market alone; the grid includes it deliberately).`);
lines.push("");
lines.push("## Holdout results");
lines.push("");
lines.push("| Contender | n | Brier | Log loss | ECE | RPS | Sharpness |");
lines.push("|---|---|---|---|---|---|---|");
for (const contender of contenders) {
  const s = summarise(contender.forecasts);
  lines.push(
    `| ${contender.name} | ${s.n} | ${s.brier?.toFixed(4)} | ${s.logLoss?.toFixed(4)} | ${s.ece?.toFixed(4)} | ${s.rps?.toFixed(4)} | ${s.sharpness?.toFixed(3)} |`
  );
}
lines.push("");
lines.push("## Paired differences vs the closing market (negative = better than market)");
lines.push("");
lines.push("| Contender | ΔBrier [95% CI] | ΔLog loss [95% CI] |");
lines.push("|---|---|---|");
for (const contender of contenders.slice(1)) {
  const db = pairedBootstrapDiff(contender.forecasts, holdoutScored.market.forecasts, brier);
  const dl = pairedBootstrapDiff(contender.forecasts, holdoutScored.market.forecasts, logLoss);
  lines.push(
    `| ${contender.name} | ${db?.diff.toFixed(4)} [${db?.low95.toFixed(4)}, ${db?.high95.toFixed(4)}] | ${dl?.diff.toFixed(4)} [${dl?.low95.toFixed(4)}, ${dl?.high95.toFixed(4)}] |`
  );
}
lines.push("");
lines.push("## Reading it");
lines.push("");
lines.push("- The market baseline is the opponent, not a reference: a CI on ΔBrier that");
lines.push("  crosses zero means the contender has not shown it beats the close.");
lines.push("- Per-competition fits; matches with an unseen team or no closing quote are");
lines.push("  excluded from every contender equally, so all rows compare the same matches.");
lines.push("- Complexity is not a success criterion. If the ensemble's weight sits at 0,");
lines.push("  the honest conclusion is that this corpus's model adds nothing to the close");
lines.push("  yet — and the number saying so is the deliverable.");
lines.push("");
lines.push("## Limitations");
lines.push("");
lines.push("- Top-five leagues only; transfer to smaller leagues is unmeasured.");
lines.push("- No lineup, rest, congestion or travel features yet — the Dixon-Coles here is");
lines.push("  strengths + home advantage + time decay, nothing more.");
lines.push("- Closing quotes carry no intra-day timestamp in this corpus, so lead-time");
lines.push("  analysis and CLV-by-hours are out of scope for this run.");

writeFileSync("docs/model-evaluation-report.md", lines.join("\n") + "\n");
console.log("wrote docs/model-evaluation-report.md");
for (const contender of contenders) {
  const s = summarise(contender.forecasts);
  console.log(`${contender.name}: n=${s.n} brier=${s.brier?.toFixed(4)} ll=${s.logLoss?.toFixed(4)} ece=${s.ece?.toFixed(4)}`);
}
