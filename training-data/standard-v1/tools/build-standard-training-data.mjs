import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { FileBlob, SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(toolDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const datasetDir = path.join(packageDir, "datasets");
const schemaDir = path.join(packageDir, "schemas");
const workDir = path.join(packageDir, ".build-work");
const previewDir = path.join(workDir, "previews");
const outputDir = packageDir;
const checkedAt = "2026-07-29T08:44:31Z";

const footballLeagues = [
  { code: "E0", name: "Premier League", country: "England" },
  { code: "D1", name: "Bundesliga", country: "Germany" },
  { code: "I1", name: "Serie A", country: "Italy" },
  { code: "SP1", name: "La Liga", country: "Spain" },
  { code: "F1", name: "Ligue 1", country: "France" },
];
const footballSeasons = [
  { code: "2324", start: 2023, label: "2023-24" },
  { code: "2425", start: 2024, label: "2024-25" },
  { code: "2526", start: 2025, label: "2025-26" },
];
const tennisSources = [2024, 2025, 2026].flatMap((year) => [
  { year, tour: "ATP", url: `http://www.tennis-data.co.uk/${year}/${year}.xlsx` },
  { year, tour: "WTA", url: `http://www.tennis-data.co.uk/${year}w/${year}.xlsx` },
]);

await Promise.all(
  [packageDir, datasetDir, schemaDir, workDir, previewDir, outputDir].map((dir) =>
    fs.mkdir(dir, { recursive: true }),
  ),
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clean(value) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || clean(value) === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function integerOrNull(value) {
  const parsed = numberOrNull(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function slug(value) {
  return clean(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function writeCsv(filePath, rows, columns) {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((column) => csvEscape(row[column])).join(","));
  await fs.writeFile(filePath, `${lines.join("\n")}\n`, "utf8");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((item) => clean(item))) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    if (row.some((item) => clean(item))) rows.push(row);
  }
  return rows;
}

function rowsToObjects(rows) {
  const headers = (rows[0] ?? []).map(clean);
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

function footballDate(value) {
  const text = clean(value);
  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
}

function excelDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Math.round((value - 25569) * 86_400_000)).toISOString().slice(0, 10);
  }
  const text = clean(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const match = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})$/);
  if (!match) return null;
  const year = Number(match[3]) < 100 ? 2000 + Number(match[3]) : Number(match[3]);
  return `${year}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
}

async function fetchBytes(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: "follow",
        headers: { "user-agent": "OddsPadi training-data research package/1.0" },
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

const footballMatches = [];
const footballOdds = [];
const sourceManifest = [];

const footballSourceResults = await Promise.all(
  footballSeasons.flatMap((season) =>
    footballLeagues.map(async (league) => {
      const url = `https://www.football-data.co.uk/mmz4281/${season.code}/${league.code}.csv`;
      const bytes = await fetchBytes(url);
      return { season, league, url, bytes };
    }),
  ),
);

const oddsDefinitions = [
  { snapshotType: "opening", isClosing: false, bookmaker: "Bet365", columns: ["B365H", "B365D", "B365A"] },
  { snapshotType: "opening", isClosing: false, bookmaker: "Pinnacle", columns: ["PSH", "PSD", "PSA"] },
  { snapshotType: "opening", isClosing: false, bookmaker: "Market Average", columns: ["AvgH", "AvgD", "AvgA"] },
  { snapshotType: "opening", isClosing: false, bookmaker: "Market Maximum", columns: ["MaxH", "MaxD", "MaxA"] },
  { snapshotType: "closing", isClosing: true, bookmaker: "Bet365", columns: ["B365CH", "B365CD", "B365CA"] },
  { snapshotType: "closing", isClosing: true, bookmaker: "Pinnacle", columns: ["PSCH", "PSCD", "PSCA"] },
  { snapshotType: "closing", isClosing: true, bookmaker: "Market Average", columns: ["AvgCH", "AvgCD", "AvgCA"] },
  { snapshotType: "closing", isClosing: true, bookmaker: "Market Maximum", columns: ["MaxCH", "MaxCD", "MaxCA"] },
];
const selections = ["home", "draw", "away"];

