import { unzipSync, strFromU8 } from "fflate";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import {
  ingestHistoricalFootballFixtures,
  type HistoricalFootballFixtureInput,
  type HistoricalFootballIngestResult
} from "@/lib/sports/training/historicalIngestion";

type FetchWorkbook = (url: string) => Promise<ArrayBuffer>;
type Ingest = typeof ingestHistoricalFootballFixtures;

type TennisDataSurface = "hard" | "clay" | "grass" | "indoor" | "unknown";

export type TennisDataXlsxIngestionStatus = "stored" | "dry-run" | "partial" | "failed" | "invalid-request";

export type TennisDataXlsxIngestion = {
  mode: "tennis-data-xlsx-ingestion";
  generatedAt: string;
  status: TennisDataXlsxIngestionStatus;
  summary: string;
  provider: {
    name: "Tennis-Data.co.uk";
    providerKey: "tennis_data_xlsx";
    tour: "ATP";
  };
  request: {
    yearFrom: number;
    yearTo: number;
    maxYears: number;
    offset: number;
    limit: number | null;
    dryRun: boolean;
  };
  totals: {
    yearsRequested: number;
    yearsLoaded: number;
    matchesPrepared: number;
    oddsRowsPrepared: number;
    featureSnapshotsPrepared: number;
    rowsWritten: number;
    failedYears: number;
  };
  years: Array<{
    year: number;
    sourceUrl: string;
    status: "loaded" | "failed";
    workbookRows: number;
    preparedMatches: number;
    oddsRows: number;
    error: string | null;
  }>;
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

type TennisDataCandidate = {
  year: number;
  rowNumber: number;
  fixtureExternalId: string;
  kickoffAt: string;
  location: string;
  tournament: string;
  series: string;
  court: string;
  surface: TennisDataSurface;
  round: string;
  winner: string;
  loser: string;
  winnerRank: number | null;
  loserRank: number | null;
  winnerPoints: number | null;
  loserPoints: number | null;
  winnerSets: number;
  loserSets: number;
  odds: {
    bookmaker: string;
    winner: number;
    loser: number;
  } | null;
};

const DEFAULT_YEAR_FROM = 2024;
const DEFAULT_YEAR_TO = 2024;
const DEFAULT_MAX_YEARS = 1;
const MAX_MATCHES = 10000;

function sourceUrl(year: number): string {
  return `http://www.tennis-data.co.uk/${year}/${year}.xlsx`;
}

async function defaultFetchWorkbook(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.arrayBuffer();
}

function stableHashText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function stableHashNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function playerId(name: string): string {
  return `tennis-data:atp:player:${stableHashText(name)}`;
}

function tournamentId(year: number, tournament: string, location: string): string {
  return `tennis-data:atp:tournament:${year}:${stableHashText(`${location}-${tournament}`)}`;
}

function roundNumber(value: number | null | undefined, digits = 6): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value === null || value === undefined ? "" : String(value).trim();
}

function excelSerialDateToIso(value: number): string | null {
  if (!Number.isFinite(value)) return null;
  const excelEpoch = Date.UTC(1899, 11, 30);
  const millis = excelEpoch + value * 86400000;
  const parsed = new Date(millis);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0)).toISOString();
}

function excelDateToIso(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 12, 0, 0)).toISOString();
  }
  if (typeof value === "number") return excelSerialDateToIso(value);
  const raw = text(value);
  if (!raw) return null;
  const serial = Number(raw);
  if (Number.isFinite(serial) && serial > 20000 && serial < 60000) return excelSerialDateToIso(serial);
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12, 0, 0)).toISOString();
}

function normalizeSurface(value: unknown, court: unknown): TennisDataSurface {
  const surface = text(value).toLowerCase();
  const courtText = text(court).toLowerCase();
  if (surface.includes("hard")) return courtText.includes("indoor") ? "indoor" : "hard";
  if (surface.includes("clay")) return "clay";
  if (surface.includes("grass")) return "grass";
  if (courtText.includes("indoor")) return "indoor";
  return "unknown";
}

