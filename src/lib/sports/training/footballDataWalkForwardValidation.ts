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

export type FootballDataWalkForwardStatus = "completed" | "no-data" | "failed";

export type FootballDataWalkForwardFold = {
  seasonStart: number;
  seasonLabel: string;
  trainSeasons: number;
  trainFixtures: number;
  testFixtures: number;
  pickCount: number;
  brierScore: number | null;
  logLoss: number | null;
  roiUnits: number;
  yield: number | null;
  calibrationError: number | null;
  status: "pass" | "watch" | "fail";
  notes: string[];
};

export type FootballDataWalkForwardValidation = {
  mode: "football-data-walk-forward-validation";
  generatedAt: string;
  status: FootballDataWalkForwardStatus;
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
    minTrainingSeasons: number;
    minEdge: number;
    minModelProbability: number;
  };
  corpus: {
    seasonsRequested: number;
    seasonsLoaded: number;
    fixtureCandidates: number;
    oddsCandidates: number;
    failedSeasons: Array<{
      season: string;
      sourceUrl: string;
      error: string;
    }>;
  };
  validation: {
    folds: number;
    passFolds: number;
    watchFolds: number;
    failFolds: number;
    totalTestFixtures: number;
    totalPicks: number;
    aggregateRoiUnits: number;
    aggregateYield: number | null;
    averageBrier: number | null;
    averageLogLoss: number | null;
    averageCalibrationError: number | null;
    stabilityScore: number;
  };
  folds: FootballDataWalkForwardFold[];
  recommendation: {
    action: "keep-shadow-locked" | "eligible-for-provider-enriched-retest" | "collect-more-data";
    summary: string;
    evidence: string[];
    risks: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canRunWalkForwardValidation: boolean;
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

const DEFAULT_MIN_TRAINING_SEASONS = 3;
const DEFAULT_MIN_EDGE = 0.02;
const DEFAULT_MIN_MODEL_PROBABILITY = 0.36;

function sourceUrl(seasonStart: number): string {
  return `https://www.football-data.co.uk/mmz4281/${footballDataSeasonCode(seasonStart)}/E0.csv`;
}

function seasonLabel(seasonStart: number): string {
  return `${seasonStart}/${String((seasonStart + 1) % 100).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

async function defaultFetchCsv(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function foldStatus(result: FootballBacktestResult): FootballDataWalkForwardFold["status"] {
  if (result.pickCount < 20) return "watch";
  if ((result.yield ?? -1) < 0 || (result.calibrationError ?? 1) > 0.16) return "fail";
  if ((result.calibrationError ?? 1) > 0.1) return "watch";
  return "pass";
}

function foldNotes(result: FootballBacktestResult): string[] {
  return [
    result.pickCount < 20 ? "Thin pick count for this season fold." : "",
    result.yield !== null && result.yield < 0 ? "Negative yield in this forward season." : "",
    result.calibrationError !== null && result.calibrationError > 0.16 ? "Calibration drift exceeded the walk-forward guardrail." : "",
    result.closingLineValue === null ? "Independent CLV unavailable from public CSV closing prices." : ""
  ].filter(Boolean);
}

function nextAction({
  seasonFrom,
  seasonTo,
  maxSeasons,
  minTrainingSeasons,
  minEdge,
  minModelProbability
}: {
  seasonFrom: number;
  seasonTo: number;
  maxSeasons: number;
  minTrainingSeasons: number;
  minEdge: number;
  minModelProbability: number;
}) {
  const verifyUrl = `/api/sports/decision/training/football-data-walk-forward?seasonFrom=${seasonFrom}&seasonTo=${seasonTo}&maxSeasons=${maxSeasons}&minTrainingSeasons=${minTrainingSeasons}&minEdge=${minEdge}&minModelProbability=${minModelProbability}&dryRun=1`;
  return {
    label: "Run public EPL walk-forward validation",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence: "Season-by-season read-only validation that tests learned football thresholds against future EPL seasons without persistence or public-action changes."
  };
}

function recommendation(validation: FootballDataWalkForwardValidation["validation"]): FootballDataWalkForwardValidation["recommendation"] {
  if (!validation.folds) {
    return {
      action: "collect-more-data",
      summary: "No walk-forward folds were available.",
      evidence: [],
      risks: ["The model cannot validate threshold stability without multiple seasons."]
    };
  }
  const passRate = validation.passFolds / validation.folds;
  const action =
    validation.aggregateYield !== null && validation.aggregateYield > 0 && passRate >= 0.6
      ? "eligible-for-provider-enriched-retest"
      : validation.totalPicks >= 100
        ? "keep-shadow-locked"
        : "collect-more-data";
  return {
    action,
    summary:
      action === "eligible-for-provider-enriched-retest"
        ? "Walk-forward evidence is strong enough for a provider-enriched retest, but not for live threshold activation."
        : action === "keep-shadow-locked"
          ? "Walk-forward evidence is sufficient to diagnose drift, but thresholds stay shadow-locked."
          : "Walk-forward evidence is too thin; collect more/enriched training data.",
    evidence: [
      `${validation.passFolds}/${validation.folds} fold(s) passed.`,
      `Aggregate yield ${validation.aggregateYield ?? "n/a"} over ${validation.totalPicks} pick(s).`,
      `Stability score ${validation.stabilityScore}/100.`
    ],
    risks: [
      "Public CSV odds do not provide independent opening/closing line movement.",
      "Provider enrichment for injuries, lineups, weather, news, xG, and official fixture IDs is still missing.",
      "Season-level validation is read-only and cannot promote learned thresholds."
    ]
  };
}

function controls(canRunWalkForwardValidation: boolean): FootballDataWalkForwardValidation["controls"] {
  return {
    canInspectReadOnly: true,
    canRunWalkForwardValidation,
    canPersistBacktestRun: false,
    canPersistLearnedThresholds: false,
    canApplyLearnedThresholds: false,
    canPublishPicks: false,
    canStake: false
  };
}

function proofUrls(): string[] {
  return [
    "/api/sports/decision/training/football-data-walk-forward",
    "/api/sports/decision/training/football-data-threshold-sweep",
    "/api/sports/decision/training/football-data-backtest-probe",
    "/api/sports/decision/training/historical-corpus-acquisition"
  ];
}

export async function buildFootballDataWalkForwardValidation({
  seasonFrom,
  seasonTo,
  maxSeasons,
  minTrainingSeasons = DEFAULT_MIN_TRAINING_SEASONS,
  minEdge = DEFAULT_MIN_EDGE,
  minModelProbability = DEFAULT_MIN_MODEL_PROBABILITY,
  fetchCsv = defaultFetchCsv,
  now = new Date()
}: {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  minTrainingSeasons?: number;
  minEdge?: number;
  minModelProbability?: number;
  fetchCsv?: FetchCsv;
  now?: Date;
} = {}): Promise<FootballDataWalkForwardValidation> {
  const range = normalizeFootballDataSeasonRange({ seasonFrom, seasonTo, maxSeasons });
  const safeMinTrainingSeasons = Math.max(1, Math.min(8, Math.round(minTrainingSeasons)));
  const safeMinEdge = clamp(minEdge, 0, 0.2);
  const safeMinModelProbability = clamp(minModelProbability, 0.2, 0.8);
  const failedSeasons: FootballDataWalkForwardValidation["corpus"]["failedSeasons"] = [];
  const candidatesBySeason = new Map<number, FootballDataCsvFixtureCandidate[]>();

  for (const seasonStart of range.starts) {
    const url = sourceUrl(seasonStart);
    try {
      candidatesBySeason.set(seasonStart, parseFootballDataCsvFixtureCandidates(seasonStart, await fetchCsv(url)));
    } catch (error) {
      failedSeasons.push({
        season: seasonLabel(seasonStart),
        sourceUrl: url,
        error: error instanceof Error ? error.message : "Failed to load CSV."
      });
    }
  }

  const loadedSeasonStarts = range.starts.filter((seasonStart) => candidatesBySeason.has(seasonStart));
  const allCandidates = loadedSeasonStarts.flatMap((seasonStart) => candidatesBySeason.get(seasonStart) ?? []);
  const action = nextAction({
    seasonFrom: range.seasonFrom,
    seasonTo: range.seasonTo,
    maxSeasons: range.maxSeasons,
    minTrainingSeasons: safeMinTrainingSeasons,
    minEdge: safeMinEdge,
    minModelProbability: safeMinModelProbability
  });

  if (loadedSeasonStarts.length <= safeMinTrainingSeasons) {
    const emptyValidation = {
      folds: 0,
      passFolds: 0,
      watchFolds: 0,
      failFolds: 0,
      totalTestFixtures: 0,
      totalPicks: 0,
      aggregateRoiUnits: 0,
      aggregateYield: null,
      averageBrier: null,
      averageLogLoss: null,
      averageCalibrationError: null,
      stabilityScore: 0
    };
    return {
      mode: "football-data-walk-forward-validation",
      generatedAt: now.toISOString(),
      status: failedSeasons.length ? "failed" : "no-data",
      summary: "Not enough EPL seasons were available for walk-forward validation.",
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
        minTrainingSeasons: safeMinTrainingSeasons,
        minEdge: safeMinEdge,
        minModelProbability: safeMinModelProbability
      },
      corpus: {
        seasonsRequested: range.starts.length,
        seasonsLoaded: loadedSeasonStarts.length,
        fixtureCandidates: allCandidates.length,
        oddsCandidates: allCandidates.filter((fixture) => fixture.odds).length,
        failedSeasons
      },
      validation: emptyValidation,
      folds: [],
      recommendation: recommendation(emptyValidation),
      controls: controls(false),
      nextAction: action,
      locks: locks(),
      proofUrls: proofUrls()
    };
  }

  const folds = loadedSeasonStarts.slice(safeMinTrainingSeasons).map((seasonStart): FootballDataWalkForwardFold => {
    const trainCandidates = loadedSeasonStarts
      .filter((candidateSeasonStart) => candidateSeasonStart < seasonStart)
      .flatMap((candidateSeasonStart) => candidatesBySeason.get(candidateSeasonStart) ?? []);
    const testCandidates = candidatesBySeason.get(seasonStart) ?? [];
    const fixtures = footballDataCandidatesToBacktestFixtures([...trainCandidates, ...testCandidates]);
    const trainRatio = clamp(trainCandidates.length / Math.max(trainCandidates.length + testCandidates.length, 1), 0.1, 0.9);
    const result = runFootballBacktest(fixtures, {
      trainRatio,
      minEdge: safeMinEdge,
      minModelProbability: safeMinModelProbability
    });
    const status = foldStatus(result);
    return {
      seasonStart,
      seasonLabel: seasonLabel(seasonStart),
      trainSeasons: loadedSeasonStarts.filter((candidateSeasonStart) => candidateSeasonStart < seasonStart).length,
      trainFixtures: trainCandidates.length,
      testFixtures: result.testSize,
      pickCount: result.pickCount,
      brierScore: result.brierScore,
      logLoss: result.logLoss,
      roiUnits: result.roiUnits,
      yield: result.yield,
      calibrationError: result.calibrationError,
      status,
      notes: foldNotes(result)
    };
  });

  const aggregateRoiUnits = round(folds.reduce((sum, fold) => sum + fold.roiUnits, 0), 6) ?? 0;
  const totalPicks = folds.reduce((sum, fold) => sum + fold.pickCount, 0);
  const passFolds = folds.filter((fold) => fold.status === "pass").length;
  const watchFolds = folds.filter((fold) => fold.status === "watch").length;
  const failFolds = folds.filter((fold) => fold.status === "fail").length;
  const validation = {
    folds: folds.length,
    passFolds,
    watchFolds,
    failFolds,
    totalTestFixtures: folds.reduce((sum, fold) => sum + fold.testFixtures, 0),
    totalPicks,
    aggregateRoiUnits,
    aggregateYield: round(totalPicks ? aggregateRoiUnits / totalPicks : null, 6),
    averageBrier: round(average(folds.map((fold) => fold.brierScore).filter((value): value is number => value !== null)), 6),
    averageLogLoss: round(average(folds.map((fold) => fold.logLoss).filter((value): value is number => value !== null)), 6),
    averageCalibrationError: round(average(folds.map((fold) => fold.calibrationError).filter((value): value is number => value !== null)), 6),
    stabilityScore: Math.max(0, Math.min(100, Math.round((passFolds / Math.max(folds.length, 1)) * 70 + (watchFolds / Math.max(folds.length, 1)) * 35)))
  };

  return {
    mode: "football-data-walk-forward-validation",
    generatedAt: now.toISOString(),
    status: "completed",
    summary: `Validated ${folds.length} forward EPL season fold(s); ${passFolds} passed, ${watchFolds} watched, ${failFolds} failed.`,
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
      minTrainingSeasons: safeMinTrainingSeasons,
      minEdge: safeMinEdge,
      minModelProbability: safeMinModelProbability
    },
    corpus: {
      seasonsRequested: range.starts.length,
      seasonsLoaded: loadedSeasonStarts.length,
      fixtureCandidates: allCandidates.length,
      oddsCandidates: allCandidates.filter((fixture) => fixture.odds).length,
      failedSeasons
    },
    validation,
    folds,
    recommendation: recommendation(validation),
    controls: controls(true),
    nextAction: action,
    locks: locks(),
    proofUrls: proofUrls()
  };
}

function locks(): string[] {
  return [
    "Walk-forward validation is read-only and cannot persist backtests or learned thresholds.",
    "Season-stable public CSV evidence is still not enough to modify live public predictions.",
    "Provider-enriched retests are required before any learned-threshold promotion gate can pass."
  ];
}

export const FOOTBALL_DATA_WALK_FORWARD_DEFAULT_VERIFY_URL =
  "/api/sports/decision/training/football-data-walk-forward?seasonFrom=2016&seasonTo=2025&maxSeasons=10&minTrainingSeasons=3&minEdge=0.02&minModelProbability=0.36&dryRun=1";

export const FOOTBALL_DATA_WALK_FORWARD_DEFAULT_COMMAND = decisionCurlCommand(FOOTBALL_DATA_WALK_FORWARD_DEFAULT_VERIFY_URL);
