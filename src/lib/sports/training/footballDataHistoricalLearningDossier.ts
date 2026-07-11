import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { buildFootballDataCsvBacktestProbe, type FootballDataCsvBacktestProbe } from "@/lib/sports/training/footballDataCsvBacktestProbe";
import { buildFootballDataCsvCorpusProbe, type FootballDataCsvCorpusProbe } from "@/lib/sports/training/footballDataCsvCorpusProbe";
import { buildFootballDataMarketBenchmark, type FootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";
import { buildFootballDataMarketConsensus, type FootballDataMarketConsensus } from "@/lib/sports/training/footballDataMarketConsensus";
import { buildFootballDataMarketLearningRoadmap, type FootballDataMarketLearningRoadmap } from "@/lib/sports/training/footballDataMarketLearningRoadmap";
import { buildFootballDataMarketSegmentRetest, type FootballDataMarketSegmentRetest } from "@/lib/sports/training/footballDataMarketSegmentRetest";
import { buildFootballDataThresholdSweep, type FootballDataThresholdSweep } from "@/lib/sports/training/footballDataThresholdSweep";
import { buildFootballDataWalkForwardValidation, type FootballDataWalkForwardValidation } from "@/lib/sports/training/footballDataWalkForwardValidation";

type FetchCsv = (url: string) => Promise<string>;

export type FootballDataHistoricalLearningDossierStatus =
  | "ready-provider-retest"
  | "market-prior-dominant"
  | "needs-provider-enrichment"
  | "insufficient-history"
  | "failed";

export type FootballDataHistoricalLearningDossier = {
  mode: "football-data-historical-learning-dossier";
  generatedAt: string;
  status: FootballDataHistoricalLearningDossierStatus;
  dossierHash: string;
  summary: string;
  request: {
    seasonFrom: number;
    seasonTo: number;
    maxSeasons: number;
    dryRun: true;
    trainRatio: number;
    minEdge: number;
    minModelProbability: number;
    minPickCount: number;
    minTrainingSeasons: number;
  };
  scorecard: {
    seasonsLoaded: number;
    fixtures: number;
    oddsRows: number;
    benchmarkRows: number;
    benchmarkVerdict: FootballDataMarketBenchmark["comparison"]["verdict"];
    thresholdAction: FootballDataThresholdSweep["recommendation"]["action"];
    walkForwardAction: FootballDataWalkForwardValidation["recommendation"]["action"];
    roadmapStatus: FootballDataMarketLearningRoadmap["status"];
    learningScore: number;
  };
  findings: Array<{
    id: "corpus" | "backtest" | "market-consensus" | "market-benchmark" | "threshold-sweep" | "walk-forward" | "roadmap";
    label: string;
    status: "pass" | "watch" | "block";
    evidence: string;
    implication: string;
    proofUrl: string;
  }>;
  artifacts: {
    corpus: Pick<FootballDataCsvCorpusProbe, "mode" | "status" | "summary" | "totals" | "proofUrls">;
    backtest: Pick<FootballDataCsvBacktestProbe, "mode" | "status" | "summary" | "corpus" | "backtest" | "proofUrls">;
    marketConsensus: Pick<FootballDataMarketConsensus, "mode" | "status" | "summary" | "totals" | "marketQuality" | "proofUrls">;
    marketBenchmark: Pick<FootballDataMarketBenchmark, "mode" | "status" | "summary" | "corpus" | "model" | "market" | "comparison" | "recommendation" | "proofUrls">;
    thresholdSweep: Pick<FootballDataThresholdSweep, "mode" | "status" | "summary" | "baseline" | "bestProfile" | "recommendation" | "proofUrls">;
    walkForward: Pick<FootballDataWalkForwardValidation, "mode" | "status" | "summary" | "validation" | "recommendation" | "proofUrls">;
    roadmap: Pick<FootballDataMarketLearningRoadmap, "mode" | "status" | "summary" | "currentBlocker" | "benchmark" | "segment" | "proofUrls">;
    segmentRetest: Pick<FootballDataMarketSegmentRetest, "mode" | "status" | "summary" | "selectedCandidate" | "retestContract" | "proofUrls">;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canUseAsAiEvidence: true;
    canRunProviderRetest: boolean;
    canPersistTrainingRows: false;
    canPersistBacktestRun: false;
    canApplyLearnedWeights: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

const DEFAULT_SEASON_FROM = 2016;
const DEFAULT_SEASON_TO = 2025;
const DEFAULT_MAX_SEASONS = 10;
const DEFAULT_TRAIN_RATIO = 0.7;
const DEFAULT_MIN_EDGE = 0.02;
const DEFAULT_MIN_MODEL_PROBABILITY = 0.36;
const DEFAULT_MIN_PICK_COUNT = 75;
const DEFAULT_MIN_TRAINING_SEASONS = 3;
const DEFAULT_PUBLIC_HISTORY_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_PUBLIC_HISTORY_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PUBLIC_HISTORY_CACHE_ENTRIES = 16;

type FootballDataHistoricalLearningDossierOptions = {
  seasonFrom?: number;
  seasonTo?: number;
  maxSeasons?: number;
  trainRatio?: number;
  minEdge?: number;
  minModelProbability?: number;
  minPickCount?: number;
  minTrainingSeasons?: number;
  fetchCsv?: FetchCsv;
  now?: Date;
};

type HistoricalLearningDossierCacheEntry = {
  expiresAt: number;
  promise: Promise<FootballDataHistoricalLearningDossier>;
};

const historicalLearningDossierCache = new Map<string, HistoricalLearningDossierCacheEntry>();

function publicHistoryCacheTtlMs(): number {
  const configured = Number(process.env.ODDSPADI_PUBLIC_HISTORY_CACHE_TTL_MS);
  if (!Number.isFinite(configured)) return DEFAULT_PUBLIC_HISTORY_CACHE_TTL_MS;
  if (configured <= 0) return 0;
  return Math.min(MAX_PUBLIC_HISTORY_CACHE_TTL_MS, Math.max(5_000, Math.round(configured)));
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

async function defaultFetchCsv(url: string): Promise<string> {
  const configuredTimeout = Number(process.env.ODDSPADI_PUBLIC_HISTORY_REQUEST_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? Math.round(Math.min(15_000, Math.max(1_000, configuredTimeout))) : 5_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function cachedFetch(fetchCsv: FetchCsv): FetchCsv {
  const cache = new Map<string, Promise<string>>();
  return (url: string) => {
    const existing = cache.get(url);
    if (existing) return existing;
    const next = fetchCsv(url);
    cache.set(url, next);
    return next;
  };
}

function statusFor({
  corpus,
  benchmark,
  walkForward,
  roadmap
}: {
  corpus: FootballDataCsvCorpusProbe;
  benchmark: FootballDataMarketBenchmark;
  walkForward: FootballDataWalkForwardValidation;
  roadmap: FootballDataMarketLearningRoadmap;
}): FootballDataHistoricalLearningDossierStatus {
  if (corpus.status === "failed" || benchmark.status === "failed" || walkForward.status === "failed") return "failed";
  if (benchmark.corpus.matchedRows < 300 || corpus.totals.finishedFixtures < 500) return "insufficient-history";
  if (roadmap.status === "ready-provider-retest") return "ready-provider-retest";
  if (benchmark.comparison.verdict === "market-beats-model") return "market-prior-dominant";
  return "needs-provider-enrichment";
}

function learningScore({
  corpus,
  benchmark,
  sweep,
  walkForward,
  roadmap
}: {
  corpus: FootballDataCsvCorpusProbe;
  benchmark: FootballDataMarketBenchmark;
  sweep: FootballDataThresholdSweep;
  walkForward: FootballDataWalkForwardValidation;
  roadmap: FootballDataMarketLearningRoadmap;
}): number {
  return clamp(
    Math.min(corpus.totals.finishedFixtures / 3000, 1) * 22 +
      Math.min(benchmark.corpus.matchedRows / 1000, 1) * 22 +
      (benchmark.comparison.verdict === "model-beats-market" ? 20 : benchmark.comparison.verdict === "mixed" ? 10 : 4) +
      (sweep.recommendation.action === "raise-thresholds" ? 14 : sweep.recommendation.action === "keep-defaults" ? 8 : 3) +
      (walkForward.recommendation.action === "eligible-for-provider-enriched-retest" ? 14 : walkForward.recommendation.action === "keep-shadow-locked" ? 8 : 3) +
      (roadmap.status === "ready-provider-retest" ? 8 : 2)
  );
}

function finding(
  input: FootballDataHistoricalLearningDossier["findings"][number]
): FootballDataHistoricalLearningDossier["findings"][number] {
  return {
    ...input,
    evidence: input.evidence.replace(/\s+/g, " ").trim(),
    implication: input.implication.replace(/\s+/g, " ").trim()
  };
}

function findingsFor({
  corpus,
  backtest,
  consensus,
  benchmark,
  sweep,
  walkForward,
  roadmap
}: {
  corpus: FootballDataCsvCorpusProbe;
  backtest: FootballDataCsvBacktestProbe;
  consensus: FootballDataMarketConsensus;
  benchmark: FootballDataMarketBenchmark;
  sweep: FootballDataThresholdSweep;
  walkForward: FootballDataWalkForwardValidation;
  roadmap: FootballDataMarketLearningRoadmap;
}): FootballDataHistoricalLearningDossier["findings"] {
  return [
    finding({
      id: "corpus",
      label: "Historical corpus",
      status: corpus.status === "ready" ? "pass" : corpus.status === "partial" ? "watch" : "block",
      evidence: `${corpus.totals.seasonsLoaded}/${corpus.totals.seasonsRequested} season(s), ${corpus.totals.finishedFixtures} finished fixture(s), ${corpus.totals.oddsRows} odds row(s).`,
      implication: "The agent has enough public EPL history for read-only diagnosis, but storage/provider enrichment is still separate.",
      proofUrl: "/api/sports/decision/training/football-data-csv-probe"
    }),
    finding({
      id: "backtest",
      label: "Poisson/Elo backtest",
      status: backtest.status === "completed" ? "pass" : backtest.status === "partial" ? "watch" : "block",
      evidence: `${backtest.backtest.sampleSize} sample, ${backtest.backtest.testSize} holdout, ${backtest.backtest.pickCount} pick(s), Brier ${backtest.backtest.brierScore ?? "n/a"}, log-loss ${backtest.backtest.logLoss ?? "n/a"}.`,
      implication: "The model can be measured against history, but learned weights remain locked until persisted provider-backed backtests pass.",
      proofUrl: "/api/sports/decision/training/football-data-backtest-probe"
    }),
    finding({
      id: "market-consensus",
      label: "No-vig market consensus",
      status: consensus.marketQuality.status === "usable-shadow" ? "pass" : consensus.status === "completed" ? "watch" : "block",
      evidence: `${consensus.totals.pricedRows} priced row(s), ${consensus.totals.bookmakerMarkets} bookmaker market(s), average margin ${consensus.totals.averageMargin ?? "n/a"}.`,
      implication: "Market consensus is usable as a shadow prior, not as a live mutation or published pick.",
      proofUrl: "/api/sports/decision/training/football-data-market-consensus"
    }),
    finding({
      id: "market-benchmark",
      label: "Model vs market benchmark",
      status: benchmark.comparison.verdict === "model-beats-market" ? "pass" : benchmark.status === "completed" ? "watch" : "block",
      evidence: `${benchmark.corpus.matchedRows} matched row(s); verdict ${benchmark.comparison.verdict}; recommendation ${benchmark.recommendation.action}.`,
      implication:
        benchmark.comparison.verdict === "market-beats-model"
          ? "The agent must defer to market prior until provider-enriched retests prove the model beats market consensus."
          : "The agent can use the benchmark as shadow evidence, still without public promotion.",
      proofUrl: "/api/sports/decision/training/football-data-market-benchmark"
    }),
    finding({
      id: "threshold-sweep",
      label: "Threshold sweep",
      status: sweep.recommendation.action === "raise-thresholds" ? "pass" : sweep.status === "completed" ? "watch" : "block",
      evidence: `${sweep.request.profilesTested} profile(s); recommendation ${sweep.recommendation.action}; best yield ${sweep.bestProfile?.yield ?? "n/a"}.`,
      implication: "Thresholds are diagnostic only and cannot be applied to live decisions.",
      proofUrl: "/api/sports/decision/training/football-data-threshold-sweep"
    }),
    finding({
      id: "walk-forward",
      label: "Walk-forward validation",
      status: walkForward.recommendation.action === "eligible-for-provider-enriched-retest" ? "pass" : walkForward.status === "completed" ? "watch" : "block",
      evidence: `${walkForward.validation.passFolds}/${walkForward.validation.folds} fold(s) passed; stability ${walkForward.validation.stabilityScore}/100; aggregate yield ${walkForward.validation.aggregateYield ?? "n/a"}.`,
      implication: "Season stability is diagnostic and needs provider-enriched retest before it can influence shadow probabilities.",
      proofUrl: "/api/sports/decision/training/football-data-walk-forward"
    }),
    finding({
      id: "roadmap",
      label: "Learning roadmap",
      status: roadmap.status === "ready-provider-retest" ? "pass" : roadmap.status === "collect-more-data" ? "watch" : "block",
      evidence: `${roadmap.status}; blocker: ${roadmap.currentBlocker}`,
      implication: "The next learning action is explicit, but persistence, learned thresholds, public picks, and staking remain disabled.",
      proofUrl: "/api/sports/decision/training/football-data-market-learning-roadmap"
    })
  ];
}

function summaryFor(status: FootballDataHistoricalLearningDossierStatus, score: number): string {
  if (status === "ready-provider-retest") return `Historical learning dossier scores ${score}/100 and identifies a provider-enriched retest candidate.`;
  if (status === "market-prior-dominant") return `Historical learning dossier scores ${score}/100; market prior remains dominant over the current model.`;
  if (status === "needs-provider-enrichment") return `Historical learning dossier scores ${score}/100; provider enrichment is required before learned behavior can matter.`;
  if (status === "insufficient-history") return `Historical learning dossier scores ${score}/100 but lacks enough matched historical evidence.`;
  return `Historical learning dossier failed; public CSV evidence could not be assembled reliably.`;
}

function nextActionFor(roadmap: FootballDataMarketLearningRoadmap): FootballDataHistoricalLearningDossier["nextAction"] {
  const verifyUrl = "/api/sports/decision/training/football-data-historical-learning-dossier?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minEdge=0.02&minModelProbability=0.36&minPickCount=75&minTrainingSeasons=3&dryRun=1";
  return {
    label: roadmap.nextAction.label,
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence: roadmap.nextAction.expectedEvidence
  };
}

async function buildFootballDataHistoricalLearningDossierUncached({
  seasonFrom = DEFAULT_SEASON_FROM,
  seasonTo = DEFAULT_SEASON_TO,
  maxSeasons = DEFAULT_MAX_SEASONS,
  trainRatio = DEFAULT_TRAIN_RATIO,
  minEdge = DEFAULT_MIN_EDGE,
  minModelProbability = DEFAULT_MIN_MODEL_PROBABILITY,
  minPickCount = DEFAULT_MIN_PICK_COUNT,
  minTrainingSeasons = DEFAULT_MIN_TRAINING_SEASONS,
  fetchCsv = defaultFetchCsv,
  now = new Date()
}: FootballDataHistoricalLearningDossierOptions = {}): Promise<FootballDataHistoricalLearningDossier> {
  const sharedFetch = cachedFetch(fetchCsv);
  const [corpus, backtest, consensus, benchmark, sweep, walkForward] = await Promise.all([
    buildFootballDataCsvCorpusProbe({ seasonFrom, seasonTo, maxSeasons, fetchCsv: sharedFetch, now }),
    buildFootballDataCsvBacktestProbe({ seasonFrom, seasonTo, maxSeasons, trainRatio, minEdge, fetchCsv: sharedFetch, now }),
    buildFootballDataMarketConsensus({ seasonFrom, seasonTo, maxSeasons, fetchCsv: sharedFetch, now }),
    buildFootballDataMarketBenchmark({ seasonFrom, seasonTo, maxSeasons, trainRatio, minEdge, minModelProbability, fetchCsv: sharedFetch, now }),
    buildFootballDataThresholdSweep({ seasonFrom, seasonTo, maxSeasons, trainRatio, minPickCount, fetchCsv: sharedFetch, now }),
    buildFootballDataWalkForwardValidation({ seasonFrom, seasonTo, maxSeasons, minTrainingSeasons, minEdge, minModelProbability, fetchCsv: sharedFetch, now })
  ]);
  const segmentRetest = buildFootballDataMarketSegmentRetest({ benchmark, thresholdSweep: sweep, now });
  const roadmap = buildFootballDataMarketLearningRoadmap({ benchmark, thresholdSweep: sweep, segmentRetest, now });
  const status = statusFor({ corpus, benchmark, walkForward, roadmap });
  const score = learningScore({ corpus, benchmark, sweep, walkForward, roadmap });
  const findings = findingsFor({ corpus, backtest, consensus, benchmark, sweep, walkForward, roadmap });
  const dossierHash = stableHash({
    status,
    score,
    corpus: [corpus.status, corpus.totals.finishedFixtures, corpus.totals.oddsRows],
    benchmark: [benchmark.status, benchmark.comparison.verdict, benchmark.corpus.matchedRows],
    sweep: [sweep.status, sweep.recommendation.action],
    walkForward: [walkForward.status, walkForward.validation.stabilityScore],
    roadmap: [roadmap.status, roadmap.currentBlocker]
  });

  return {
    mode: "football-data-historical-learning-dossier",
    generatedAt: now.toISOString(),
    status,
    dossierHash,
    summary: summaryFor(status, score),
    request: {
      seasonFrom,
      seasonTo,
      maxSeasons,
      dryRun: true,
      trainRatio,
      minEdge,
      minModelProbability,
      minPickCount,
      minTrainingSeasons
    },
    scorecard: {
      seasonsLoaded: corpus.totals.seasonsLoaded,
      fixtures: corpus.totals.finishedFixtures,
      oddsRows: corpus.totals.oddsRows,
      benchmarkRows: benchmark.corpus.matchedRows,
      benchmarkVerdict: benchmark.comparison.verdict,
      thresholdAction: sweep.recommendation.action,
      walkForwardAction: walkForward.recommendation.action,
      roadmapStatus: roadmap.status,
      learningScore: score
    },
    findings,
    artifacts: {
      corpus,
      backtest,
      marketConsensus: consensus,
      marketBenchmark: benchmark,
      thresholdSweep: sweep,
      walkForward,
      roadmap,
      segmentRetest
    },
    nextAction: nextActionFor(roadmap),
    controls: {
      canInspectReadOnly: true,
      canUseAsAiEvidence: true,
      canRunProviderRetest: roadmap.controls.canRunProviderRetest,
      canPersistTrainingRows: false,
      canPersistBacktestRun: false,
      canApplyLearnedWeights: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Historical learning dossier is read-only and cannot write training rows, persist backtests, apply thresholds, publish picks, or stake.",
      "Public EPL CSV evidence can diagnose the model, but provider-enriched fixtures, odds, lineups, injuries, news, weather, and stored outcomes remain required.",
      "When market consensus beats the model, the agent must keep market prior dominant until provider-enriched retests overturn it."
    ],
    proofUrls: unique([
      "/api/sports/decision/training/football-data-historical-learning-dossier",
      ...corpus.proofUrls,
      ...backtest.proofUrls,
      ...consensus.proofUrls,
      ...benchmark.proofUrls,
      ...sweep.proofUrls,
      ...walkForward.proofUrls,
      ...roadmap.proofUrls
    ])
  };
}

export async function buildFootballDataHistoricalLearningDossier(
  options: FootballDataHistoricalLearningDossierOptions = {}
): Promise<FootballDataHistoricalLearningDossier> {
  const cacheTtlMs = publicHistoryCacheTtlMs();
  const cacheable = options.fetchCsv === undefined && options.now === undefined && cacheTtlMs > 0;
  if (!cacheable) return buildFootballDataHistoricalLearningDossierUncached(options);

  const normalized = {
    seasonFrom: options.seasonFrom ?? DEFAULT_SEASON_FROM,
    seasonTo: options.seasonTo ?? DEFAULT_SEASON_TO,
    maxSeasons: options.maxSeasons ?? DEFAULT_MAX_SEASONS,
    trainRatio: options.trainRatio ?? DEFAULT_TRAIN_RATIO,
    minEdge: options.minEdge ?? DEFAULT_MIN_EDGE,
    minModelProbability: options.minModelProbability ?? DEFAULT_MIN_MODEL_PROBABILITY,
    minPickCount: options.minPickCount ?? DEFAULT_MIN_PICK_COUNT,
    minTrainingSeasons: options.minTrainingSeasons ?? DEFAULT_MIN_TRAINING_SEASONS
  };
  const cacheKey = JSON.stringify(normalized);
  const currentTime = Date.now();
  const existing = historicalLearningDossierCache.get(cacheKey);
  if (existing && existing.expiresAt > currentTime) return existing.promise;
  if (existing) historicalLearningDossierCache.delete(cacheKey);

  while (historicalLearningDossierCache.size >= MAX_PUBLIC_HISTORY_CACHE_ENTRIES) {
    const oldestKey = historicalLearningDossierCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    historicalLearningDossierCache.delete(oldestKey);
  }

  const promise = buildFootballDataHistoricalLearningDossierUncached({
    ...normalized,
    fetchCsv: defaultFetchCsv,
    now: new Date(currentTime)
  });
  const entry = { expiresAt: currentTime + cacheTtlMs, promise };
  historicalLearningDossierCache.set(cacheKey, entry);
  promise.catch(() => {
    if (historicalLearningDossierCache.get(cacheKey) === entry) historicalLearningDossierCache.delete(cacheKey);
  });
  return promise;
}
