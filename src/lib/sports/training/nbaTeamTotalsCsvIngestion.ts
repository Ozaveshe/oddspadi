import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import {
  ingestHistoricalFootballFixtures,
  type HistoricalFootballFixtureInput,
  type HistoricalFootballIngestResult
} from "@/lib/sports/training/historicalIngestion";

type FetchCsv = (url: string) => Promise<string>;
type Ingest = typeof ingestHistoricalFootballFixtures;
type Status = "stored" | "dry-run" | "partial" | "failed" | "invalid-request";

type TeamGameRow = {
  seasonLabel: string;
  seasonEnd: number;
  gameId: string;
  date: string;
  teamId: string;
  teamName: string;
  matchup: string;
  points: number;
  plusMinus: number;
  possessions: number;
};

type PairedGame = {
  seasonLabel: string;
  seasonEnd: number;
  gameId: string;
  kickoffAt: string;
  home: TeamGameRow;
  away: TeamGameRow;
};

type TeamState = {
  games: number;
  wins: number;
  pointsFor: number;
  pointsAgainst: number;
  possessionsFor: number;
  possessionsAgainst: number;
  recent: Array<{ pointsFor: number; pointsAgainst: number; possessions: number; won: boolean }>;
  lastGameAt: number | null;
  rating: number;
};

export type NbaTeamTotalsCsvIngestion = {
  mode: "nba-team-totals-csv-ingestion";
  generatedAt: string;
  status: Status;
  summary: string;
  provider: {
    name: "NBA team totals public CSV";
    providerKey: "nba_team_totals_csv";
    sourceUrl: string;
  };
  request: {
    seasonFrom: number;
    seasonTo: number;
    maxSeasons: number;
    offset: number;
    limit: number | null;
    dryRun: boolean;
  };
  totals: {
    seasonsRequested: number;
    seasonsLoaded: number;
    csvRowsLoaded: number;
    gamesPrepared: number;
    oddsRowsPrepared: number;
    featureSnapshotsPrepared: number;
    rowsWritten: number;
  };
  seasons: Array<{ seasonEnd: number; seasonLabel: string; gamesPrepared: number }>;
  ingestion: HistoricalFootballIngestResult | null;
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: true;
    canWriteHistoricalRows: boolean;
    canRunBacktestAfterStore: boolean;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

const SOURCE_URL = "https://raw.githubusercontent.com/NocturneBear/NBA-Data-2010-2024/main/regular_season_totals_2010_2024.csv";
const DEFAULT_SEASON_FROM = 2024;
const DEFAULT_SEASON_TO = 2024;
const DEFAULT_MAX_SEASONS = 1;
const MAX_GAMES = 20000;
let csvCache: string | null = null;

async function defaultFetchCsv(url: string): Promise<string> {
  if (csvCache) return csvCache;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  csvCache = await response.text();
  return csvCache;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(cell);
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells.map((value) => value.trim());
}

function numberAt(row: Record<string, string>, key: string): number | null {
  const parsed = Number(row[key]);
  return Number.isFinite(parsed) ? parsed : null;
}

function seasonEnd(label: string): number | null {
  const match = label.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const start = Number(match[1]);
  const suffix = Number(match[2]);
  if (!Number.isFinite(start) || !Number.isFinite(suffix)) return null;
  return Math.floor(start / 100) * 100 + suffix;
}

function possessions(row: Record<string, string>): number {
  const fga = numberAt(row, "FGA") ?? 0;
  const fta = numberAt(row, "FTA") ?? 0;
  const oreb = numberAt(row, "OREB") ?? 0;
  const tov = numberAt(row, "TOV") ?? 0;
  return Math.max(60, fga + 0.44 * fta - oreb + tov);
}

function parseRows(csv: string, seasonEnds: Set<number>): TeamGameRow[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const header = splitCsvLine(lines[0] ?? "");
  return lines.slice(1).flatMap((line) => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
    const end = seasonEnd(row.SEASON_YEAR ?? "");
    const points = numberAt(row, "PTS");
    const plusMinus = numberAt(row, "PLUS_MINUS");
    if (!end || !seasonEnds.has(end) || !row.GAME_ID || !row.GAME_DATE || !row.TEAM_ID || !row.MATCHUP || points === null || plusMinus === null) {
      return [];
    }
    return [
      {
        seasonLabel: row.SEASON_YEAR,
        seasonEnd: end,
        gameId: row.GAME_ID,
        date: row.GAME_DATE,
        teamId: `nba-stats:${row.TEAM_ID}`,
        teamName: row.TEAM_NAME,
        matchup: row.MATCHUP,
        points,
        plusMinus,
        possessions: possessions(row)
      }
    ];
  });
}