for (const source of footballSourceResults) {
  const text = source.bytes.toString("utf8").replace(/^\uFEFF/, "");
  const objects = rowsToObjects(parseCsv(text));
  let accepted = 0;
  let oddsRows = 0;
  for (let rowIndex = 0; rowIndex < objects.length; rowIndex += 1) {
    const row = objects[rowIndex];
    const matchDate = footballDate(row.Date);
    const home = clean(row.HomeTeam);
    const away = clean(row.AwayTeam);
    const homeScore = integerOrNull(row.FTHG);
    const awayScore = integerOrNull(row.FTAG);
    if (!matchDate || !home || !away || homeScore === null || awayScore === null) continue;
    const matchId = `football-data:${source.league.code}:${source.season.code}:${matchDate}:${slug(home)}:${slug(away)}`;
    footballMatches.push({
      match_id: matchId,
      sport: "football",
      season: source.season.label,
      competition_code: source.league.code,
      competition_name: source.league.name,
      country: source.league.country,
      match_date: matchDate,
      kickoff_time_local: clean(row.Time) || null,
      home_team: home,
      away_team: away,
      home_score: homeScore,
      away_score: awayScore,
      result_1x2: clean(row.FTR) || (homeScore > awayScore ? "H" : homeScore < awayScore ? "A" : "D"),
      status: "finished",
      source_provider: "football-data.co.uk",
      source_url: source.url,
      source_row_number: rowIndex + 2,
      source_checked_at: checkedAt,
      license_status: "free_to_use_site_statement; commercial_terms_review_recommended",
    });
    accepted += 1;

    for (const definition of oddsDefinitions) {
      definition.columns.forEach((column, selectionIndex) => {
        const decimalOdds = numberOrNull(row[column]);
        if (decimalOdds === null || decimalOdds <= 1) return;
        const warnings = ["source_does_not_supply_exact_observation_timestamp"];
        if (definition.bookmaker === "Pinnacle" && matchDate >= "2025-07-23") {
          warnings.push("football-data_warns_pinnacle_may_be_stale_after_2025-07-23");
        }
        footballOdds.push({
          match_id: matchId,
          sport: "football",
          season: source.season.label,
          competition_code: source.league.code,
          match_date: matchDate,
          bookmaker: definition.bookmaker,
          market: "h2h_3way",
          selection: selections[selectionIndex],
          decimal_odds: decimalOdds,
          snapshot_type: definition.snapshotType,
          is_closing: definition.isClosing,
          observed_at: null,
          source_column: column,
          source_provider: "football-data.co.uk",
          source_url: source.url,
          quality_flags: warnings.join("|"),
        });
        oddsRows += 1;
      });
    }
  }
  sourceManifest.push({
    dataset_family: "football_results_and_odds",
    sport: "football",
    scope: `${source.league.name} ${source.season.label}`,
    source_provider: "football-data.co.uk",
    source_url: source.url,
    retrieved_at: checkedAt,
    source_sha256: sha256(source.bytes),
    source_rows: objects.length,
    normalized_match_rows: accepted,
    normalized_odds_rows: oddsRows,
    license_or_terms: "Site states data are free; keep attribution and complete commercial terms review.",
    production_use: "conditional",
  });
}

