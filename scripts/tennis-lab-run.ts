#!/usr/bin/env node
/**
 * The model lab's tennis evaluation run.
 *
 *   npx vite-node --config scripts/vite-node.config.ts scripts/tennis-lab-run.ts
 *
 * Same discipline as the football run: chronological splits, everything
 * selectable selected on validation, the holdout scored exactly once, and the
 * de-vigged bookmaker consensus as the opponent.
 *
 * One tennis-specific hazard dominates this file: **the corpus is
 * winner-canonicalised.** Every match row has winner_side=player_1, and the
 * odds file's source columns are W/L — winner odds, loser odds. Trained or
 * scored as-is, "player_1 wins" is a 100% oracle. `orientationFlip` (a
 * deterministic hash of the match id) re-randomises the presentation of both
 * files identically, so after loading, "pick side A" is a coin flip and only
 * skill moves a metric. The sanity check below asserts this instead of
 * trusting it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { brier, logLoss, pairedBootstrapDiff, summarise, type Forecast } from "@/lib/model/evalMetrics";
import { fitTennisElo, orientationFlip, predictTennisElo, type TennisMatch } from "@/lib/model/tennisElo";
import { fitBlendWeight, selectCalibrator } from "@/lib/model/calibrationFit";
import { shinNoVigProbabilities } from "@/lib/sports/prediction/odds";

const DATA = "training-data/standard-v1/datasets";

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

// --- Load matches, flipping orientation per match --------------------------
const matches: TennisMatch[] = parseCsv(`${DATA}/tennis_matches_with_scores_2024_to_2026.csv`)
  .filter(
    (row) =>
      row.source_status === "completed" &&
      row.gradeable_match_winner === "true" &&
      row.winner_side === "player_1" &&
      // One row carries a 2029 date — a source typo, not a fixture from the future.
      row.match_date! <= "2026-12-31"
  )
  .map((row) => {
    const flip = orientationFlip(row.match_id!);
    const rank1 = row.player_1_rank ? Number(row.player_1_rank) : null;
    const rank2 = row.player_2_rank ? Number(row.player_2_rank) : null;
    return {
      matchId: row.match_id!,
      date: row.match_date!,
      surface: row.surface!,
      playerA: flip ? row.player_2_name! : row.player_1_name!,
      playerB: flip ? row.player_1_name! : row.player_2_name!,
      // winner_side is always player_1 in this corpus (asserted by the filter),
      // so after the flip the winner is side B exactly when flipped.
      outcome: (flip ? 1 : 0) as 0 | 1,
      rankA: flip ? rank2 : rank1,
      rankB: flip ? rank1 : rank2
    };
  })
  .sort((a, b) => a.date.localeCompare(b.date));

// Sanity check the de-canonicalisation: if side A wins far from half the
// time, the flip is broken and every number below would be fiction.
const sideAWinRate = matches.filter((match) => match.outcome === 0).length / matches.length;
if (Math.abs(sideAWinRate - 0.5) > 0.02) {
  throw new Error(`orientation flip failed: side A wins ${(sideAWinRate * 100).toFixed(1)}% of ${matches.length}`);
}
console.log(`matches ${matches.length}, side-A win rate ${(sideAWinRate * 100).toFixed(1)}%`);

// --- Load odds, oriented with the same flip --------------------------------
// bookmaker → [odds for side A, odds for side B]
const oddsByMatch = new Map<string, Map<string, [number, number]>>();
for (const row of parseCsv(`${DATA}/tennis_match_odds_2024_to_2026.csv`)) {
  if (row.market !== "match_winner") continue;
  // Derived columns, not books; averaging an average back in double-counts it.
  if (row.bookmaker === "Market Average" || row.bookmaker === "Market Maximum") continue;
  const flip = orientationFlip(row.match_id!);
  const sideA = flip ? "player_2" : "player_1";
  const index = row.selection === sideA ? 0 : 1;
  const byBook = oddsByMatch.get(row.match_id!) ?? new Map<string, [number, number]>();
  const quote = byBook.get(row.bookmaker!) ?? ([0, 0] as [number, number]);
  quote[index] = Number(row.decimal_odds);
  byBook.set(row.bookmaker!, quote);
  oddsByMatch.set(row.match_id!, byBook);
}

/**
 * The market prior: per-book Shin de-vig, Pinnacle counted twice. This corpus
 * flags every quote `source_end_state` rather than proven closing — the
 * strongest reading the source supports, and a limitation the report states.
 */
