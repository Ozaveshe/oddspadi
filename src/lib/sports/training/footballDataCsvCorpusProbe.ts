import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type FootballDataCsvProbeStatus = "ready" | "partial" | "failed" | "invalid-request";

export type FootballDataCsvProbeSeason = {
  seasonStart: number;
  seasonLabel: string;
  seasonCode: string;
  sourceUrl: string;
  status: "loaded" | "failed";
  rows: number;
  finishedFixtures: number;
  oddsRows: number;
  dateRange: {
    first: string | null;
    last: string | null;
  };
  teams: number;
  columns: string[];
  oddsColumns: string[];
  sampleFixtures: Array<{
    date: string;
    homeTeam: string;
    awayTeam: string;
    homeGoals: number;
    awayGoals: number;
    result: string;
    bookmakerOdds: {
      home: number | null;
      draw: number | null;
      away: number | null;
    };
  }>;
  error: string | null;
};

export type FootballDataCsvFixtureCandidate = {
  seasonStart: number;
  seasonLabel: string;
  seasonCode: string;
  fixtureExternalId: string;
  kickoffAt: string;
  homeTeam: string;
  awayTeam: string;
  homeGoals: number;
  awayGoals: number;
  result: "H" | "D" | "A";
  odds: {
    bookmaker: "Bet365";
    home: number;
    draw: number;
    away: number;
  } | null;
};

export type FootballDataCsvCorpusProbe = {
  mode: "football-data-csv-corpus-probe";
  generatedAt: string;
  status: FootballDataCsvProbeStatus;
  summary: string;
  provider: {
    name: "Football-Data.co.uk";
    leagueCode: "E0";
    competition: "English Premier League";
    sourcePattern: string;
    coverageNote: string;
  };
  request: {
    seasonFrom: number;
    seasonTo: number;
    maxSeasons: number;
    dryRun: true;
  };
  totals: {
    seasonsRequested: number;
    seasonsLoaded: number;
    rows: number;
    finishedFixtures: number;
    oddsRows: number;
    teams: number;
    normalizedFixtureCandidates: number;
    normalizedOddsSnapshotCandidates: number;
  };
  seasons: FootballDataCsvProbeSeason[];
  modelUnlocks: string[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

type FetchCsv = (url: string) => Promise<string>;

const DEFAULT_SEASON_FROM = 2016;
const DEFAULT_SEASON_TO = 2025;
const DEFAULT_MAX_SEASONS = 10;
const EPL_LEAGUE_CODE = "E0";
const SOURCE_PATTERN = "https://www.football-data.co.uk/mmz4281/{seasonCode}/E0.csv";

function clampInteger(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalizeFootballDataSeasonRange({
  seasonFrom,
  seasonTo,
  maxSeasons
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
}) {
  const from = Number.isInteger(seasonFrom) ? clampInteger(seasonFrom as number, 1993, 2025) : DEFAULT_SEASON_FROM;
  const to = Number.isInteger(seasonTo) ? clampInteger(seasonTo as number, from, 2025) : DEFAULT_SEASON_TO;
  const cappedMax = Number.isInteger(maxSeasons) ? clampInteger(maxSeasons as number, 1, DEFAULT_MAX_SEASONS) : DEFAULT_MAX_SEASONS;
  const starts = Array.from({ length: to - from + 1 }, (_, index) => from + index).slice(0, cappedMax);
  return {
    seasonFrom: from,
    seasonTo: starts.at(-1) ?? from,
    maxSeasons: cappedMax,
    starts
  };
}

export function footballDataSeasonCode(seasonStart: number): string {
  const start = String(seasonStart % 100).padStart(2, "0");
  const end = String((seasonStart + 1) % 100).padStart(2, "0");
  return `${start}${end}`;
}

function seasonLabel(seasonStart: number): string {
  return `${seasonStart}/${String((seasonStart + 1) % 100).padStart(2, "0")}`;
}

function sourceUrl(seasonStart: number): string {
  return `https://www.football-data.co.uk/mmz4281/${footballDataSeasonCode(seasonStart)}/${EPL_LEAGUE_CODE}.csv`;
}

export function parseFootballDataCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((item) => item.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((item) => item.trim())) rows.push(row);
  return rows;
}

function parseNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function parseDate(value: string | undefined): string | null {
  const clean = value?.trim();
  if (!clean) return null;
  const parts = clean.split(/[/-]/).map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return null;
  const [day, month, rawYear] = parts;
  const year = rawYear < 100 ? (rawYear >= 70 ? 1900 + rawYear : 2000 + rawYear) : rawYear;
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function rowObject(headers: string[], row: string[]): Record<string, string> {
  return Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""]));
}