const tennisMatches = [];
const tennisOdds = [];
for (const source of tennisSources) {
  const bytes = await fetchBytes(source.url);
  const tempPath = path.join(workDir, `tennis-${source.tour.toLowerCase()}-${source.year}.xlsx`);
  await fs.writeFile(tempPath, bytes);
  const input = await FileBlob.load(tempPath);
  const sourceWorkbook = await SpreadsheetFile.importXlsx(input);
  const sheet = sourceWorkbook.worksheets.getItemAt(0);
  const used = sheet.getUsedRange(true);
  const values = used?.values ?? [];
  const headers = (values[0] ?? []).map(clean);
  const objects = values.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
  let accepted = 0;
  let oddsRows = 0;
  for (let rowIndex = 0; rowIndex < objects.length; rowIndex += 1) {
    const row = objects[rowIndex];
    const matchDate = excelDate(row.Date);
    const winner = clean(row.Winner);
    const loser = clean(row.Loser);
    const winnerSets = integerOrNull(row.Wsets);
    const loserSets = integerOrNull(row.Lsets);
    const sourceStatus = clean(row.Comment).toLowerCase() || "unknown";
    if (!matchDate || !winner || !loser || winnerSets === null || loserSets === null) continue;
    const setScores = [];
    for (let setNumber = 1; setNumber <= 5; setNumber += 1) {
      const winnerGames = integerOrNull(row[`W${setNumber}`]);
      const loserGames = integerOrNull(row[`L${setNumber}`]);
      if (winnerGames === null || loserGames === null) continue;
      setScores.push({ set: setNumber, player_1_games: winnerGames, player_2_games: loserGames });
    }
    const completedPlayer1Sets = setScores.filter(
      (set) => set.player_1_games > set.player_2_games,
    ).length;
    const completedPlayer2Sets = setScores.filter(
      (set) => set.player_2_games > set.player_1_games,
    ).length;
    const isCompletedAndConsistent =
      sourceStatus === "completed" &&
      setScores.length > 0 &&
      completedPlayer1Sets > completedPlayer2Sets;
    const normalizedPlayer1Sets = isCompletedAndConsistent
      ? completedPlayer1Sets
      : winnerSets;
    const normalizedPlayer2Sets = isCompletedAndConsistent
      ? completedPlayer2Sets
      : loserSets;
    const matchId = `tennis-data:${source.tour.toLowerCase()}:${source.year}:${matchDate}:${slug(winner)}:${slug(loser)}:${slug(row.Tournament)}:${slug(row.Round)}`;
    tennisMatches.push({
      match_id: matchId,
      match_key_loose: `${matchDate}:${[slug(winner), slug(loser)].sort().join(":")}`,
      sport: "tennis",
      tour: source.tour,
      season: source.year,
      match_date: matchDate,
      tournament: clean(row.Tournament),
      location: clean(row.Location),
      series: clean(row.Series),
      court: clean(row.Court),
      surface: clean(row.Surface),
      round: clean(row.Round),
      player_1_name: winner,
      player_2_name: loser,
      winner_side: "player_1",
      player_1_sets: normalizedPlayer1Sets,
      player_2_sets: normalizedPlayer2Sets,
      set_scores_json: JSON.stringify(setScores),
      score_text: setScores.map((set) => `${set.player_1_games}-${set.player_2_games}`).join(" "),
      source_status: sourceStatus,
      gradeable_match_winner: isCompletedAndConsistent,
      gradeable_set_markets: isCompletedAndConsistent,
      player_1_rank: integerOrNull(row.WRank),
      player_2_rank: integerOrNull(row.LRank),
      source_provider: "tennis-data.co.uk",
      source_url: source.url,
      source_row_number: rowIndex + 2,
      source_checked_at: checkedAt,
      license_status: "site_states_all_data_free_to_use; preserve_attribution",
    });
    accepted += 1;

    const tennisOddsDefinitions = [
      { bookmaker: "Bet365", columns: ["B365W", "B365L"] },
      { bookmaker: "Pinnacle", columns: ["PSW", "PSL"] },
      { bookmaker: "Market Average", columns: ["AvgW", "AvgL"] },
      { bookmaker: "Market Maximum", columns: ["MaxW", "MaxL"] },
    ];
    for (const definition of tennisOddsDefinitions) {
      definition.columns.forEach((column, selectionIndex) => {
        const decimalOdds = numberOrNull(row[column]);
        if (decimalOdds === null || decimalOdds <= 1) return;
        tennisOdds.push({
          match_id: matchId,
          sport: "tennis",
          tour: source.tour,
          season: source.year,
          match_date: matchDate,
          bookmaker: definition.bookmaker,
          market: "match_winner",
          selection: selectionIndex === 0 ? "player_1" : "player_2",
          decimal_odds: decimalOdds,
          snapshot_type: "source_end_state",
          is_closing: false,
          observed_at: null,
          source_column: column,
          source_provider: "tennis-data.co.uk",
          source_url: source.url,
          quality_flags: "closing_status_not_explicitly_proven|source_does_not_supply_exact_observation_timestamp",
        });
        oddsRows += 1;
      });
    }
  }
  sourceManifest.push({
    dataset_family: "tennis_results_scores_and_odds",
    sport: "tennis",
    scope: `${source.tour} ${source.year}`,
    source_provider: "tennis-data.co.uk",
    source_url: source.url,
    retrieved_at: checkedAt,
    source_sha256: sha256(bytes),
    source_rows: objects.length,
    normalized_match_rows: accepted,
    normalized_odds_rows: oddsRows,
    license_or_terms: "Site states all historical results and odds files are free to use; preserve attribution.",
    production_use: "allowed_with_attribution_and_terms_archive",
  });
}

