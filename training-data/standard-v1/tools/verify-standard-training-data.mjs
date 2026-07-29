import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(toolDir, "..");
const datasetDir = path.join(packageDir, "datasets");
const report = JSON.parse(
  await fs.readFile(path.join(packageDir, "validation_report.json"), "utf8"),
);

const filenames = {
  footballMatches: "football_matches_2023_24_to_2025_26.csv",
  footballOdds: "football_odds_opening_closing_2023_24_to_2025_26.csv",
  tennisMatches: "tennis_matches_with_scores_2024_to_2026.csv",
  tennisOdds: "tennis_match_odds_2024_to_2026.csv",
  sourceManifest: "source_manifest.csv",
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const [headers, ...data] = rows;
  return data
    .filter((values) => values.some((value) => value !== ""))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
}

async function load(name) {
  const buffer = await fs.readFile(path.join(datasetDir, filenames[name]));
  return {
    buffer,
    rows: parseCsv(buffer.toString("utf8")),
    hash: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

const [fm, fo, tm, to, sm] = await Promise.all(
  Object.keys(filenames).map((name) => load(name)),
);

const assertions = [];
function check(id, condition, observed, expected) {
  assertions.push({ id, status: condition ? "pass" : "fail", observed, expected });
}

const footballIds = new Set(fm.rows.map((row) => row.match_id));
const tennisIds = new Set(tm.rows.map((row) => row.match_id));
check("football_row_count", fm.rows.length === 5256, fm.rows.length, 5256);
check("football_unique_match_id", footballIds.size === fm.rows.length, footballIds.size, fm.rows.length);
check("football_odds_row_count", fo.rows.length === 121032, fo.rows.length, 121032);
check("tennis_row_count", tm.rows.length === 13642, tm.rows.length, 13642);
check("tennis_unique_match_id", tennisIds.size === tm.rows.length, tennisIds.size, tm.rows.length);
check("tennis_odds_row_count", to.rows.length === 102069, to.rows.length, 102069);
check("manifest_row_count", sm.rows.length === 21, sm.rows.length, 21);

let footballResultErrors = 0;
for (const row of fm.rows) {
  const home = Number(row.home_score);
  const away = Number(row.away_score);
  const expected = home > away ? "H" : home < away ? "A" : "D";
  if (row.result_1x2 !== expected || row.status !== "finished") footballResultErrors += 1;
}
check("football_score_result_consistency", footballResultErrors === 0, footballResultErrors, 0);

let tennisScoreErrors = 0;
for (const row of tm.rows) {
  const p1 = Number(row.player_1_sets);
  const p2 = Number(row.player_2_sets);
  const completed = row.source_status === "completed";
  let setScores = [];
  try {
    setScores = JSON.parse(row.set_scores_json || "[]");
  } catch {
    setScores = [];
  }
  const derivedP1 = setScores.filter(
    (set) => Number(set.player_1_games) > Number(set.player_2_games),
  ).length;
  const derivedP2 = setScores.filter(
    (set) => Number(set.player_2_games) > Number(set.player_1_games),
  ).length;
  const completedAndConsistent = completed && setScores.length > 0 && derivedP1 > derivedP2;
  const completedIsValid =
    completedAndConsistent &&
    Boolean(row.score_text) &&
    p1 === derivedP1 &&
    p2 === derivedP2 &&
    row.winner_side === "player_1" &&
    row.gradeable_match_winner === "true" &&
    row.gradeable_set_markets === "true";
  const excludedIsValid =
    !completedAndConsistent &&
    row.winner_side === "player_1" &&
    row.gradeable_match_winner === "false" &&
    row.gradeable_set_markets === "false";
  if (!completedIsValid && !excludedIsValid) {
    tennisScoreErrors += 1;
  }
}
check("tennis_score_consistency", tennisScoreErrors === 0, tennisScoreErrors, 0);

let footballOrphans = 0;
let footballInvalidOdds = 0;
const footballOddsKeys = new Set();
let footballOddsDuplicates = 0;
const byMatchBook = new Map();
const marketAverageClosing = new Set();
for (const row of fo.rows) {
  if (!footballIds.has(row.match_id)) footballOrphans += 1;
  if (!(Number(row.decimal_odds) > 1)) footballInvalidOdds += 1;
  const key = [row.match_id, row.bookmaker, row.market, row.selection, row.snapshot_type].join("|");
  if (footballOddsKeys.has(key)) footballOddsDuplicates += 1;
  footballOddsKeys.add(key);
  const matchBook = `${row.match_id}|${row.bookmaker}`;
  const state = byMatchBook.get(matchBook) ?? {
    matchId: row.match_id,
    opening: new Set(),
    closing: new Set(),
  };
  state[row.snapshot_type]?.add(row.selection);
  byMatchBook.set(matchBook, state);
  if (row.bookmaker === "Market Average" && row.snapshot_type === "closing") {
    marketAverageClosing.add(`${row.match_id}|${row.selection}`);
  }
}
check("football_odds_orphans", footballOrphans === 0, footballOrphans, 0);
check("football_odds_invalid_decimal", footballInvalidOdds === 0, footballInvalidOdds, 0);
check("football_odds_duplicate_key", footballOddsDuplicates === 0, footballOddsDuplicates, 0);

const pairedMatches = new Set();
for (const state of byMatchBook.values()) {
  if (
    ["home", "draw", "away"].every(
      (selection) => state.opening.has(selection) && state.closing.has(selection),
    )
  ) {
    pairedMatches.add(state.matchId);
  }
}
const pairedCoverage = pairedMatches.size / fm.rows.length;
const marketAverageMatches = [...footballIds].filter((matchId) =>
  ["home", "draw", "away"].every((selection) =>
    marketAverageClosing.has(`${matchId}|${selection}`),
  ),
);
const marketAverageCoverage = marketAverageMatches.length / fm.rows.length;
check("football_opening_closing_pair_coverage", pairedCoverage >= 0.8, pairedCoverage, ">=0.8");
check("football_market_average_closing_coverage", marketAverageCoverage >= 0.8, marketAverageCoverage, ">=0.8");

let tennisOrphans = 0;
let tennisInvalidOdds = 0;
const tennisOddsKeys = new Set();
let tennisOddsDuplicates = 0;
for (const row of to.rows) {
  if (!tennisIds.has(row.match_id)) tennisOrphans += 1;
  if (!(Number(row.decimal_odds) > 1)) tennisInvalidOdds += 1;
  const key = [row.match_id, row.bookmaker, row.market, row.selection, row.snapshot_type].join("|");
  if (tennisOddsKeys.has(key)) tennisOddsDuplicates += 1;
  tennisOddsKeys.add(key);
}
check("tennis_odds_orphans", tennisOrphans === 0, tennisOrphans, 0);
check("tennis_odds_invalid_decimal", tennisInvalidOdds === 0, tennisInvalidOdds, 0);
check("tennis_odds_duplicate_key", tennisOddsDuplicates === 0, tennisOddsDuplicates, 0);

for (const [name, data] of Object.entries({
  footballMatches: fm,
  footballOdds: fo,
  tennisMatches: tm,
  tennisOdds: to,
  sourceManifest: sm,
})) {
  check(`sha256_${name}`, data.hash === report.sha256[name], data.hash, report.sha256[name]);
}

const receipt = {
  verified_at: new Date().toISOString(),
  package_version: "standard-v1",
  result: assertions.every((assertion) => assertion.status === "pass") ? "pass" : "fail",
  assertions,
};
await fs.writeFile(
  path.join(packageDir, "verification_receipt.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
);
console.log(JSON.stringify(receipt, null, 2));
if (receipt.result !== "pass") process.exitCode = 1;
