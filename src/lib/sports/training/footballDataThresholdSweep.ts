import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import {
  footballDataSeasonCode,
  normalizeFootballDataSeasonRange,
  parseFootballDataCsvFixtureCandidates,
  type FootballDataCsvFixtureCandidate
} from "@/lib/sports/training/footballDataCsvCorpusProbe";
import { footballDataCandidatesToBacktestFixtures } from "@/lib/sports/training/footballDataCsvBacktestProbe";
import { runFootballBacktest, type FootballBacktestResult } from "@/lib/sports/training/footballBacktest";

type FetchCsv = (url: string) => Promise<string>;

export type FootballDataThresholdSweepStatus = "completed" | "no-data" | "failed";

export type FootballDataThresholdProfile = {
  rank: number;
  minEdge: number;
  minModelProbability: number;
  pickCount: number;
  sampleSize: number;
  testSize: number;
  brierScore: number | null;
  logLoss: number | null;
  roiUnits: number;
  yield: number | null;
  averageEdge: number | null;
  calibrationError: number | null;
  learnedMinimumEdge: number;
  score: number;
  status: "candidate" | "thin-sample" | "negative-yield" | "weak-calibration";
  notes: string[];
};

export type FootballDataThresholdSweep = {
  mode: "football-data-threshold-sweep";
  generatedAt: string;
  status: FootballDataThresholdSweepStatus;
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
    minPickCount: number;
    profilesTested: number;
  };
  corpus: {
    seasonsRequested: number;
    seasonsLoaded: number;
    fixtureCandidates: number;
    oddsCandidates: number;
    backtestFixtures: number;
    failedSeasons: Array<{
      season: string;
      sourceUrl: string;
      error: string;
    }>;
  };
  baseline: FootballDataThresholdProfile | null;
  bestProfile: FootballDataThresholdProfile | null;
  profiles: FootballDataThresholdProfile[];
  recommendation: {
    action: "raise-thresholds" | "keep-defaults" | "collect-more-data";
    summary: string;
    minEdge: number | null;
    minModelProbability: number | null;
    evidence: string[];
    risks: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canRunThresholdSweep: boolean;
    canPersistBacktestRun: false;
    canPersistLearnedThresholds: false;
    canApplyLearnedThresholds: false;
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

const DEFAULT_TRAIN_RATIO = 0.7;
const DEFAULT_MIN_PICK_COUNT = 75;
const EDGE_GRID = [0.02, 0.03, 0.035, 0.045, 0.055, 0.07, 0.09, 0.12];
const PROBABILITY_GRID = [0.32, 0.36, 0.4, 0.45, 0.5, 0.56];
const BASELINE_EDGE = 0.035;
const BASELINE_MIN_PROBABILITY = 0.32;

function sourceUrl(seasonStart: number): string {
  return `https://www.football-data.co.uk/mmz4281/${footballDataSeasonCode(seasonStart)}/E0.csv`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

async function defaultFetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function profileStatus(result: FootballBacktestResult, minPickCount: number): FootballDataThresholdProfile["status"] {
  if (result.pickCount < minPickCount) return "thin-sample";
  if ((result.calibrationError ?? 1) > 0.14) return "weak-calibration";
  if ((result.yield ?? -1) < 0) return "negative-yield";
  return "candidate";
}

function scoreResult(result: FootballBacktestResult, minPickCount: number): number {
  const yieldValue = result.yield ?? -0.25;
  const pickCoverage = Math.min(result.pickCount / Math.max(minPickCount, 1), 2) * 0.08;
  const brierBonus = result.brierScore === null ? -0.04 : clamp(0.23 - result.brierScore, -0.06, 0.08);
  const calibrationBonus = result.calibrationError === null ? -0.05 : clamp(0.12 - result.calibrationError, -0.08, 0.08);
  const thinPenalty = result.pickCount < minPickCount ? 0.2 : 0;
  return round(yieldValue + pickCoverage + brierBonus + calibrationBonus - thinPenalty, 6) ?? 0;
}

function notesFor(result: FootballBacktestResult, minPickCount: number): string[] {
  return [
    result.pickCount < minPickCount ? `Only ${result.pickCount}/${minPickCount} picks cleared this profile.` : "",
    result.yield !== null && result.yield < 0 ? "Yield is negative on the holdout window." : "",
    result.calibrationError !== null && result.calibrationError > 0.14 ? "Calibration error is too high for learned thresholds." : "",
    result.closingLineValue === null ? "Closing-line value is not independently available from public CSV closing odds." : ""
  ].filter(Boolean);
}

function toProfile({
  result,
  minEdge,
  minModelProbability,
  minPickCount
}: {
  result: FootballBacktestResult;
  minEdge: number;
  minModelProbability: number;
  minPickCount: number;
}): Omit<FootballDataThresholdProfile, "rank"> {
  return {
    minEdge,
    minModelProbability,
    pickCount: result.pickCount,
    sampleSize: result.sampleSize,
    testSize: result.testSize,
    brierScore: result.brierScore,
    logLoss: result.logLoss,
    roiUnits: result.roiUnits,
    yield: result.yield,
    averageEdge: result.averageEdge,
    calibrationError: result.calibrationError,
    learnedMinimumEdge: result.learnedWeights.minimumEdge,
    score: scoreResult(result, minPickCount),
    status: profileStatus(result, minPickCount),
    notes: notesFor(result, minPickCount)
  };
}

function recommend({
  baseline,
  bestProfile,
  minPickCount
}: {
  baseline: FootballDataThresholdProfile | null;
  bestProfile: FootballDataThresholdProfile | null;
  minPickCount: number;
}): FootballDataThresholdSweep["recommendation"] {
  if (!bestProfile || !baseline) {
    return {
      action: "collect-more-data",
      summary: "No threshold profile produced enough holdout evidence.",
      minEdge: null,
      minModelProbability: null,
      evidence: [],
      risks: ["Public predictions stay locked because no validated threshold candidate exists."]
    };
  }
  const improvesYield = (bestProfile.yield ?? -1) > (baseline.yield ?? -1);
  const candidateIsUsable = bestProfile.status === "candidate";
  const action = candidateIsUsable && improvesYield ? "raise-thresholds" : baseline.status === "candidate" ? "keep-defaults" : "collect-more-data";
  return {
    action,
    summary:
      action === "raise-thresholds"
        ? `Shadow recommendation: require edge >= ${bestProfile.minEdge} and model probability >= ${bestProfile.minModelProbability} before a football value pick can pass.`
        : action === "keep-defaults"
          ? "Default thresholds remain the least risky shadow profile in this sweep."
          : "Threshold evidence is not strong enough for promotion; keep collecting and enriching the corpus.",
    minEdge: action === "raise-thresholds" ? bestProfile.minEdge : null,
    minModelProbability: action === "raise-thresholds" ? bestProfile.minModelProbability : null,
    evidence: [
      `Best profile yield ${bestProfile.yield ?? "n/a"} vs baseline ${baseline.yield ?? "n/a"}.`,
      `Best profile picks ${bestProfile.pickCount}/${bestProfile.testSize}; minimum useful picks ${minPickCount}.`,
      `Best profile Brier ${bestProfile.brierScore ?? "n/a"} and calibration ${bestProfile.calibrationError ?? "n/a"}.`
    ],
    risks: [
      "This is read-only public CSV evidence, not a stored production backtest.",
      "CSV odds are treated as closing prices, so independent CLV proof is unavailable.",
      "Provider enrichment for injuries, lineups, news, weather, and live events is still missing."
    ]
  };
}

function nextAction(seasonFrom: number, seasonTo: number, maxSeasons: number, trainRatio: number, minPickCount: number) {
  const verifyUrl = `/api/sports/decision/training/football-data-threshold-sweep?seasonFrom=${seasonFrom}&seasonTo=${seasonTo}&maxSeasons=${maxSeasons}&trainRatio=${trainRatio}&minPickCount=${minPickCount}&dryRun=1`;
  return {
    label: "Run public EPL learned-threshold sweep",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence: "Read-only threshold grid over EPL Poisson/Elo/odds-edge backtests with baseline comparison, ranked profiles, and shadow-only recommendation."
  };
}

export async function buildFootballDataThresholdSweep({
  seasonFrom,
  seasonTo,
  maxSeasons,
  trainRatio = DEFAULT_TRAIN_RATIO,
  minPickCount = DEFAULT_MIN_PICK_COUNT,
  fetchCsv = defaultFetchCsv,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  trainRatio?: number;
  minPickCount?: number;
  fetchCsv?: FetchCsv;
  now?: Date;
} = {}): Promise<FootballDataThresholdSweep> {
  const range = normalizeFootballDataSeasonRange({ seasonFrom, seasonTo, maxSeasons });
  const safeTrainRatio = clamp(trainRatio, 0.1, 0.9);
  const safeMinPickCount = Math.max(10, Math.min(500, Math.round(minPickCount)));
  const failedSeasons: FootballDataThresholdSweep["corpus"]["failedSeasons"] = [];
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
  if (!fixtures.length) {
    const action = nextAction(range.seasonFrom, range.seasonTo, range.maxSeasons, safeTrainRatio, safeMinPickCount);
    return {
      mode: "football-data-threshold-sweep",
      generatedAt: now.toISOString(),
      status: failedSeasons.length ? "failed" : "no-data",
      summary: "No EPL backtest fixtures were available for threshold sweeping.",
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
        minPickCount: safeMinPickCount,
        profilesTested: 0
      },
      corpus: {
        seasonsRequested: range.starts.length,
        seasonsLoaded: range.starts.length - failedSeasons.length,
        fixtureCandidates: 0,
        oddsCandidates: 0,
        backtestFixtures: 0,
        failedSeasons
      },
      baseline: null,
      bestProfile: null,
      profiles: [],
      recommendation: recommend({ baseline: null, bestProfile: null, minPickCount: safeMinPickCount }),
      controls: readOnlyControls(false),
      nextAction: action,
      locks: sweepLocks(),
      proofUrls: sweepProofUrls()
    };
  }

  const rawProfiles = EDGE_GRID.flatMap((minEdge) =>
    PROBABILITY_GRID.map((minModelProbability) => {
      const result = runFootballBacktest(fixtures, {
        trainRatio: safeTrainRatio,
        minEdge,
        minModelProbability
      });
      return toProfile({ result, minEdge, minModelProbability, minPickCount: safeMinPickCount });
    })
  );
  const ranked = rawProfiles
    .sort((a, b) => b.score - a.score || (b.yield ?? -1) - (a.yield ?? -1) || b.pickCount - a.pickCount)
    .map((profile, index): FootballDataThresholdProfile => ({ ...profile, rank: index + 1 }));
  const baseline =
    ranked.find((profile) => profile.minEdge === BASELINE_EDGE && profile.minModelProbability === BASELINE_MIN_PROBABILITY) ??
    null;
  const bestProfile = ranked[0] ?? null;
  const recommendation = recommend({ baseline, bestProfile, minPickCount: safeMinPickCount });
  const action = nextAction(range.seasonFrom, range.seasonTo, range.maxSeasons, safeTrainRatio, safeMinPickCount);

  return {
    mode: "football-data-threshold-sweep",
    generatedAt: now.toISOString(),
    status: "completed",
    summary: `Swept ${ranked.length} public EPL threshold profile(s); best status ${bestProfile?.status ?? "n/a"} with yield ${bestProfile?.yield ?? "n/a"}.`,
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
      minPickCount: safeMinPickCount,
      profilesTested: ranked.length
    },
    corpus: {
      seasonsRequested: range.starts.length,
      seasonsLoaded: range.starts.length - failedSeasons.length,
      fixtureCandidates: candidates.length,
      oddsCandidates: candidates.filter((fixture) => fixture.odds).length,
      backtestFixtures: fixtures.length,
      failedSeasons
    },
    baseline,
    bestProfile,
    profiles: ranked.slice(0, 12),
    recommendation,
    controls: readOnlyControls(true),
    nextAction: action,
    locks: sweepLocks(),
    proofUrls: sweepProofUrls()
  };
}