const footballMatchColumns = [
  "match_id", "sport", "season", "competition_code", "competition_name", "country", "match_date",
  "kickoff_time_local", "home_team", "away_team", "home_score", "away_score", "result_1x2", "status",
  "source_provider", "source_url", "source_row_number", "source_checked_at", "license_status",
];
const footballOddsColumns = [
  "match_id", "sport", "season", "competition_code", "match_date", "bookmaker", "market", "selection",
  "decimal_odds", "snapshot_type", "is_closing", "observed_at", "source_column", "source_provider",
  "source_url", "quality_flags",
];
const tennisMatchColumns = [
  "match_id", "match_key_loose", "sport", "tour", "season", "match_date", "tournament", "location",
  "series", "court", "surface", "round", "player_1_name", "player_2_name", "winner_side", "player_1_sets",
  "player_2_sets", "set_scores_json", "score_text", "source_status", "gradeable_match_winner",
  "gradeable_set_markets", "player_1_rank", "player_2_rank", "source_provider", "source_url",
  "source_row_number", "source_checked_at", "license_status",
];
const tennisOddsColumns = [
  "match_id", "sport", "tour", "season", "match_date", "bookmaker", "market", "selection",
  "decimal_odds", "snapshot_type", "is_closing", "observed_at", "source_column", "source_provider",
  "source_url", "quality_flags",
];
const manifestColumns = [
  "dataset_family", "sport", "scope", "source_provider", "source_url", "retrieved_at", "source_sha256",
  "source_rows", "normalized_match_rows", "normalized_odds_rows", "license_or_terms", "production_use",
];

const files = {
  footballMatches: path.join(datasetDir, "football_matches_2023_24_to_2025_26.csv"),
  footballOdds: path.join(datasetDir, "football_odds_opening_closing_2023_24_to_2025_26.csv"),
  tennisMatches: path.join(datasetDir, "tennis_matches_with_scores_2024_to_2026.csv"),
  tennisOdds: path.join(datasetDir, "tennis_match_odds_2024_to_2026.csv"),
  sourceManifest: path.join(datasetDir, "source_manifest.csv"),
};
await writeCsv(files.footballMatches, footballMatches, footballMatchColumns);
await writeCsv(files.footballOdds, footballOdds, footballOddsColumns);
await writeCsv(files.tennisMatches, tennisMatches, tennisMatchColumns);
await writeCsv(files.tennisOdds, tennisOdds, tennisOddsColumns);
await writeCsv(files.sourceManifest, sourceManifest, manifestColumns);

const schemaDefinitions = [
  ["football_matches_v1.schema.json", "Football matches v1", footballMatchColumns],
  ["football_odds_v1.schema.json", "Football odds snapshots v1", footballOddsColumns],
  ["tennis_matches_v1.schema.json", "Tennis matches with scores v1", tennisMatchColumns],
  ["tennis_odds_v1.schema.json", "Tennis odds snapshots v1", tennisOddsColumns],
];
for (const [fileName, title, columns] of schemaDefinitions) {
  const properties = Object.fromEntries(
    columns.map((column) => [
      column,
      {
        type:
          /(_score|_sets|_rank|_row_number|season$)/.test(column)
            ? ["integer", "null"]
            : /decimal_odds/.test(column)
              ? ["number", "null"]
              : /^(is_|gradeable_)/.test(column)
                ? "boolean"
                : ["string", "null"],
      },
    ]),
  );
  await fs.writeFile(
    path.join(schemaDir, fileName),
    JSON.stringify(
      {
        $schema: "https://json-schema.org/draft/2020-12/schema",
        title,
        type: "object",
        additionalProperties: false,
        properties,
        required: columns.filter((column) => !["observed_at", "kickoff_time_local"].includes(column)),
      },
      null,
      2,
    ),
  );
}