function analyzeSeasonCsv(seasonStart: number, text: string): FootballDataCsvProbeSeason {
  const candidates = parseFootballDataCsvFixtureCandidates(seasonStart, text);
  const parsed = parseFootballDataCsv(text);
  const headers = parsed[0]?.map((item) => item.trim()).filter(Boolean) ?? [];
  const rows = parsed.slice(1).map((row) => rowObject(headers, row));
  const oddsColumns = headers.filter((column) => /^(B365|BW|IW|PS|WH|VC|Max|Avg).*[HDA]$/i.test(column));
  const dates = candidates.map((fixture) => fixture.kickoffAt).sort();
  const teams = new Set<string>();
  for (const fixture of candidates) {
    teams.add(fixture.homeTeam);
    teams.add(fixture.awayTeam);
  }

  return {
    seasonStart,
    seasonLabel: seasonLabel(seasonStart),
    seasonCode: footballDataSeasonCode(seasonStart),
    sourceUrl: sourceUrl(seasonStart),
    status: "loaded",
    rows: rows.length,
    finishedFixtures: candidates.length,
    oddsRows: candidates.filter((fixture) => fixture.odds).length,
    dateRange: {
      first: dates[0] ?? null,
      last: dates.at(-1) ?? null
    },
    teams: teams.size,
    columns: headers.slice(0, 120),
    oddsColumns,
    sampleFixtures: candidates.slice(0, 3).map((fixture) => ({
      date: fixture.kickoffAt,
      homeTeam: fixture.homeTeam,
      awayTeam: fixture.awayTeam,
      homeGoals: fixture.homeGoals,
      awayGoals: fixture.awayGoals,
      result: fixture.result,
      bookmakerOdds: {
        home: fixture.odds?.home ?? null,
        draw: fixture.odds?.draw ?? null,
        away: fixture.odds?.away ?? null
      }
    })),
    error: null
  };
}

export function parseFootballDataCsvFixtureCandidates(seasonStart: number, text: string): FootballDataCsvFixtureCandidate[] {
  const parsed = parseFootballDataCsv(text);
  const headers = parsed[0]?.map((item) => item.trim()).filter(Boolean) ?? [];
  const rows = parsed.slice(1).map((row) => rowObject(headers, row));
  return rows
    .map((row, index): FootballDataCsvFixtureCandidate | null => {
      const kickoffAt = parseDate(row.Date);
      const homeTeam = row.HomeTeam?.trim();
      const awayTeam = row.AwayTeam?.trim();
      const homeGoals = parseInteger(row.FTHG);
      const awayGoals = parseInteger(row.FTAG);
      const result = row.FTR?.trim();
      const homeOdds = parseNumber(row.B365H);
      const drawOdds = parseNumber(row.B365D);
      const awayOdds = parseNumber(row.B365A);
      if (!kickoffAt || !homeTeam || !awayTeam || homeGoals === null || awayGoals === null) return null;
      if (result !== "H" && result !== "D" && result !== "A") return null;
      return {
        seasonStart,
        seasonLabel: seasonLabel(seasonStart),
        seasonCode: footballDataSeasonCode(seasonStart),
        fixtureExternalId: `football-data:E0:${footballDataSeasonCode(seasonStart)}:${index + 1}`,
        kickoffAt,
        homeTeam,
        awayTeam,
        homeGoals,
        awayGoals,
        result,
        odds:
          homeOdds && drawOdds && awayOdds
            ? {
                bookmaker: "Bet365",
                home: homeOdds,
                draw: drawOdds,
                away: awayOdds
              }
            : null
      };
    })
    .filter((fixture): fixture is FootballDataCsvFixtureCandidate => Boolean(fixture));
}