function preferredOdds(row: Record<string, unknown>): TennisDataCandidate["odds"] {
  const sources = [
    { bookmaker: "Tennis-Data Avg", winner: numberOrNull(row.AvgW), loser: numberOrNull(row.AvgL) },
    { bookmaker: "Pinnacle Sports", winner: numberOrNull(row.PSW), loser: numberOrNull(row.PSL) },
    { bookmaker: "Bet365", winner: numberOrNull(row.B365W), loser: numberOrNull(row.B365L) },
    { bookmaker: "Tennis-Data Max", winner: numberOrNull(row.MaxW), loser: numberOrNull(row.MaxL) }
  ];
  const selected = sources.find((item) => item.winner && item.loser && item.winner > 1 && item.loser > 1);
  return selected ? { bookmaker: selected.bookmaker, winner: selected.winner!, loser: selected.loser! } : null;
}

function rankToRating(rank: number | null, points: number | null): number | null {
  if (!rank && !points) return null;
  const rankComponent = rank ? 2250 - Math.log(rank + 1) * 135 : 1700;
  const pointsComponent = points ? Math.log(points + 1) * 52 : 0;
  return roundNumber(Math.max(1250, Math.min(2450, rankComponent + pointsComponent)));
}

function surfaceRating(rank: number | null, points: number | null): number | null {
  if (!rank && !points) return null;
  const rankScore = rank ? Math.max(0, Math.min(1, 1 - Math.log(rank + 1) / Math.log(450))) : 0.42;
  const pointsScore = points ? Math.max(0, Math.min(1, Math.log(points + 1) / Math.log(12000))) : 0.42;
  return roundNumber(rankScore * 0.55 + pointsScore * 0.45);
}

function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function columnIndex(cellRef: string): number {
  const letters = cellRef.match(/^[A-Z]+/)?.[0] ?? "";
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index;
}

function parseAttributes(value: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of value.matchAll(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)).map((match) =>
    Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((part) => decodeXml(part[1]))
      .join("")
  );
}

function parseCellValue(cellXml: string, attrs: Record<string, string>, sharedStrings: string[]): unknown {
  if (attrs.t === "inlineStr") {
    const inline = Array.from(cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g))
      .map((match) => decodeXml(match[1]))
      .join("");
    return inline;
  }
  const raw = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return "";
  const value = decodeXml(raw);
  if (attrs.t === "s") return sharedStrings[Number(value)] ?? "";
  if (attrs.t === "str") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : value;
}

function parseWorksheetRows(xml: string, sharedStrings: string[]): Array<Record<number, unknown>> {
  return Array.from(xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)).map((rowMatch) => {
    const row: Record<number, unknown> = {};
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = parseAttributes(cellMatch[1]);
      const ref = attrs.r ?? "";
      const col = columnIndex(ref);
      if (col > 0) row[col] = parseCellValue(cellMatch[2], attrs, sharedStrings);
    }
    return row;
  });
}

function firstWorksheetPath(files: Record<string, Uint8Array>): string | null {
  if (files["xl/worksheets/sheet1.xml"]) return "xl/worksheets/sheet1.xml";
  return Object.keys(files)
    .filter((name) => name.startsWith("xl/worksheets/") && name.endsWith(".xml"))
    .sort()[0] ?? null;
}

function parseWorkbookRows(buffer: ArrayBuffer): Array<Record<string, unknown>> {
  const files = unzipSync(new Uint8Array(buffer));
  const sharedStrings = parseSharedStrings(files["xl/sharedStrings.xml"] ? strFromU8(files["xl/sharedStrings.xml"]) : null);
  const worksheetPath = firstWorksheetPath(files);
  if (!worksheetPath) return [];
  const rows = parseWorksheetRows(strFromU8(files[worksheetPath]), sharedStrings);
  const headers: Record<number, string> = {};
  for (const [col, value] of Object.entries(rows[0] ?? {})) {
    const header = text(value);
    if (header) headers[Number(col)] = header;
  }
  return rows.slice(1).map((row) => {
    const output: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(row)) {
      const header = headers[Number(col)];
      if (header) output[header] = value;
    }
    return output;
  });
}