function coverageFor(bookmaker, snapshotType) {
  const selectionsByMatch = new Map();
  for (const row of footballOdds) {
    if (row.bookmaker !== bookmaker || row.snapshot_type !== snapshotType) continue;
    const values = selectionsByMatch.get(row.match_id) ?? new Set();
    values.add(row.selection);
    selectionsByMatch.set(row.match_id, values);
  }
  return [...selectionsByMatch.values()].filter((values) => values.size === 3).length;
}

const totalFootballMatches = footballMatches.length;
const averageClosingMatches = coverageFor("Market Average", "closing");
const anyClosingMatches = new Set(footballOdds.filter((row) => row.is_closing).map((row) => row.match_id)).size;
const openingClosingPairedMatches = (() => {
  const states = new Map();
  for (const row of footballOdds) {
    const key = `${row.match_id}|${row.bookmaker}`;
    const value = states.get(key) ?? { opening: new Set(), closing: new Set() };
    value[row.snapshot_type].add(row.selection);
    states.set(key, value);
  }
  return new Set(
    [...states.entries()]
      .filter(([, value]) => value.opening.size === 3 && value.closing.size === 3)
      .map(([key]) => key.split("|")[0]),
  ).size;
})();
const footballClosingCoverage = totalFootballMatches ? averageClosingMatches / totalFootballMatches : 0;
const footballPairCoverage = totalFootballMatches ? openingClosingPairedMatches / totalFootballMatches : 0;
const tennisScoreCoverage = tennisMatches.length
  ? tennisMatches.filter((row) => row.player_1_sets !== null && row.player_2_sets !== null).length / tennisMatches.length
  : 0;
const tennisGradeableMatchWinnerRows = tennisMatches.filter(
  (row) => row.gradeable_match_winner,
).length;

const datasetHashes = {};
for (const [key, filePath] of Object.entries(files)) {
  datasetHashes[key] = sha256(await fs.readFile(filePath));
}

const validation = {
  generated_at: checkedAt,
  package_version: "standard-v1",
  live_baseline: {
    odds_padi_project_ref: "wncwtzqipnoqwmqlznqn",
    tennis_linked_fixtures: 1608,
    tennis_past_or_finished_unscored_fixtures: 1300,
    tennis_pending_unscored_decisions: 196900,
    tennis_current_pending_unscored_decisions: 136432,
    football_latest_calibration_closing_rows: 12,
    football_latest_calibration_settled_rows: 18,
    football_latest_calibration_closing_coverage: 0.666667,
    football_closing_gate: 0.8,
    additional_closing_outcomes_needed_at_current_denominator: 3,
  },
  provider_proof: {
    api_football: { status: "active", plan: "Ultra", daily_limit: 75000, remaining_at_check: 44521, ends_at: "2026-08-09T15:43:27Z" },
    api_basketball: { status: "quota_exhausted", plan: "not_confirmed" },
    api_tennis: { status: "active_endpoint_proved", plan: "not_exposed_by_provider_response", fetched_for_2026_07_28: 449 },
    the_odds_api: { status: "configured_but_quota_exhausted", production_plan: "not_confirmed", preview_label_only: "100k" },
  },
  datasets: {
    football_matches: totalFootballMatches,
    football_odds_rows: footballOdds.length,
    football_any_closing_match_coverage: totalFootballMatches ? anyClosingMatches / totalFootballMatches : 0,
    football_market_average_closing_coverage: footballClosingCoverage,
    football_opening_closing_pair_coverage: footballPairCoverage,
    tennis_matches_with_scores: tennisMatches.length,
    tennis_gradeable_match_winner_rows: tennisGradeableMatchWinnerRows,
    tennis_odds_rows: tennisOdds.length,
    tennis_score_coverage: tennisScoreCoverage,
  },
  gates: [
    {
      id: "football_closing_coverage_080",
      threshold: 0.8,
      observed: footballClosingCoverage,
      status: footballClosingCoverage >= 0.8 ? "pass" : "fail",
    },
    {
      id: "football_opening_closing_pair_coverage_080",
      threshold: 0.8,
      observed: footballPairCoverage,
      status: footballPairCoverage >= 0.8 ? "pass" : "fail",
    },
    {
      id: "tennis_score_coverage_099",
      threshold: 0.99,
      observed: tennisScoreCoverage,
      status: tennisScoreCoverage >= 0.99 ? "pass" : "fail",
    },
  ],
  warnings: [
    "The public tennis dataset is a standard research/training corpus, not a direct identity-perfect patch for the 1,300 live OddsPadi fixtures.",
    "API-Tennis production backfill should be the primary recovery path because the live fixtures already use provider api-tennis identifiers.",
    "Retired, walkover, and awarded tennis matches remain in the corpus with source status, but their gradeable flags are false.",
    "Football-Data closing columns are explicit, but exact observation timestamps are absent.",
    "Football-Data warns that Pinnacle prices may be stale after 2025-07-23; prefer Market Average closing prices for the primary gate.",
    "No production database rows were written by this package build.",
  ],
  sha256: datasetHashes,
};
await fs.writeFile(path.join(packageDir, "validation_report.json"), JSON.stringify(validation, null, 2));