async function defaultFetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function failedSeason(seasonStart: number, error: unknown): FootballDataCsvProbeSeason {
  return {
    seasonStart,
    seasonLabel: seasonLabel(seasonStart),
    seasonCode: footballDataSeasonCode(seasonStart),
    sourceUrl: sourceUrl(seasonStart),
    status: "failed",
    rows: 0,
    finishedFixtures: 0,
    oddsRows: 0,
    dateRange: {
      first: null,
      last: null
    },
    teams: 0,
    columns: [],
    oddsColumns: [],
    sampleFixtures: [],
    error: error instanceof Error ? error.message : "Failed to fetch or parse CSV."
  };
}

export async function buildFootballDataCsvCorpusProbe({
  seasonFrom,
  seasonTo,
  maxSeasons,
  fetchCsv = defaultFetchCsv,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  fetchCsv?: FetchCsv;
  now?: Date;
} = {}): Promise<FootballDataCsvCorpusProbe> {
  const range = normalizeFootballDataSeasonRange({ seasonFrom, seasonTo, maxSeasons });
  if (!range.starts.length) {
    return {
      mode: "football-data-csv-corpus-probe",
      generatedAt: now.toISOString(),
      status: "invalid-request",
      summary: "No valid EPL seasons were requested.",
      provider: {
        name: "Football-Data.co.uk",
        leagueCode: EPL_LEAGUE_CODE,
        competition: "English Premier League",
        sourcePattern: SOURCE_PATTERN,
        coverageNote: "Public CSVs can seed historical EPL fixture/results and bookmaker odds checks, but not injuries, lineups, live events, or official provider IDs."
      },
      request: {
        seasonFrom: range.seasonFrom,
        seasonTo: range.seasonTo,
        maxSeasons: range.maxSeasons,
        dryRun: true
      },
      totals: {
        seasonsRequested: 0,
        seasonsLoaded: 0,
        rows: 0,
        finishedFixtures: 0,
        oddsRows: 0,
        teams: 0,
        normalizedFixtureCandidates: 0,
        normalizedOddsSnapshotCandidates: 0
      },
      seasons: [],
      modelUnlocks: [],
      nextAction: publicCsvProbeCommand(range.seasonFrom, range.seasonTo, range.maxSeasons),
      controls: readOnlyControls(false),
      locks: corpusLocks(),
      proofUrls: proofUrls()
    };
  }

  const seasons = await Promise.all(
    range.starts.map(async (seasonStart) => {
      try {
        return analyzeSeasonCsv(seasonStart, await fetchCsv(sourceUrl(seasonStart)));
      } catch (error) {
        return failedSeason(seasonStart, error);
      }
    })
  );
  const loaded = seasons.filter((season) => season.status === "loaded");
  const teamSet = new Set<string>();
  for (const season of loaded) {
    for (const fixture of season.sampleFixtures) {
      teamSet.add(fixture.homeTeam);
      teamSet.add(fixture.awayTeam);
    }
  }
  const totals = {
    seasonsRequested: seasons.length,
    seasonsLoaded: loaded.length,
    rows: seasons.reduce((sum, season) => sum + season.rows, 0),
    finishedFixtures: seasons.reduce((sum, season) => sum + season.finishedFixtures, 0),
    oddsRows: seasons.reduce((sum, season) => sum + season.oddsRows, 0),
    teams: Math.max(...seasons.map((season) => season.teams), teamSet.size, 0),
    normalizedFixtureCandidates: seasons.reduce((sum, season) => sum + season.finishedFixtures, 0),
    normalizedOddsSnapshotCandidates: seasons.reduce((sum, season) => sum + season.oddsRows, 0)
  };
  const status: FootballDataCsvProbeStatus = loaded.length === seasons.length ? "ready" : loaded.length ? "partial" : "failed";

  return {
    mode: "football-data-csv-corpus-probe",
    generatedAt: now.toISOString(),
    status,
    summary:
      status === "ready"
        ? `Loaded ${totals.finishedFixtures} historical EPL fixture candidate(s) and ${totals.oddsRows} odds row(s) from ${totals.seasonsLoaded} public CSV season(s).`
        : status === "partial"
          ? `Loaded ${totals.seasonsLoaded}/${totals.seasonsRequested} EPL CSV season(s); failed seasons remain read-only blockers.`
          : "Could not load public EPL CSV evidence from Football-Data.co.uk.",
    provider: {
      name: "Football-Data.co.uk",
      leagueCode: EPL_LEAGUE_CODE,
      competition: "English Premier League",
      sourcePattern: SOURCE_PATTERN,
      coverageNote: "Public CSVs can seed historical EPL fixture/results and bookmaker odds checks, but not injuries, lineups, live events, or official provider IDs."
    },
    request: {
      seasonFrom: range.seasonFrom,
      seasonTo: range.seasonTo,
      maxSeasons: range.maxSeasons,
      dryRun: true
    },
    totals,
    seasons,
    modelUnlocks: [
      "Football result labels for Poisson and Elo backtests.",
      "Home/away team history and recent form windows.",
      "Bookmaker 1X2 odds columns for implied probability, no-vig normalization, and value-edge rehearsal.",
      "A safe bridge from planning to real historical row counts before paid provider enrichment."
    ],
    nextAction: publicCsvProbeCommand(range.seasonFrom, range.seasonTo, range.maxSeasons),
    controls: readOnlyControls(status !== "failed"),
    locks: corpusLocks(),
    proofUrls: proofUrls()
  };
}