function candidateFromRow(year: number, rowNumber: number, row: Record<string, unknown>): TennisDataCandidate | null {
  if (text(row.Comment).toLowerCase() !== "completed") return null;
  const winner = text(row.Winner);
  const loser = text(row.Loser);
  const kickoffAt = excelDateToIso(row.Date);
  const winnerSets = numberOrNull(row.Wsets);
  const loserSets = numberOrNull(row.Lsets);
  if (!winner || !loser || !kickoffAt || winnerSets === null || loserSets === null || winnerSets === loserSets) return null;

  const location = text(row.Location) || "Unknown";
  const tournament = text(row.Tournament) || "ATP";
  const round = text(row.Round) || "Unknown";
  const sourceKey = `${year}:${location}:${tournament}:${kickoffAt}:${winner}:${loser}:${round}:${rowNumber}`;

  return {
    year,
    rowNumber,
    fixtureExternalId: `tennis-data:atp:${year}:${stableHashText(sourceKey)}`,
    kickoffAt,
    location,
    tournament,
    series: text(row.Series) || "ATP",
    court: text(row.Court) || "Unknown",
    surface: normalizeSurface(row.Surface, row.Court),
    round,
    winner,
    loser,
    winnerRank: numberOrNull(row.WRank),
    loserRank: numberOrNull(row.LRank),
    winnerPoints: numberOrNull(row.WPts),
    loserPoints: numberOrNull(row.LPts),
    winnerSets,
    loserSets,
    odds: preferredOdds(row)
  };
}

async function parseWorkbook(year: number, buffer: ArrayBuffer): Promise<TennisDataCandidate[]> {
  const rows = parseWorkbookRows(buffer);
  const candidates: TennisDataCandidate[] = [];
  rows.forEach((row, index) => {
    const candidate = candidateFromRow(year, index + 2, row);
    if (candidate) candidates.push(candidate);
  });
  return candidates;
}

function tennisCandidatesToFixtures(candidates: TennisDataCandidate[], limit?: number): HistoricalFootballFixtureInput[] {
  const limited = candidates
    .slice()
    .sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime())
    .slice(0, limit && limit > 0 ? Math.min(limit, MAX_MATCHES) : MAX_MATCHES);
  const lastSeenByPlayer = new Map<string, number>();

  return limited.map((candidate) => {
    const winnerHome = stableHashNumber(candidate.fixtureExternalId) % 2 === 0;
    const homeName = winnerHome ? candidate.winner : candidate.loser;
    const awayName = winnerHome ? candidate.loser : candidate.winner;
    const homeRank = winnerHome ? candidate.winnerRank : candidate.loserRank;
    const awayRank = winnerHome ? candidate.loserRank : candidate.winnerRank;
    const homePoints = winnerHome ? candidate.winnerPoints : candidate.loserPoints;
    const awayPoints = winnerHome ? candidate.loserPoints : candidate.winnerPoints;
    const homeSets = winnerHome ? candidate.winnerSets : candidate.loserSets;
    const awaySets = winnerHome ? candidate.loserSets : candidate.winnerSets;
    const homeOdds = candidate.odds ? (winnerHome ? candidate.odds.winner : candidate.odds.loser) : null;
    const awayOdds = candidate.odds ? (winnerHome ? candidate.odds.loser : candidate.odds.winner) : null;
    const kickoffTime = new Date(candidate.kickoffAt).getTime();
    const homePrevious = lastSeenByPlayer.get(homeName);
    const awayPrevious = lastSeenByPlayer.get(awayName);
    const homeRestDays = homePrevious ? Math.max(0, Math.round((kickoffTime - homePrevious) / 86400000)) : null;
    const awayRestDays = awayPrevious ? Math.max(0, Math.round((kickoffTime - awayPrevious) / 86400000)) : null;
    lastSeenByPlayer.set(homeName, kickoffTime);
    lastSeenByPlayer.set(awayName, kickoffTime);

    return {
      sport: "tennis",
      externalId: candidate.fixtureExternalId,
      kickoffAt: candidate.kickoffAt,
      league: {
        externalId: tournamentId(candidate.year, candidate.tournament, candidate.location),
        name: candidate.tournament,
        country: candidate.location,
        strength: candidate.series.toLowerCase().includes("grand slam") ? 0.96 : candidate.series.toLowerCase().includes("masters") ? 0.9 : 0.78,
        metadata: {
          source: "tennis-data-xlsx",
          tour: "ATP",
          series: candidate.series,
          surface: candidate.surface,
          court: candidate.court
        }
      },
      season: String(candidate.year),
      round: candidate.round,
      status: "finished",
      homeTeam: {
        externalId: playerId(homeName),
        name: homeName,
        metadata: { role: "player", source: "tennis-data-xlsx" }
      },
      awayTeam: {
        externalId: playerId(awayName),
        name: awayName,
        metadata: { role: "player", source: "tennis-data-xlsx" }
      },
      homeScore: homeSets,
      awayScore: awaySets,
      neutralVenue: true,
      venue: candidate.tournament,
      country: candidate.location,
      dataQuality: candidate.odds ? 0.8 : 0.68,
      homeFeatures: {
        eloRating: rankToRating(homeRank, homePoints),
        attackStrength: surfaceRating(homeRank, homePoints),
        defenseStrength: surfaceRating(homeRank, homePoints),
        recentFormPoints: homeRank ? roundNumber(Math.max(0, 12 - Math.log(homeRank + 1) * 1.4), 3) : null,
        restDays: homeRestDays,
        metadata: {
          source: "tennis-data-xlsx",
          surface: candidate.surface,
          rank: homeRank,
          rankingPoints: homePoints,
          featureMethod: "rank-points-surface-rest"
        }
      },
      awayFeatures: {
        eloRating: rankToRating(awayRank, awayPoints),
        attackStrength: surfaceRating(awayRank, awayPoints),
        defenseStrength: surfaceRating(awayRank, awayPoints),
        recentFormPoints: awayRank ? roundNumber(Math.max(0, 12 - Math.log(awayRank + 1) * 1.4), 3) : null,
        restDays: awayRestDays,
        metadata: {
          source: "tennis-data-xlsx",
          surface: candidate.surface,
          rank: awayRank,
          rankingPoints: awayPoints,
          featureMethod: "rank-points-surface-rest"
        }
      },
      odds:
        candidate.odds && homeOdds && awayOdds
          ? [
              {
                bookmaker: candidate.odds.bookmaker,
                market: "match_winner",
                selection: "home",
                decimalOdds: homeOdds,
                isClosing: true,
                observedAt: candidate.kickoffAt
              },
              {
                bookmaker: candidate.odds.bookmaker,
                market: "match_winner",
                selection: "away",
                decimalOdds: awayOdds,
                isClosing: true,
                observedAt: candidate.kickoffAt
              }
            ]
          : [],
      metadata: {
        source: "tennis-data-xlsx",
        tour: "ATP",
        sourceYear: candidate.year,
        surface: candidate.surface,
        court: candidate.court,
        series: candidate.series,
        winner: candidate.winner,
        loser: candidate.loser,
        winnerHome
      }
    };
  });
}