const workbook = Workbook.create();
const summary = workbook.worksheets.add("Summary");
const catalog = workbook.worksheets.add("Dataset Catalog");
const gates = workbook.worksheets.add("Validation Gates");
const providers = workbook.worksheets.add("Provider Proof");
const sources = workbook.worksheets.add("Sources");
const tennisSample = workbook.worksheets.add("Tennis Sample");
const footballSample = workbook.worksheets.add("Football Sample");
const oddsSample = workbook.worksheets.add("Football Odds Sample");

const navy = "#11233F";
const blue = "#1D4ED8";
const paleBlue = "#E8F0FE";
const green = "#DFF4E8";
const amber = "#FFF2CC";
const red = "#FCE1E1";
const gray = "#E5E7EB";

function title(sheet, range, text) {
  sheet.getRange(range).merge();
  sheet.getRange(range).values = [[text]];
  sheet.getRange(range).format = {
    fill: navy,
    font: { bold: true, color: "#FFFFFF", size: 16 },
    rowHeight: 28,
    verticalAlignment: "center",
  };
}

function header(sheet, range) {
  sheet.getRange(range).format = {
    fill: blue,
    font: { bold: true, color: "#FFFFFF" },
    wrapText: true,
    verticalAlignment: "center",
    borders: { preset: "bottom", style: "medium", color: "#163B7A" },
  };
}

function finishSheet(sheet, width = 18) {
  sheet.showGridLines = false;
  const used = sheet.getUsedRange();
  used.format.autofitColumns();
  used.format.autofitRows();
  used.format.columnWidth = width;
}

title(summary, "A1:H1", "OddsPadi Standard Training Data Package — 2026-07-29");
summary.getRange("A3:B12").values = [
  ["Live metric", "Value"],
  ["Pending unscored tennis decisions", 196900],
  ["Current pending unscored tennis decisions", 136432],
  ["Past/finished tennis fixtures without scores", 1300],
  ["API-Tennis matches fetched in one-day proof", 449],
  ["Football settled outcomes in latest candidate", 18],
  ["Football outcomes with closing price", 12],
  ["Required closing coverage", 0.8],
  ["Current closing coverage", 0.666667],
  ["Additional closing outcomes needed", null],
];
summary.getRange("B12").formulas = [["=MAX(0,ROUNDUP(B10*B8,0)-B9)"]];
summary.getRange("B4:B7").format.numberFormat = "#,##0";
summary.getRange("B8:B9").format.numberFormat = "#,##0";
summary.getRange("B10:B11").format.numberFormat = "0.00%";
header(summary, "A3:B3");
summary.getRange("D3:H3").values = [["Priority", "Dataset", "Outcome", "Status", "Primary route"]];
summary.getRange("D4:H6").values = [
  [1, "Tennis results + scores", "Backfill labels for live api-tennis fixture identities", "READY", "API-Tennis supervised backfill"],
  [2, "Football results + opening/closing odds", "Raise CLV coverage and support 3-season walk-forward tests", footballClosingCoverage >= 0.8 ? "PASS" : "REVIEW", "Football-Data standard corpus"],
  [3, "Provider entitlements", "Prevent failed or wasteful historical calls", "PARTIAL", "Read-only live probes"],
];
header(summary, "D3:H3");
summary.getRange("G4:G6").format.fill = amber;
summary.getRange("A14:H17").values = [
  ["Package guardrail", "Rule", "", "", "", "", "", ""],
  ["No live writes", "This build performed read-only probes and created local files only.", "", "", "", "", "", ""],
  ["No synthetic labels", "Missing scores, closing timestamps, and plan tiers remain explicitly null or unconfirmed.", "", "", "", "", "", ""],
  ["Promotion remains locked", "A dataset passing format/coverage checks does not authorize learned weights or public picks.", "", "", "", "", "", ""],
];
summary.getRange("A14:H14").format = { fill: paleBlue, font: { bold: true, color: navy } };
summary.freezePanes.freezeRows(3);