function marketPrior(matchId: string): [number, number] | null {
  const byBook = oddsByMatch.get(matchId);
  if (!byBook) return null;
  const weighted: Array<{ probabilities: number[]; weight: number }> = [];
  for (const [book, odds] of byBook) {
    if (odds.some((value) => !Number.isFinite(value) || value <= 1)) continue;
    const implied = odds.map((value) => 1 / value);
    weighted.push({ probabilities: shinNoVigProbabilities(implied), weight: book === "Pinnacle" ? 2 : 1 });
  }
  if (!weighted.length) return null;
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const combined: [number, number] = [0, 0];
  for (const entry of weighted) {
    for (let k = 0; k < 2; k += 1) combined[k] += (entry.weight / total) * entry.probabilities[k]!;
  }
  return combined;
}

const TRAIN_TO = "2025-06-30";
const VALID_TO = "2025-12-31";

const train = matches.filter((match) => match.date <= TRAIN_TO);
const validation = matches.filter((match) => match.date > TRAIN_TO && match.date <= VALID_TO);
const holdout = matches.filter((match) => match.date > VALID_TO);
console.log(`train ${train.length}, validation ${validation.length}, holdout ${holdout.length}`);

type Scored = { elo: Forecast[]; market: Forecast[] };

function scoreWindow(fitRows: TennisMatch[], scoreRows: TennisMatch[], surfaceBlend: number): Scored {
  const params = fitTennisElo(fitRows, { surfaceBlend });
  const elo: Forecast[] = [];
  const market: Forecast[] = [];
  for (const match of scoreRows) {
    const prior = marketPrior(match.matchId);
    // Score every contender on the same matches — a model scored on matches
    // the market skipped is not compared, it is flattered.
    if (!prior) continue;
    const prediction = predictTennisElo(params, match.playerA, match.playerB, match.surface, {
      rankA: match.rankA,
      rankB: match.rankB
    });
    if (prediction.usedFallback) continue;
    elo.push({ probabilities: prediction.probabilities, outcome: match.outcome });
    market.push({ probabilities: prior, outcome: match.outcome });
  }
  return { elo, market };
}

// --- Validation pass: surface blend, calibrator, ensemble weight -----------
const BLEND_GRID = [0, 0.25, 0.5, 0.75, 1];
let surfaceBlend = 0;
let bestBlendLoss = Infinity;
for (const candidate of BLEND_GRID) {
  const scored = scoreWindow(train, validation, candidate);
  const loss = logLoss(scored.elo) ?? Infinity;
  console.log(`surface blend ${candidate}: validation log loss ${loss.toFixed(4)} on ${scored.elo.length}`);
  if (loss < bestBlendLoss) {
    bestBlendLoss = loss;
    surfaceBlend = candidate;
  }
}

const validationScored = scoreWindow(train, validation, surfaceBlend);
const calibrator = selectCalibrator(validationScored.elo);
const blend = fitBlendWeight(
  validationScored.elo.map((forecast) => ({ ...forecast, probabilities: calibrator.apply(forecast.probabilities) })),
  validationScored.market
);
console.log(
  `surface blend ${surfaceBlend}; calibrator: ${calibrator.describe}; blend weight on model: ${blend.weight.toFixed(2)}`
);

// --- Holdout pass: train on train+validation, score 2026 once --------------
const holdoutScored = scoreWindow([...train, ...validation], holdout, surfaceBlend);
const eloCalibrated = holdoutScored.elo.map((forecast) => ({
  ...forecast,
  probabilities: calibrator.apply(forecast.probabilities)
}));
const ensemble = eloCalibrated.map((forecast, index) => ({
  outcome: forecast.outcome,
  probabilities: blend.blend(forecast.probabilities, holdoutScored.market[index]!.probabilities)
}));

const contenders: Array<{ name: string; forecasts: Forecast[] }> = [
  { name: "Bookmaker consensus (Shin, Pinnacle 2x)", forecasts: holdoutScored.market },
  { name: `Surface Elo (blend ${surfaceBlend})`, forecasts: holdoutScored.elo },
  { name: `Surface Elo + ${calibrator.method}`, forecasts: eloCalibrated },
  { name: `Ensemble (w=${blend.weight.toFixed(2)})`, forecasts: ensemble }
];