function readOnlyControls(canRunThresholdSweep: boolean): FootballDataThresholdSweep["controls"] {
  return {
    canInspectReadOnly: true,
    canRunThresholdSweep,
    canPersistBacktestRun: false,
    canPersistLearnedThresholds: false,
    canApplyLearnedThresholds: false,
    canPublishPicks: false,
    canStake: false
  };
}

function sweepLocks(): string[] {
  return [
    "Threshold sweep output is shadow-only and cannot alter live prediction thresholds.",
    "Persisted op_backtest_runs and operator promotion approval are required before learned thresholds can be used.",
    "Negative or thin-sample profiles must downgrade confidence, not force public picks."
  ];
}

function sweepProofUrls(): string[] {
  return [
    "/api/sports/decision/training/football-data-threshold-sweep",
    "/api/sports/decision/training/football-data-backtest-probe",
    "/api/sports/decision/training/football-data-csv-probe",
    "/api/sports/decision/training/historical-corpus-acquisition"
  ];
}

export const FOOTBALL_DATA_THRESHOLD_SWEEP_DEFAULT_VERIFY_URL =
  "/api/sports/decision/training/football-data-threshold-sweep?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minPickCount=75&dryRun=1";

export const FOOTBALL_DATA_THRESHOLD_SWEEP_DEFAULT_COMMAND = decisionCurlCommand(FOOTBALL_DATA_THRESHOLD_SWEEP_DEFAULT_VERIFY_URL);