const catalogRows = [
  ["football_matches_v1", path.basename(files.footballMatches), footballMatches.length, "match", "3 seasons × Big Five", "TRAINING-READY", "Results and final scores"],
  ["football_odds_v1", path.basename(files.footballOdds), footballOdds.length, "quote", "opening + closing", footballClosingCoverage >= 0.8 ? "TRAINING-READY" : "BLOCKED", "Market Average is primary closing source"],
  ["tennis_matches_v1", path.basename(files.tennisMatches), tennisMatches.length, "match", "ATP + WTA 2024-2026", "RESEARCH-READY", "Scores included; not identity-perfect live backfill"],
  ["tennis_odds_v1", path.basename(files.tennisOdds), tennisOdds.length, "quote", "ATP + WTA 2024-2026", "RESEARCH-READY", "Closing status intentionally not asserted"],
  ["source_manifest_v1", path.basename(files.sourceManifest), sourceManifest.length, "source", "all inputs", "AUDIT-READY", "Hashes, retrieval times, licensing"],
];
catalog.getRange(`A1:G${catalogRows.length + 1}`).values = [
  ["Dataset ID", "File", "Rows", "Grain", "Coverage", "Readiness", "Notes"],
  ...catalogRows,
];
header(catalog, "A1:G1");
catalog.getRange(`C2:C${catalogRows.length + 1}`).format.numberFormat = "#,##0";
catalog.tables.add(`A1:G${catalogRows.length + 1}`, true, "DatasetCatalogTable");
catalog.freezePanes.freezeRows(1);

const gateRows = [
  ["football_closing_coverage_080", 0.8, footballClosingCoverage, footballClosingCoverage >= 0.8 ? "PASS" : "FAIL", "Complete Market Average closing H/D/A triplet per finished match"],
  ["football_opening_closing_pair_coverage_080", 0.8, footballPairCoverage, footballPairCoverage >= 0.8 ? "PASS" : "FAIL", "At least one bookmaker has complete opening and closing triplets"],
  ["tennis_score_coverage_099", 0.99, tennisScoreCoverage, tennisScoreCoverage >= 0.99 ? "PASS" : "FAIL", "Winner/loser set totals exist"],
  ["live_tennis_identity_alignment", 1, 0, "BLOCKED", "Public corpus does not replace provider-id API-Tennis backfill"],
  ["source_provenance", 1, 1, "PASS", "Every file has source URL, retrieval time, and hash"],
];
gates.getRange(`A1:E${gateRows.length + 1}`).values = [
  ["Gate", "Threshold", "Observed", "Status", "Definition"],
  ...gateRows,
];
header(gates, "A1:E1");
gates.getRange(`B2:C${gateRows.length + 1}`).format.numberFormat = "0.00%";
gates.tables.add(`A1:E${gateRows.length + 1}`, true, "ValidationGatesTable");
gates.freezePanes.freezeRows(1);

const providerRows = [
  ["API-Football", "configured + active", "Ultra", "75,000/day; 44,521 remaining at proof", "2026-08-09", "Confirmed by /status"],
  ["API-Basketball", "configured; quota exhausted", "not confirmed", "Daily request limit reached", null, "Do not schedule backfill until reset/plan confirmation"],
  ["API-Tennis", "configured + endpoint active", "not exposed", "449 fetched for 2026-07-28", null, "Production key exists; previous unconfigured check is stale"],
  ["The Odds API", "configured; quota exhausted", "not confirmed", "Historical EPL probe returned quota reached", null, "Preview-only 100k label is not production proof"],
];
providers.getRange(`A1:F${providerRows.length + 1}`).values = [
  ["Provider", "Live status", "Confirmed plan", "Capacity / proof", "Ends", "Interpretation"],
  ...providerRows,
];
header(providers, "A1:F1");
providers.getRange("E2:E5").format.numberFormat = "yyyy-mm-dd";
providers.tables.add(`A1:F${providerRows.length + 1}`, true, "ProviderProofTable");
providers.freezePanes.freezeRows(1);

