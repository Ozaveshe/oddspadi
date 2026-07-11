import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import {
  footballDataSeasonCode,
  normalizeFootballDataSeasonRange,
  parseFootballDataCsvFixtureCandidates,
  type FootballDataCsvFixtureCandidate
} from "@/lib/sports/training/footballDataCsvCorpusProbe";
import { footballDataCandidatesToBacktestFixtures } from "@/lib/sports/training/footballDataCsvBacktestProbe";
import {
  ingestHistoricalFootballFixtures,
  type HistoricalFootballFixtureInput,
  type HistoricalFootballIngestResult
} from "@/lib/sports/training/historicalIngestion";

type FetchCsv = (url: string) => Promise<string>;
type Ingest = typeof ingestHistoricalFootballFixtures;

export type FootballDataCsvIngestionStatus = "stored" | "dry-run" | "partial" | "failed" | "invalid-request";

export type FootballDataCsvIngestion = {
  mode: "football-data-csv-ingestion";
  generatedAt: string;
  status: FootballDataCsvIngestionStatus;
  summary: string;
  provider: {
    name: "Football-Data.co.uk";
    providerKey: "football_data_csv";
    leagueCode: "E0";
    competition: "English Premier League";
  };
  request: {
    seasonFrom: number;
    seasonTo: number;
    maxSeasons: number;
    limit: number | null;
    dryRun: boolean;
  };
  totals: {
    seasonsRequested: number;
    seasonsLoaded: number;
    fixturesPrepared: number;
    oddsRowsPrepared: number;
    featureSnapshotsPrepared: number;
    rowsWritten: number;
    failedSeasons: number;
  };
  seasons: Array<{
    seasonStart: number;
    seasonCode: string;
    sourceUrl: string;
    status: "loaded" | "failed";
    fixtureCandidates: number;
    preparedFixtures: number;
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

const DEFAULT_SEASON_FROM = 2024;
const DEFAULT_SEASON_TO = 2024;
const DEFAULT_MAX_SEASONS = 1;
const MAX_FIXTURES = 5000;

function sourceUrl(seasonStart: number): string {
  return `https://www.football-data.co.uk/mmz4281/${footballDataSeasonCode(seasonStart)}/E0.csv`;
}

async function defaultFetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function stableHashText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function teamId(team: string): string {
  return `football-data:epl:${stableHashText(team)}`;
}

function round(value: number | null | undefined, digits = 6): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toIsoKickoff(date: string): string {
  return new Date(`${date}T15:00:00.000Z`).toISOString();
}

function toIngestFixtures(candidates: FootballDataCsvFixtureCandidate[], limit?: number): HistoricalFootballFixtureInput[] {
  const limited = candidates.slice(0, limit && limit > 0 ? Math.min(limit, MAX_FIXTURES) : MAX_FIXTURES);
  const modelFixtures = footballDataCandidatesToBacktestFixtures(limited);
  const byId = new Map(modelFixtures.map((fixture) => [fixture.fixtureExternalId, fixture]));

  return limited.flatMap((candidate) => {
    const model = byId.get(candidate.fixtureExternalId);
    if (!model) return [];
    const observedAt = toIsoKickoff(candidate.kickoffAt);
    return [
      {
        sport: "football",
        externalId: candidate.fixtureExternalId,
        kickoffAt: model.kickoffAt,
        league: {
          externalId: "football-data:epl",
          name: "English Premier League",
          country: "England",
          strength: 0.92,
          metadata: {
            source: "football-data-csv",
            seasonCode: candidate.seasonCode
          }
        },
        season: candidate.seasonLabel,
        round: null,
        status: "finished",
        homeTeam: {
          externalId: teamId(candidate.homeTeam),
          name: candidate.homeTeam,
          country: "England"
        },
        awayTeam: {
          externalId: teamId(candidate.awayTeam),
          name: candidate.awayTeam,
          country: "England"
        },
        homeScore: candidate.homeGoals,
        awayScore: candidate.awayGoals,
        neutralVenue: false,
        country: "England",
        dataQuality: model.dataQuality ?? (candidate.odds ? 0.74 : 0.64),
        homeFeatures: {
          attackStrength: round(model.homeAttackStrength),
          defenseStrength: round(model.homeDefenseStrength),
          recentFormPoints: round(model.homeRecentFormPoints),
          recentGoalsFor: round(model.homeRecentGoalsFor),
          recentGoalsAgainst: round(model.homeRecentGoalsAgainst),
          restDays: round(model.homeRestDays),
          injuriesCount: null,
          suspensionsCount: null,
          lineupConfirmed: false,
          metadata: {
            source: "football-data-csv",
            featureMethod: "rolling-form-goals-rest"
          }
        },
        awayFeatures: {
          attackStrength: round(model.awayAttackStrength),
          defenseStrength: round(model.awayDefenseStrength),
          recentFormPoints: round(model.awayRecentFormPoints),
          recentGoalsFor: round(model.awayRecentGoalsFor),
          recentGoalsAgainst: round(model.awayRecentGoalsAgainst),
          restDays: round(model.awayRestDays),
          injuriesCount: null,
          suspensionsCount: null,
          lineupConfirmed: false,
          metadata: {
            source: "football-data-csv",
            featureMethod: "rolling-form-goals-rest"
          }
        },
        odds: candidate.odds
          ? [
              {
                bookmaker: candidate.odds.bookmaker,
                market: "match_winner",
                selection: "home",
                decimalOdds: candidate.odds.home,
                isClosing: true,
                observedAt
              },
              {
                bookmaker: candidate.odds.bookmaker,
                market: "match_winner",
                selection: "draw",
                decimalOdds: candidate.odds.draw,
                isClosing: true,
                observedAt
              },
              {
                bookmaker: candidate.odds.bookmaker,
                market: "match_winner",
                selection: "away",
                decimalOdds: candidate.odds.away,
                isClosing: true,
                observedAt
              }
            ]
          : [],
        metadata: {
          source: "football-data-csv",
          sourceSeasonStart: candidate.seasonStart,
          sourceSeasonCode: candidate.seasonCode,
          sourceResult: candidate.result
        }
      }
    ];
  });
}

function statusFor(ingestion: HistoricalFootballIngestResult | null, failedSeasons: number): FootballDataCsvIngestionStatus {
  if (!ingestion) return failedSeasons > 0 ? "failed" : "invalid-request";
  if (ingestion.status === "stored" && failedSeasons === 0) return "stored";
  if (ingestion.status === "dry-run" && failedSeasons === 0) return "dry-run";
  if (ingestion.status === "stored" || ingestion.status === "dry-run") return "partial";
  return "failed";
}

function summaryFor(status: FootballDataCsvIngestionStatus, fixtures: number, rowsWritten: number): string {
  if (status === "stored") return `Stored ${rowsWritten} Football-Data EPL historical row(s) across ${fixtures} fixture(s); training and publishing remain locked.`;
  if (status === "dry-run") return `Prepared ${fixtures} Football-Data EPL fixture(s) as a dry-run; no rows were written.`;
  if (status === "partial") return `Football-Data ingestion partially completed for ${fixtures} fixture(s); inspect failed seasons before expanding.`;
  if (status === "invalid-request") return "Football-Data ingestion did not receive a valid season range.";
  return "Football-Data ingestion failed before reliable historical rows could be prepared.";
}

function nextActionFor(status: FootballDataCsvIngestionStatus, dryRun: boolean): FootballDataCsvIngestion["nextAction"] {
  const verifyUrl = dryRun
    ? "/api/sports/decision/training/football-data-csv-ingest?seasonFrom=2024&seasonTo=2024&maxSeasons=1&dryRun=0"
    : "/api/sports/decision/training/multi-sport-backtest-run?sport=football&run=1&minSample=30&limit=5000";
  return {
    label: dryRun ? "Store this public-history batch" : "Run real-row shadow backtest",
    command: `${decisionCurlCommand(verifyUrl)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
    verifyUrl,
    expectedEvidence:
      status === "stored"
        ? "Training snapshot shows real finished fixtures and real odds from football_data_csv, then backtest evidence stays shadow-only."
        : "Dry-run counts show prepared fixtures, odds rows, feature rows, and zero writes before storage."
  };
}

export async function buildFootballDataCsvIngestion({
  seasonFrom = DEFAULT_SEASON_FROM,
  seasonTo = DEFAULT_SEASON_TO,
  maxSeasons = DEFAULT_MAX_SEASONS,
  limit,
  dryRun = true,
  fetchCsv = defaultFetchCsv,
  ingest = ingestHistoricalFootballFixtures,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  limit?: number;
  dryRun?: boolean;
  fetchCsv?: FetchCsv;
  ingest?: Ingest;
  now?: Date;
} = {}): Promise<FootballDataCsvIngestion> {
  const range = normalizeFootballDataSeasonRange({ seasonFrom, seasonTo, maxSeasons });
  const seasons: FootballDataCsvIngestion["seasons"] = [];
  const allCandidates: FootballDataCsvFixtureCandidate[] = [];

  for (const seasonStart of range.starts) {
    const url = sourceUrl(seasonStart);
    try {
      const text = await fetchCsv(url);
      const candidates = parseFootballDataCsvFixtureCandidates(seasonStart, text);
      allCandidates.push(...candidates);
      seasons.push({
        seasonStart,
        seasonCode: footballDataSeasonCode(seasonStart),
        sourceUrl: url,
        status: "loaded",
        fixtureCandidates: candidates.length,
        preparedFixtures: candidates.length,
        oddsRows: candidates.filter((candidate) => candidate.odds).length * 3,
        error: null
      });
    } catch (error) {
      seasons.push({
        seasonStart,
        seasonCode: footballDataSeasonCode(seasonStart),
        sourceUrl: url,
        status: "failed",
        fixtureCandidates: 0,
        preparedFixtures: 0,
        oddsRows: 0,
        error: error instanceof Error ? error.message : "Failed to fetch Football-Data CSV."
      });
    }
  }

  const fixtures = toIngestFixtures(allCandidates, limit);
  const ingestion = fixtures.length
    ? await ingest({
        sport: "football",
        provider: "football_data_csv",
        sourceKind: "real",
        dryRun,
        fixtures
      })
    : null;
  const status = statusFor(ingestion, seasons.filter((season) => season.status === "failed").length);
  const oddsRows = fixtures.reduce((sum, fixture) => sum + (fixture.odds?.length ?? 0), 0);

  return {
    mode: "football-data-csv-ingestion",
    generatedAt: now.toISOString(),
    status,
    summary: summaryFor(status, fixtures.length, ingestion?.rowsWritten ?? 0),
    provider: {
      name: "Football-Data.co.uk",
      providerKey: "football_data_csv",
      leagueCode: "E0",
      competition: "English Premier League"
    },
    request: {
      seasonFrom: range.seasonFrom,
      seasonTo: range.seasonTo,
      maxSeasons: range.maxSeasons,
      limit: limit ?? null,
      dryRun
    },
    totals: {
      seasonsRequested: range.starts.length,
      seasonsLoaded: seasons.filter((season) => season.status === "loaded").length,
      fixturesPrepared: fixtures.length,
      oddsRowsPrepared: oddsRows,
      featureSnapshotsPrepared: fixtures.length,
      rowsWritten: ingestion?.rowsWritten ?? 0,
      failedSeasons: seasons.filter((season) => season.status === "failed").length
    },
    seasons,
    ingestion,
    nextAction: nextActionFor(status, dryRun),
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: true,
      canWriteHistoricalRows: !dryRun,
      canRunBacktestAfterStore: status === "stored",
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Football-Data CSV ingestion can add public historical fixtures, odds, and feature snapshots, but cannot train production models.",
      "Public CSV rows are real historical evidence, but provider-enriched API rows remain required for injuries, lineups, weather, news, and live promotion.",
      "Stored rows can feed shadow backtests only; learned weights, public picks, and staking stay locked."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-data-csv-ingest",
      "/api/sports/decision/training/football-data-csv-probe",
      "/api/sports/decision/training/multi-sport-backtest-run",
      "/api/sports/decision/training/supabase-training-corpus-census"
    ]
  };
}