function pairGames(rows: TeamGameRow[]): PairedGame[] {
  const byGame = new Map<string, TeamGameRow[]>();
  for (const row of rows) byGame.set(row.gameId, [...(byGame.get(row.gameId) ?? []), row]);
  return Array.from(byGame.values()).flatMap((gameRows) => {
    if (gameRows.length < 2) return [];
    const home = gameRows.find((row) => row.matchup.includes(" vs. "));
    const away = gameRows.find((row) => row.matchup.includes(" @ "));
    if (!home || !away) return [];
    const kickoffAt = new Date(home.date).toISOString();
    return [{ seasonLabel: home.seasonLabel, seasonEnd: home.seasonEnd, gameId: home.gameId, kickoffAt, home, away }];
  });
}

function round(value: number | null | undefined, digits = 6): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stateFor(map: Map<string, TeamState>, teamId: string): TeamState {
  const existing = map.get(teamId);
  if (existing) return existing;
  const created: TeamState = {
    games: 0,
    wins: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    possessionsFor: 0,
    possessionsAgainst: 0,
    recent: [],
    lastGameAt: null,
    rating: 1500
  };
  map.set(teamId, created);
  return created;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function restDays(state: TeamState, kickoffAt: string): number | null {
  if (!state.lastGameAt) return null;
  return Math.max(0, Math.min(14, (new Date(kickoffAt).getTime() - state.lastGameAt) / 86400000));
}

function featuresFor(state: TeamState, kickoffAt: string) {
  const recent = state.recent.slice(-5);
  const pointsFor = average(recent.map((item) => item.pointsFor)) ?? (state.games ? state.pointsFor / state.games : 112);
  const pointsAgainst = average(recent.map((item) => item.pointsAgainst)) ?? (state.games ? state.pointsAgainst / state.games : 112);
  const poss = average(recent.map((item) => item.possessions)) ?? (state.games ? state.possessionsFor / state.games : 98);
  const offensiveEfficiency = pointsFor / Math.max(1, poss) * 100;
  const defensiveEfficiency = pointsAgainst / Math.max(1, poss) * 100;
  return {
    eloRating: round(state.rating, 3),
    attackStrength: round(offensiveEfficiency, 3),
    defenseStrength: round(defensiveEfficiency, 3),
    recentFormPoints: round(recent.reduce((sum, item) => sum + (item.won ? 2 : 0), 0), 3),
    recentGoalsFor: round(pointsFor),
    recentGoalsAgainst: round(pointsAgainst),
    restDays: round(restDays(state, kickoffAt), 3),
    injuriesCount: null,
    suspensionsCount: null,
    lineupConfirmed: false,
    metadata: {
      source: "nba-team-totals-csv",
      featureMethod: "team-totals-possessions-efficiency-rest-rating",
      rating: round(state.rating, 3),
      pace: round(poss, 3),
      offensiveEfficiency: round(offensiveEfficiency, 3),
      defensiveEfficiency: round(defensiveEfficiency, 3),
      gamesPlayedBeforeTip: state.games
    }
  };
}

function updateRatings(home: TeamState, away: TeamState, homeScore: number, awayScore: number): void {
  const expectedHome = 1 / (1 + 10 ** ((away.rating - home.rating - 45) / 400));
  const actualHome = homeScore > awayScore ? 1 : 0;
  const marginFactor = Math.max(0.7, Math.min(1.8, Math.abs(homeScore - awayScore) / 12));
  const k = 18 * marginFactor;
  home.rating += k * (actualHome - expectedHome);
  away.rating += k * ((1 - actualHome) - (1 - expectedHome));
}

function updateState(state: TeamState, scored: number, allowed: number, poss: number): void {
  const won = scored > allowed;
  state.games += 1;
  state.wins += won ? 1 : 0;
  state.pointsFor += scored;
  state.pointsAgainst += allowed;
  state.possessionsFor += poss;
  state.possessionsAgainst += poss;
  state.recent = [...state.recent, { pointsFor: scored, pointsAgainst: allowed, possessions: poss, won }].slice(-8);
}

function toFixtures(games: PairedGame[], offset: number, limit?: number): HistoricalFootballFixtureInput[] {
  const sorted = [...games].sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
  const states = new Map<string, TeamState>();
  const fixtures: HistoricalFootballFixtureInput[] = [];
  sorted.forEach((game, index) => {
    const home = stateFor(states, game.home.teamId);
    const away = stateFor(states, game.away.teamId);
    if (index >= offset && fixtures.length < (limit && limit > 0 ? Math.min(limit, MAX_GAMES) : MAX_GAMES)) {
      fixtures.push({
        sport: "basketball",
        externalId: `nba-team-totals:${game.gameId}`,
        kickoffAt: game.kickoffAt,
        league: { externalId: "nba-team-totals:nba", name: "National Basketball Association", country: "USA", strength: 0.96, metadata: { source: "nba-team-totals-csv" } },
        season: game.seasonLabel,
        round: "regular-season",
        status: "finished",
        homeTeam: { externalId: game.home.teamId, name: game.home.teamName, country: "USA" },
        awayTeam: { externalId: game.away.teamId, name: game.away.teamName, country: "USA" },
        homeScore: game.home.points,
        awayScore: game.away.points,
        neutralVenue: false,
        country: "USA",
        dataQuality: 0.78,
        homeFeatures: featuresFor(home, game.kickoffAt),
        awayFeatures: featuresFor(away, game.kickoffAt),
        odds: [],
        metadata: { source: "nba-team-totals-csv", sourceSeason: game.seasonLabel, gameId: game.gameId, oddsCoverage: "not-in-public-team-totals-csv" }
      });
    }
    updateRatings(home, away, game.home.points, game.away.points);
    updateState(home, game.home.points, game.away.points, game.home.possessions);
    updateState(away, game.away.points, game.home.points, game.away.possessions);
    const timestamp = new Date(game.kickoffAt).getTime();
    home.lastGameAt = timestamp;
    away.lastGameAt = timestamp;
  });
  return fixtures;
}

function seasonLabelForEnd(end: number): string {
  return `${end - 1}-${String(end).slice(-2)}`;
}

function statusFor(ingestion: HistoricalFootballIngestResult | null): Status {
  if (!ingestion) return "invalid-request";
  if (ingestion.status === "stored") return "stored";
  if (ingestion.status === "dry-run") return "dry-run";
  return "failed";
}

export async function buildNbaTeamTotalsCsvIngestion({
  seasonFrom = DEFAULT_SEASON_FROM,
  seasonTo = DEFAULT_SEASON_TO,
  maxSeasons = DEFAULT_MAX_SEASONS,
  offset = 0,
  limit,
  dryRun = true,
  fetchCsv = defaultFetchCsv,
  ingest = ingestHistoricalFootballFixtures,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  offset?: number;
  limit?: number;
  dryRun?: boolean;
  fetchCsv?: FetchCsv;
  ingest?: Ingest;
  now?: Date;
} = {}): Promise<NbaTeamTotalsCsvIngestion> {
  const start = Math.max(2011, Math.min(seasonFrom, seasonTo));
  const end = Math.min(2024, Math.max(seasonFrom, seasonTo));
  const selectedSeasonEnds = Array.from({ length: end - start + 1 }, (_, index) => start + index).slice(0, Math.max(1, Math.min(maxSeasons, 14)));
  const seasonSet = new Set(selectedSeasonEnds);
  const csv = await fetchCsv(SOURCE_URL);
  const rows = parseRows(csv, seasonSet);
  const games = pairGames(rows);
  const safeOffset = Math.max(0, Math.trunc(offset || 0));
  const safeLimit = limit && limit > 0 ? Math.min(limit, MAX_GAMES) : undefined;
  const fixtures = toFixtures(games, safeOffset, safeLimit);
  const ingestion = await ingest({ sport: "basketball", provider: "nba_team_totals_csv", sourceKind: "real", dryRun, fixtures });
  const status = statusFor(ingestion);
  const rowsWritten = ingestion?.rowsWritten ?? 0;
  const seasons = selectedSeasonEnds.map((seasonEnd) => ({
    seasonEnd,
    seasonLabel: seasonLabelForEnd(seasonEnd),
    gamesPrepared: games.filter((game) => game.seasonEnd === seasonEnd).length
  }));
  const query = new URLSearchParams({ seasonFrom: String(start), seasonTo: String(end), maxSeasons: String(selectedSeasonEnds.length), dryRun: dryRun ? "0" : "1" });
  if (safeOffset > 0) query.set("offset", String(safeOffset));
  if (safeLimit) query.set("limit", String(safeLimit));
  const verifyUrl = dryRun
    ? `/api/sports/decision/training/nba-team-totals-csv-ingest?${query.toString()}`
    : "/api/sports/decision/training/provider-corpus-dry-run-queue?sport=basketball";
  return {
    mode: "nba-team-totals-csv-ingestion",
    generatedAt: now.toISOString(),
    status,
    summary:
      status === "stored"
        ? `Stored ${rowsWritten} NBA team-totals historical row(s) across ${fixtures.length} game(s); odds and publishing remain locked.`
        : status === "dry-run"
          ? `Prepared ${fixtures.length} NBA team-totals game(s) as a dry-run; no rows were written.`
          : "NBA team-totals ingestion failed before reliable basketball rows could be prepared.",
    provider: { name: "NBA team totals public CSV", providerKey: "nba_team_totals_csv", sourceUrl: SOURCE_URL },
    request: { seasonFrom: start, seasonTo: end, maxSeasons: selectedSeasonEnds.length, offset: safeOffset, limit: safeLimit ?? null, dryRun },
    totals: {
      seasonsRequested: selectedSeasonEnds.length,
      seasonsLoaded: seasons.filter((season) => season.gamesPrepared > 0).length,
      csvRowsLoaded: rows.length,
      gamesPrepared: fixtures.length,
      oddsRowsPrepared: 0,
      featureSnapshotsPrepared: fixtures.length,
      rowsWritten
    },
    seasons,
    ingestion,
    nextAction: {
      label: dryRun ? "Store this NBA team-totals batch" : "Attach paid basketball odds/provider proof",
      command: `${decisionCurlCommand(verifyUrl)}${dryRun ? ' -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"' : ""}`,
      verifyUrl,
      expectedEvidence: dryRun
        ? "Dry-run counts show prepared NBA games, possession/efficiency feature rows, and zero writes before storage."
        : "Stored NBA team totals feed basketball model context while moneyline value remains locked until bookmaker odds are attached."
    },
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: true,
      canWriteHistoricalRows: !dryRun && status === "stored",
      canRunBacktestAfterStore: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "This public CSV contains real NBA scores and team totals, but no bookmaker moneyline odds.",
      "Basketball value-edge backtests remain locked until The Odds API or another bookmaker source supplies historical or live odds.",
      "Stored rows can improve basketball context/features but cannot publish picks or stake."
    ],
    proofUrls: [
      "/api/sports/decision/training/nba-team-totals-csv-ingest",
      "/api/sports/decision/training/provider-corpus-dry-run-queue?sport=basketball",
      "/api/sports/decision/training/supabase-training-corpus-census"
    ]
  };
}