sources.getRange(`A1:L${sourceManifest.length + 1}`).values = [
  manifestColumns.map((column) => column.replaceAll("_", " ")),
  ...sourceManifest.map((row) => manifestColumns.map((column) => row[column])),
];
header(sources, "A1:L1");
sources.getRange(`H2:J${sourceManifest.length + 1}`).format.numberFormat = "#,##0";
sources.tables.add(`A1:L${sourceManifest.length + 1}`, true, "SourceManifestTable");
sources.freezePanes.freezeRows(1);

function populateSample(sheet, rows, columns, tableName, limit = 60) {
  const selected = rows.slice(0, limit);
  sheet.getRangeByIndexes(0, 0, selected.length + 1, columns.length).values = [
    columns,
    ...selected.map((row) => columns.map((column) => row[column])),
  ];
  header(sheet, `A1:${columnName(columns.length)}1`);
  sheet.tables.add(`A1:${columnName(columns.length)}${selected.length + 1}`, true, tableName);
  sheet.freezePanes.freezeRows(1);
}

function columnName(count) {
  let value = count;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

populateSample(tennisSample, tennisMatches, tennisMatchColumns.slice(0, 24), "TennisSampleTable");
populateSample(footballSample, footballMatches, footballMatchColumns, "FootballSampleTable");
populateSample(oddsSample, footballOdds.filter((row) => row.is_closing), footballOddsColumns, "FootballOddsSampleTable");

for (const sheet of [summary, catalog, gates, providers, sources, tennisSample, footballSample, oddsSample]) {
  finishSheet(sheet);
}
summary.getRange("A:A").format.columnWidth = 34;
summary.getRange("D:D").format.columnWidth = 10;
summary.getRange("E:E").format.columnWidth = 34;
summary.getRange("F:F").format.columnWidth = 34;
summary.getRange("G:G").format.columnWidth = 16;
summary.getRange("H:H").format.columnWidth = 34;
catalog.getRange("A:G").format.columnWidth = 24;
gates.getRange("A:E").format.columnWidth = 28;
providers.getRange("A:F").format.columnWidth = 26;
sources.getRange("A:L").format.columnWidth = 22;
tennisSample.getUsedRange().format.columnWidth = 18;
footballSample.getUsedRange().format.columnWidth = 18;
oddsSample.getUsedRange().format.columnWidth = 18;

const workbookPath = path.join(packageDir, "odds_padi_training_data_standard_v1.xlsx");
const outputWorkbookPath = workbookPath;
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(workbookPath);

const inspectSummary = await workbook.inspect({
  kind: "table",
  range: "Summary!A1:H17",
  include: "values,formulas",
  tableMaxRows: 20,
  tableMaxCols: 10,
  maxChars: 8000,
});
const formulaErrors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 100 },
  summary: "final formula error scan",
  maxChars: 3000,
});
await fs.writeFile(path.join(workDir, "workbook-inspection.ndjson"), `${inspectSummary.ndjson}\n${formulaErrors.ndjson}\n`);

for (const sheetName of ["Summary", "Dataset Catalog", "Validation Gates", "Provider Proof", "Sources", "Tennis Sample", "Football Sample", "Football Odds Sample"]) {
  const preview = await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(
    path.join(previewDir, `${slug(sheetName)}.png`),
    new Uint8Array(await preview.arrayBuffer()),
  );
}

const packageReadmeCopy = path.join(workDir, "training-data-package-readme.md");
await fs.copyFile(path.join(packageDir, "README.md"), packageReadmeCopy);

console.log(
  JSON.stringify(
    {
      packageDir,
      workbookPath,
      outputWorkbookPath,
      counts: validation.datasets,
      gates: validation.gates,
      previews: previewDir,
      files,
    },
    null,
    2,
  ),
);