const lines: string[] = [];
lines.push("# Model evaluation report — tennis match winner");
lines.push("");
lines.push(`*Generated by \`scripts/tennis-lab-run.ts\`. Corpus: ${matches.length} ATP/WTA matches, 2024-01 → 2026-07.`);
lines.push(`Splits: train ${train.length} (→ ${TRAIN_TO}), validation ${validation.length} (→ ${VALID_TO}), holdout ${holdout.length} (2026).`);
lines.push(`The holdout was scored once. Side-A orientation is a deterministic coin (side-A win rate ${(sideAWinRate * 100).toFixed(1)}%),`);
lines.push(`because the source files are winner-canonicalised and would otherwise leak the result.*`);
lines.push("");
lines.push(`Selected on validation: surface blend **${surfaceBlend}**, calibration **${calibrator.describe}**,`);
lines.push(`ensemble weight on the model **${blend.weight.toFixed(2)}** (0 = market alone; the grid includes it deliberately).`);
lines.push("");
lines.push("## Holdout results");
lines.push("");
lines.push("| Contender | n | Brier | Log loss | ECE | Sharpness |");
lines.push("|---|---|---|---|---|---|");
for (const contender of contenders) {
  const s = summarise(contender.forecasts);
  lines.push(
    `| ${contender.name} | ${s.n} | ${s.brier?.toFixed(4)} | ${s.logLoss?.toFixed(4)} | ${s.ece?.toFixed(4)} | ${s.sharpness?.toFixed(3)} |`
  );
}
lines.push("");
lines.push("## Paired differences vs the consensus (negative = better than market)");
lines.push("");
lines.push("| Contender | ΔBrier [95% CI] | ΔLog loss [95% CI] |");
lines.push("|---|---|---|");
for (const contender of contenders.slice(1)) {
  const db = pairedBootstrapDiff(contender.forecasts, holdoutScored.market, brier);
  const dl = pairedBootstrapDiff(contender.forecasts, holdoutScored.market, logLoss);
  lines.push(
    `| ${contender.name} | ${db?.diff.toFixed(4)} [${db?.low95.toFixed(4)}, ${db?.high95.toFixed(4)}] | ${dl?.diff.toFixed(4)} [${dl?.low95.toFixed(4)}, ${dl?.high95.toFixed(4)}] |`
  );
}
lines.push("");
lines.push("## Reading it");
lines.push("");
lines.push("- The consensus is the opponent, not a reference: a ΔBrier CI crossing zero");
lines.push("  means the contender has not shown it beats the book.");
lines.push("- Matches without a usable quote, or where either player had neither history");
lines.push("  nor a ranking, are excluded from every contender equally.");
lines.push("- Complexity is not a success criterion; an ensemble weight of 0 is a valid,");
lines.push("  reportable answer.");
lines.push("");
lines.push("## Limitations");
lines.push("");
lines.push("- The odds are the source's end-state columns, not proven closing snapshots");
lines.push("  (`is_closing=false`, `source_end_state` throughout). This is the strongest");
lines.push("  market baseline this corpus can field, and it should still be read as");
lines.push("  \"bookmaker consensus\", not \"the close\".");
lines.push("- Ratings are frozen at each window boundary rather than updated match by");
lines.push("  match through the scoring window — the same convention as the football run,");
lines.push("  which understates sequential Elo slightly.");
lines.push("- No retirement/walkover modelling, no head-to-head, no fatigue features.");
lines.push("- Best-of-five vs best-of-three is not modelled separately.");

// Preserve any hand-written findings section across reruns: the numbers are
// regenerated, the interpretation is not.
try {
  const existing = readFileSync("docs/model-evaluation-report-tennis.md", "utf8");
  const findings = existing.match(/## Findings[\s\S]*?(?=\n## |$)/);
  if (findings) {
    const limitationsAt = lines.indexOf("## Limitations");
    lines.splice(limitationsAt, 0, findings[0].trimEnd(), "");
  }
} catch {
  // First run — nothing to preserve.
}

writeFileSync("docs/model-evaluation-report-tennis.md", lines.join("\n") + "\n");
console.log("wrote docs/model-evaluation-report-tennis.md");
for (const contender of contenders) {
  const s = summarise(contender.forecasts);
  console.log(`${contender.name}: n=${s.n} brier=${s.brier?.toFixed(4)} ll=${s.logLoss?.toFixed(4)} ece=${s.ece?.toFixed(4)}`);
}