function statusFor(ingestion: HistoricalFootballIngestResult | null, failedYears: number): TennisDataXlsxIngestionStatus {
  if (!ingestion) return failedYears > 0 ? "failed" : "invalid-request";
  if (ingestion.status === "stored" && failedYears === 0) return "stored";
  if (ingestion.status === "dry-run" && failedYears === 0) return "dry-run";
  if (ingestion.status === "stored" || ingestion.status === "dry-run") return "partial";
  return "failed";
}

function summaryFor(status: TennisDataXlsxIngestionStatus, matches: number, rowsWritten: number): string {
  if (status === "stored") return `Stored ${rowsWritten} Tennis-Data ATP historical row(s) across ${matches} match(es); training and publishing remain locked.`;
  if (status === "dry-run") return `Prepared ${matches} Tennis-Data ATP match(es) as a dry-run; no rows were written.`;
  if (status === "partial") return `Tennis-Data ingestion partially completed for ${matches} match(es); inspect failed years before expanding.`;
  if (status === "invalid-request") return "Tennis-Data ingestion did not receive a valid year range.";
  return "Tennis-Data ingestion failed before reliable historical rows could be prepared.";
}

function nextActionFor(status: TennisDataXlsxIngestionStatus, dryRun: boolean): TennisDataXlsxIngestion["nextAction"] {
  const verifyUrl = dryRun
    ? "/api/sports/decision/training/tennis-data-xlsx-ingest?yearFrom=2024&yearTo=2024&maxYears=1&dryRun=0"
    : "/api/sports/decision/training/multi-sport-backtest-run?sport=tennis&run=1&minSample=500&limit=5000";
  return {
    label: dryRun ? "Store this Tennis-Data ATP batch" : status === "stored" ? "Run tennis shadow backtest" : "Inspect Tennis-Data ingestion failure",
    command: `${decisionCurlCommand(verifyUrl)}${dryRun ? ' -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"' : ""}`,
    verifyUrl,
    expectedEvidence: dryRun
      ? "Dry-run counts show prepared matches, match-winner odds, feature rows, and zero writes before storage."
      : "Stored tennis rows feed surface/Elo shadow backtests while learned weights and public picks remain locked."
  };
}

