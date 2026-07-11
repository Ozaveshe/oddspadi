import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import {
  footballDataSeasonCode,
  normalizeFootballDataSeasonRange,
  parseFootballDataCsvFixtureCandidates,
  type FootballDataCsvFixtureCandidate
} from "@/lib/sports/training/footballDataCsvCorpusProbe";
import { runFootballBacktest, type FootballBacktestResult, type HistoricalFootballFixture } from "@/lib/sports/training/footballBacktest";

type FetchCsv = (url: string) => Promise<string>;

export type FootballDataCsvBacktestProbeStatus = "completed" | "partial" | "no-data" | "failed";

export type FootballDataCsvBacktestProbe = {
  mode: "football-data-csv-backtest-probe";
  generatedAt: string;
  status: FootballDataCsvBacktestProbeStatus;
  summary: string;
  provider: {
    name: "Football-Data.co.uk";
    leagueCode: "E0";
    competition: "English Premier League";
  };
  request: {
    seasonFrom: number;
    seasonTo: number;
    maxSeasons: number;
    dryRun: true;
    trainRatio: number;
    minEdge: number;
  };
  corpus: {
    seasonsRequested: number;
    seasonsLoaded: number;
    fixtureCandidates: number;
    oddsCandidates: number;
    normalizedBacktestFixtures: number;
    failedSeasons: Array<{
      season: string;
      sourceUrl: string;
      error: string;
    }>;
  };
  backtest: Pick<
    FootballBacktestResult,
    | "sport"
    | "modelKey"
    | "engineVersion"
    | "status"
    | "sampleSize"
    | "trainSize"
    | "testSize"
    | "pickCount"
    | "windowStart"
    | "windowEnd"
    | "trainWindowStart"
    | "trainWindowEnd"
    | "testWindowStart"
    | "testWindowEnd"
    | "brierScore"
    | "logLoss"
    | "roiUnits"
    | "yield"
    | "averageEdge"
    | "closingLineValue"
    | "calibrationError"
    | "learnedWeights"
    | "config"
    | "notes"
  > & {
    calibrationBuckets: number;
    resultsSample: FootballBacktestResult["results"];
  };
  featureEvidence: {
    rollingForm: true;
    rollingGoalsForAgainst: true;
    restDays: true;
    teamAttackDefenseStrength: true;
    eloUpdatesInsideBacktest: true;
    bookmakerMarginRemovalInsideBacktest: true;
  };
  controls: {
    canInspectReadOnly: true;
    canRunBacktestDryRun: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canPersistBacktestRun: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  locks: string[];
  proofUrls: string[];
};

type TeamState = {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  recent: Array<{ points: number; goalsFor: number; goalsAgainst: number }>;
  lastKickoffAt: string | null;
};

const DEFAULT_TRAIN_RATIO = 0.7;
const DEFAULT_MIN_EDGE = 0.035;

function sourceUrl(seasonStart: number): string {
  return `https://www.football-data.co.uk/mmz4281/${footballDataSeasonCode(seasonStart)}/E0.csv`;
}

function teamId(team: string): string {
  return `football-data:epl:${team.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[], fallback: number | null = null): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : fallback;
}

function emptyState(): TeamState {
  return {
    played: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    points: 0,
    recent: [],
    lastKickoffAt: null
  };
}

function pointsFor(goalsFor: number, goalsAgainst: number): number {
  if (goalsFor > goalsAgainst) return 3;
  if (goalsFor === goalsAgainst) return 1;
  return 0;
}

function restDays(state: TeamState, kickoffAt: string): number | null {
  if (!state.lastKickoffAt) return null;
  const days = (new Date(kickoffAt).getTime() - new Date(state.lastKickoffAt).getTime()) / 86400000;
  return Number.isFinite(days) ? clamp(Math.round(days), 1, 30) : null;
}

function featureState(state: TeamState, leagueGoalRate: number) {
  const goalsForAverage = state.played ? state.goalsFor / state.played : leagueGoalRate;
  const goalsAgainstAverage = state.played ? state.goalsAgainst / state.played : leagueGoalRate;
  return {
    attackStrength: round(clamp(goalsForAverage / leagueGoalRate, 0.55, 1.65), 4),
    defenseStrength: round(clamp(leagueGoalRate / Math.max(goalsAgainstAverage, 0.25), 0.55, 1.65), 4),
    recentFormPoints: round(
      average(
        state.recent.slice(-5).map((item) => item.points),
        1.5
      )! * 5,
      4
    ),
    recentGoalsFor: round(
      average(
        state.recent.slice(-5).map((item) => item.goalsFor),
        goalsForAverage
      ),
      4
    ),
    recentGoalsAgainst: round(
      average(
        state.recent.slice(-5).map((item) => item.goalsAgainst),
        goalsAgainstAverage
      ),
      4
    )
  };
}

function updateState(state: TeamState, goalsFor: number, goalsAgainst: number, kickoffAt: string): void {
  state.played += 1;
  state.goalsFor += goalsFor;
  state.goalsAgainst += goalsAgainst;
  state.points += pointsFor(goalsFor, goalsAgainst);
  state.recent = [...state.recent, { points: pointsFor(goalsFor, goalsAgainst), goalsFor, goalsAgainst }].slice(-8);
  state.lastKickoffAt = kickoffAt;
}

export function footballDataCandidatesToBacktestFixtures(candidates: FootballDataCsvFixtureCandidate[]): HistoricalFootballFixture[] {
  const sorted = candidates.slice().sort((a, b) => new Date(a.kickoffAt).getTime() - new Date(b.kickoffAt).getTime());
  const totalGoals = sorted.reduce((sum, fixture) => sum + fixture.homeGoals + fixture.awayGoals, 0);
  const leagueGoalRate = clamp(totalGoals / Math.max(sorted.length * 2, 1), 0.8, 1.9);
  const states = new Map<string, TeamState>();
  const fixtures: HistoricalFootballFixture[] = [];

  for (const candidate of sorted) {
    const homeId = teamId(candidate.homeTeam);
    const awayId = teamId(candidate.awayTeam);
    const homeState = states.get(homeId) ?? emptyState();
    const awayState = states.get(awayId) ?? emptyState();
    states.set(homeId, homeState);
    states.set(awayId, awayState);
    const homeFeatures = featureState(homeState, leagueGoalRate);
    const awayFeatures = featureState(awayState, leagueGoalRate);
    const observedAt = `${candidate.kickoffAt}T00:00:00.000Z`;

    fixtures.push({
      fixtureExternalId: candidate.fixtureExternalId,
      kickoffAt: observedAt,
      leagueExternalId: "football-data:epl",
      season: candidate.seasonLabel,
      homeTeamExternalId: homeId,
      awayTeamExternalId: awayId,
      homeScore: candidate.homeGoals,
      awayScore: candidate.awayGoals,
      neutralVenue: false,
      dataQuality: candidate.odds ? 0.74 : 0.64,
      homeAttackStrength: homeFeatures.attackStrength,
      awayAttackStrength: awayFeatures.attackStrength,
      homeDefenseStrength: homeFeatures.defenseStrength,
      awayDefenseStrength: awayFeatures.defenseStrength,
      homeRecentFormPoints: homeFeatures.recentFormPoints,
      awayRecentFormPoints: awayFeatures.recentFormPoints,
      homeRecentGoalsFor: homeFeatures.recentGoalsFor,
      awayRecentGoalsFor: awayFeatures.recentGoalsFor,
      homeRecentGoalsAgainst: homeFeatures.recentGoalsAgainst,
      awayRecentGoalsAgainst: awayFeatures.recentGoalsAgainst,
      homeRestDays: restDays(homeState, candidate.kickoffAt),
      awayRestDays: restDays(awayState, candidate.kickoffAt),
      homeInjuriesCount: null,
      awayInjuriesCount: null,
      homeSuspensionsCount: null,
      awaySuspensionsCount: null,
      odds: candidate.odds
        ? [
            {
              market: "match_winner",
              selection: "home",
              decimalOdds: candidate.odds.home,
              isClosing: true,
              bookmaker: candidate.odds.bookmaker,
              observedAt
            },
            {
              market: "match_winner",
              selection: "draw",
              decimalOdds: candidate.odds.draw,
              isClosing: true,
              bookmaker: candidate.odds.bookmaker,
              observedAt
            },
            {
              market: "match_winner",
              selection: "away",
              decimalOdds: candidate.odds.away,
              isClosing: true,
              bookmaker: candidate.odds.bookmaker,
              observedAt
            }
          ]
        : []
    });

    updateState(homeState, candidate.homeGoals, candidate.awayGoals, candidate.kickoffAt);
    updateState(awayState, candidate.awayGoals, candidate.homeGoals, candidate.kickoffAt);
  }

  return fixtures;
}

async function defaultFetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function controls(canRunBacktestDryRun: boolean): FootballDataCsvBacktestProbe["controls"] {
  return {
    canInspectReadOnly: true,
    canRunBacktestDryRun,
    canWriteProviderRows: false,
    canPersistTrainingRows: false,
    canPersistBacktestRun: false,
    canApplyLearnedWeights: false,
    canPublishPicks: false,
    canStake: false
  };
}

function nextAction(seasonFrom: number, seasonTo: number, maxSeasons: number, trainRatio: number, minEdge: number) {
  const verifyUrl = `/api/sports/decision/training/football-data-backtest-probe?seasonFrom=${seasonFrom}&seasonTo=${seasonTo}&maxSeasons=${maxSeasons}&trainRatio=${trainRatio}&minEdge=${minEdge}&dryRun=1`;
  return {
    label: "Run public EPL Poisson/Elo backtest dry-run",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence: "Read-only Poisson/Elo/odds-edge backtest on public EPL historical CSV candidates with train/test split, Brier score, log loss, ROI, calibration, and locked learned weights."
  };
}

function proofUrls(): string[] {
  return [
    "/api/sports/decision/training/football-data-backtest-probe",
    "/api/sports/decision/training/football-data-csv-probe",
    "/api/sports/decision/training/historical-corpus-acquisition",
    "/api/sports/decision/training/ten-year-corpus-execution"
  ];
}

export async function buildFootballDataCsvBacktestProbe({
  seasonFrom,
  seasonTo,
  maxSeasons,
  trainRatio = DEFAULT_TRAIN_RATIO,
  minEdge = DEFAULT_MIN_EDGE,
  fetchCsv = defaultFetchCsv,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  trainRatio?: number;
  minEdge?: number;
  fetchCsv?: FetchCsv;
  now?: Date;
} = {}): Promise<FootballDataCsvBacktestProbe> {
  const range = normalizeFootballDataSeasonRange({ seasonFrom, seasonTo, maxSeasons });
  const safeTrainRatio = clamp(trainRatio, 0.1, 0.9);
  const safeMinEdge = clamp(minEdge, 0, 0.2);
  const failedSeasons: FootballDataCsvBacktestProbe["corpus"]["failedSeasons"] = [];
  const candidates: FootballDataCsvFixtureCandidate[] = [];

  for (const seasonStart of range.starts) {
    const url = sourceUrl(seasonStart);
    try {
      candidates.push(...parseFootballDataCsvFixtureCandidates(seasonStart, await fetchCsv(url)));
    } catch (error) {
      failedSeasons.push({
        season: `${seasonStart}/${String((seasonStart + 1) % 100).padStart(2, "0")}`,
        sourceUrl: url,
        error: error instanceof Error ? error.message : "Failed to load CSV."
      });
    }
  }

  const fixtures = footballDataCandidatesToBacktestFixtures(candidates);
  const backtest = runFootballBacktest(fixtures, { trainRatio: safeTrainRatio, minEdge: safeMinEdge });
  const status: FootballDataCsvBacktestProbeStatus =
    backtest.status === "completed" ? (failedSeasons.length ? "partial" : "completed") : failedSeasons.length ? "failed" : "no-data";
  const action = nextAction(range.seasonFrom, range.seasonTo, range.maxSeasons, safeTrainRatio, safeMinEdge);

  return {
    mode: "football-data-csv-backtest-probe",
    generatedAt: now.toISOString(),
    status,
    summary:
      status === "completed" || status === "partial"
        ? `Ran a read-only ${backtest.modelKey} backtest over ${backtest.sampleSize} EPL fixture(s), with ${backtest.testSize} holdout fixture(s) and ${backtest.pickCount} value pick(s).`
        : status === "no-data"
          ? "No public EPL CSV rows were available for a backtest dry-run."
          : "Public EPL CSV backtest probe failed before producing model evidence.",
    provider: {
      name: "Football-Data.co.uk",
      leagueCode: "E0",
      competition: "English Premier League"
    },
    request: {
      seasonFrom: range.seasonFrom,
      seasonTo: range.seasonTo,
      maxSeasons: range.maxSeasons,
      dryRun: true,
      trainRatio: safeTrainRatio,
      minEdge: safeMinEdge
    },
    corpus: {
      seasonsRequested: range.starts.length,
      seasonsLoaded: range.starts.length - failedSeasons.length,
      fixtureCandidates: candidates.length,
      oddsCandidates: candidates.filter((fixture) => fixture.odds).length,
      normalizedBacktestFixtures: fixtures.length,
      failedSeasons
    },
    backtest: {
      sport: backtest.sport,
      modelKey: backtest.modelKey,
      engineVersion: backtest.engineVersion,
      status: backtest.status,
      sampleSize: backtest.sampleSize,
      trainSize: backtest.trainSize,
      testSize: backtest.testSize,
      pickCount: backtest.pickCount,
      windowStart: backtest.windowStart,
      windowEnd: backtest.windowEnd,
      trainWindowStart: backtest.trainWindowStart,
      trainWindowEnd: backtest.trainWindowEnd,
      testWindowStart: backtest.testWindowStart,
      testWindowEnd: backtest.testWindowEnd,
      brierScore: backtest.brierScore,
      logLoss: backtest.logLoss,
      roiUnits: backtest.roiUnits,
      yield: backtest.yield,
      averageEdge: backtest.averageEdge,
      closingLineValue: backtest.closingLineValue,
      calibrationError: backtest.calibrationError,
      calibrationBuckets: backtest.calibrationBuckets.length,
      learnedWeights: backtest.learnedWeights,
      config: backtest.config,
      notes: backtest.notes,
      resultsSample: backtest.results.slice(0, 12)
    },
    featureEvidence: {
      rollingForm: true,
      rollingGoalsForAgainst: true,
      restDays: true,
      teamAttackDefenseStrength: true,
      eloUpdatesInsideBacktest: true,
      bookmakerMarginRemovalInsideBacktest: true
    },
    controls: controls(backtest.status === "completed"),
    nextAction: action,
    locks: [
      "This backtest probe is read-only and does not persist op_backtest_runs or op_training_feature_snapshots.",
      "Learned weights from public CSV evidence are shadow candidates only and cannot affect public predictions.",
      "Paid provider enrichment remains required for injuries, suspensions, lineups, news, weather, live events, and official fixture IDs."
    ],
    proofUrls: proofUrls()
  };
}

export const FOOTBALL_DATA_BACKTEST_PROBE_DEFAULT_VERIFY_URL =
  "/api/sports/decision/training/football-data-backtest-probe?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minEdge=0.035&dryRun=1";

export const FOOTBALL_DATA_BACKTEST_PROBE_DEFAULT_COMMAND = decisionCurlCommand(FOOTBALL_DATA_BACKTEST_PROBE_DEFAULT_VERIFY_URL);