function publicCsvProbeCommand(seasonFrom = DEFAULT_SEASON_FROM, seasonTo = DEFAULT_SEASON_TO, maxSeasons = DEFAULT_MAX_SEASONS) {
  const verifyUrl = `/api/sports/decision/training/football-data-csv-probe?seasonFrom=${seasonFrom}&seasonTo=${seasonTo}&maxSeasons=${maxSeasons}&dryRun=1`;
  return {
    label: "Run public EPL historical CSV corpus probe",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence: "Read-only public EPL CSV counts for finished fixtures, teams, odds columns, sample normalized rows, and model/backtest unlocks."
  };
}

function readOnlyControls(canRunDryRun: boolean): FootballDataCsvCorpusProbe["controls"] {
  return {
    canInspectReadOnly: true,
    canRunDryRun,
    canWriteProviderRows: false,
    canPersistTrainingRows: false,
    canTrainModels: false,
    canPublishPicks: false,
    canStake: false
  };
}

function corpusLocks(): string[] {
  return [
    "Football-Data CSV probing is read-only and must not write op_* tables.",
    "Public CSV rows do not replace paid provider enrichment for injuries, lineups, live events, news, weather, or official fixture IDs.",
    "Training remains locked until normalized historical rows are persisted, feature snapshots are generated, and backtests pass."
  ];
}

function proofUrls(): string[] {
  return [
    "/api/sports/decision/training/football-data-csv-probe",
    "/api/sports/decision/training/historical-corpus-acquisition",
    "/api/sports/decision/training/ten-year-corpus-execution"
  ];
}

export const FOOTBALL_DATA_CSV_PROBE_DEFAULT_VERIFY_URL =
  "/api/sports/decision/training/football-data-csv-probe?seasonFrom=2016&seasonTo=2025&maxSeasons=10&dryRun=1";

export const FOOTBALL_DATA_CSV_PROBE_DEFAULT_COMMAND = decisionCurlCommand(FOOTBALL_DATA_CSV_PROBE_DEFAULT_VERIFY_URL);