export async function buildTennisDataXlsxIngestion({
  yearFrom = DEFAULT_YEAR_FROM,
  yearTo = DEFAULT_YEAR_TO,
  maxYears = DEFAULT_MAX_YEARS,
  offset = 0,
  limit,
  dryRun = true,
  fetchWorkbook = defaultFetchWorkbook,
  ingest = ingestHistoricalFootballFixtures,
  now = new Date()
}: {
  yearFrom?: number;
  yearTo?: number;
  maxYears?: number;
  offset?: number;
  limit?: number;
  dryRun?: boolean;
  fetchWorkbook?: FetchWorkbook;
  ingest?: Ingest;
  now?: Date;
} = {}): Promise<TennisDataXlsxIngestion> {
  const start = Math.max(2000, Math.min(yearFrom, yearTo));
  const end = Math.min(2026, Math.max(yearFrom, yearTo));
  const years = Array.from({ length: end - start + 1 }, (_, index) => start + index).slice(0, Math.max(1, Math.min(maxYears, 10)));

  const yearReceipts: TennisDataXlsxIngestion["years"] = [];
  const allFixtures: HistoricalFootballFixtureInput[] = [];

  for (const year of years) {
    const url = sourceUrl(year);
    try {
      const buffer = await fetchWorkbook(url);
      const candidates = await parseWorkbook(year, buffer);
      const fixtures = tennisCandidatesToFixtures(candidates);
      allFixtures.push(...fixtures);
      yearReceipts.push({
        year,
        sourceUrl: url,
        status: "loaded",
        workbookRows: candidates.length,
        preparedMatches: fixtures.length,
        oddsRows: fixtures.reduce((sum, fixture) => sum + (fixture.odds?.length ?? 0), 0),
        error: null
      });
      if (limit && allFixtures.length >= limit) break;
    } catch (error) {
      yearReceipts.push({
        year,
        sourceUrl: url,
        status: "failed",
        workbookRows: 0,
        preparedMatches: 0,
        oddsRows: 0,
        error: error instanceof Error ? error.message : "Failed to load Tennis-Data workbook."
      });
    }
  }

  const safeOffset = Math.max(0, Math.floor(offset));
  const preparedFixtures = allFixtures.slice(safeOffset, safeOffset + (limit ? Math.min(limit, MAX_MATCHES) : MAX_MATCHES));
  const ingestion = preparedFixtures.length
    ? await ingest({
        sport: "tennis",
        provider: "tennis_data_xlsx",
        sourceKind: "real",
        dryRun,
        fixtures: preparedFixtures
      })
    : null;
  const failedYears = yearReceipts.filter((year) => year.status === "failed").length;
  const status = statusFor(ingestion, failedYears);
  const rowsWritten = ingestion?.rowsWritten ?? 0;

  return {
    mode: "tennis-data-xlsx-ingestion",
    generatedAt: now.toISOString(),
    status,
    summary: summaryFor(status, preparedFixtures.length, rowsWritten),
    provider: {
      name: "Tennis-Data.co.uk",
      providerKey: "tennis_data_xlsx",
      tour: "ATP"
    },
    request: {
      yearFrom: start,
      yearTo: end,
      maxYears,
      offset: safeOffset,
      limit: limit ?? null,
      dryRun
    },
    totals: {
      yearsRequested: years.length,
      yearsLoaded: yearReceipts.filter((year) => year.status === "loaded").length,
      matchesPrepared: preparedFixtures.length,
      oddsRowsPrepared: preparedFixtures.reduce((sum, fixture) => sum + (fixture.odds?.length ?? 0), 0),
      featureSnapshotsPrepared: preparedFixtures.length,
      rowsWritten,
      failedYears
    },
    years: yearReceipts,
    ingestion,
    nextAction: nextActionFor(status, dryRun),
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: true,
      canWriteHistoricalRows: !dryRun && status === "stored",
      canRunBacktestAfterStore: !dryRun && status === "stored",
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Tennis-Data ingestion can add ATP historical matches, odds, and feature snapshots, but cannot train production models.",
      "Stored rows can feed shadow backtests only; learned weights, public picks, and staking stay locked.",
      "Live tennis recommendations still require fresh provider odds, injuries/news where available, tournament context, and promotion governance."
    ],
    proofUrls: [
      "/api/sports/decision/training/tennis-data-xlsx-ingest",
      "/api/sports/decision/training/multi-sport-backtest-run",
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/training/multi-sport-model-governance"
    ]
  };
}
