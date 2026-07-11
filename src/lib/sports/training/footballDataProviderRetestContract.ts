import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { FootballDataMarketLearningRoadmap } from "@/lib/sports/training/footballDataMarketLearningRoadmap";
import type { FootballDataMarketSegmentRetest } from "@/lib/sports/training/footballDataMarketSegmentRetest";

export type FootballDataProviderRetestContractStatus =
  | "ready-provider-retest-contract"
  | "blocked-market-prior"
  | "waiting-provider-data";

export type FootballDataProviderRetestEvidenceStatus = "required" | "locked" | "optional";

export type FootballDataProviderRetestEvidenceGroup = {
  id:
    | "fixture-identity"
    | "market-odds"
    | "team-strength"
    | "availability-context"
    | "news-weather-context"
    | "live-and-settlement"
    | "feature-snapshots"
    | "backtest-memory";
  label: string;
  status: FootballDataProviderRetestEvidenceStatus;
  requiredTables: string[];
  requiredProviderProof: string[];
  modelUse: string;
  rejectIfMissing: boolean;
};

export type FootballDataProviderRetestMetricGate = {
  id:
    | "sample-size"
    | "brier-score"
    | "log-loss"
    | "closing-line-value"
    | "yield"
    | "calibration-error"
    | "market-disagreement";
  label: string;
  threshold: string;
  passRule: string;
  failRule: string;
};

export type FootballDataProviderRetestContract = {
  mode: "football-data-provider-retest-contract";
  generatedAt: string;
  status: FootballDataProviderRetestContractStatus;
  contractHash: string;
  summary: string;
  segment: {
    selectedId: string | null;
    minEdge: number | null;
    minModelProbability: number | null;
    pickCount: number | null;
    minHoldoutRows: number;
  };
  evidenceGroups: FootballDataProviderRetestEvidenceGroup[];
  metricGates: FootballDataProviderRetestMetricGate[];
  storageTargets: {
    sourceTables: string[];
    featureTable: "op_training_feature_snapshots";
    resultTable: "op_backtest_runs";
    rawPayloadTable: "op_raw_provider_payloads";
  };
  executionPlan: Array<{
    step: number;
    label: string;
    requiredProof: string;
    outputTable: string;
  }>;
  promotionRules: {
    canPromoteToShadow: string;
    canPromoteToLiveProbabilities: string;
    rejectionRule: string;
    publicPickRule: string;
  };
  controls: {
    canInspectReadOnly: true;
    canQueueProviderRetest: boolean;
    canWriteProviderRows: false;
    canPersistBacktestMemory: false;
    canApplyThresholds: false;
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

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function evidenceGroup(input: FootballDataProviderRetestEvidenceGroup): FootballDataProviderRetestEvidenceGroup {
  return {
    ...input,
    requiredProviderProof: unique(input.requiredProviderProof, 8)
  };
}

function contractStatus(roadmap: FootballDataMarketLearningRoadmap, segmentRetest: FootballDataMarketSegmentRetest): FootballDataProviderRetestContractStatus {
  if (roadmap.status === "ready-provider-retest" && segmentRetest.selectedCandidate) return "ready-provider-retest-contract";
  if (roadmap.status === "blocked-market-prior" || segmentRetest.status === "blocked-market-prior") return "blocked-market-prior";
  return "waiting-provider-data";
}

function summaryFor(status: FootballDataProviderRetestContractStatus): string {
  if (status === "ready-provider-retest-contract") {
    return "A threshold segment can be retested with provider-enriched data, but every write, threshold, public pick, and stake action remains locked.";
  }
  if (status === "waiting-provider-data") {
    return "The engine needs richer provider evidence before a market-learning retest can be queued.";
  }
  return "Market prior still dominates; the provider retest contract documents required evidence but cannot queue a retest yet.";
}

function evidenceGroups(status: FootballDataProviderRetestContractStatus): FootballDataProviderRetestEvidenceGroup[] {
  const ready = status === "ready-provider-retest-contract";
  const coreStatus: FootballDataProviderRetestEvidenceStatus = ready ? "required" : "locked";
  return [
    evidenceGroup({
      id: "fixture-identity",
      label: "Fixture identity and 10-year corpus",
      status: coreStatus,
      requiredTables: ["op_leagues", "op_teams", "op_fixtures"],
      requiredProviderProof: [
        "Provider fixture IDs are stable across historical results, daily fixtures, odds snapshots, and settlement.",
        "League, season, kickoff, home team, away team, venue, and final score are normalized for the same EPL segment."
      ],
      modelUse: "Aligns 10-year historical training rows with 2026 EPL fixtures and avoids duplicate or mismatched matches.",
      rejectIfMissing: true
    }),
    evidenceGroup({
      id: "market-odds",
      label: "Opening, pre-kickoff, and closing odds",
      status: coreStatus,
      requiredTables: ["op_odds_snapshots", "op_raw_provider_payloads"],
      requiredProviderProof: [
        "At least two bookmakers have no-vig probabilities for the selected market.",
        "Opening, latest pre-kickoff, and closing snapshots are timestamped so CLV can be measured."
      ],
      modelUse: "Builds implied probabilities, removes margin, compares model edge to market consensus, and measures closing-line value.",
      rejectIfMissing: true
    }),
    evidenceGroup({
      id: "team-strength",
      label: "Team strength, standings, form, and home-away state",
      status: coreStatus,
      requiredTables: ["op_fixture_team_features", "op_standings_snapshots", "op_training_feature_snapshots"],
      requiredProviderProof: [
        "Pre-match Elo, attack, defense, recent form, standings, and home-away features exist before kickoff.",
        "Features are generated without using final-score or closing-outcome leakage."
      ],
      modelUse: "Feeds Poisson expected goals, Elo/team-strength, recent-form weighting, home advantage, and market fusion.",
      rejectIfMissing: true
    }),
    evidenceGroup({
      id: "availability-context",
      label: "Lineups, injuries, and suspensions",
      status: coreStatus,
      requiredTables: ["op_player_availability_snapshots", "op_lineup_snapshots"],
      requiredProviderProof: [
        "Availability snapshots include player/team IDs, status, reason, impact score, and observation time.",
        "Lineup snapshots state predicted, confirmed, or unavailable, with formations and player lists when supplied."
      ],
      modelUse: "Controls injury/news adjustment, lineup risk, and abstention when a starter-level signal contradicts the base model.",
      rejectIfMissing: true
    }),
    evidenceGroup({
      id: "news-weather-context",
      label: "News and weather signals",
      status: coreStatus,
      requiredTables: ["op_news_signals", "op_weather_snapshots"],
      requiredProviderProof: [
        "News signals include source URLs, publication time, entities, signal type, confidence, and impact score.",
        "Weather snapshots cover outdoor football fixtures with kickoff-time forecast or observed match-time conditions."
      ],
      modelUse: "Lets the AI reviewer cite source-grounded risks and adjust totals/tempo when weather matters.",
      rejectIfMissing: false
    }),
    evidenceGroup({
      id: "live-and-settlement",
      label: "Live scores, events, and settlement",
      status: coreStatus,
      requiredTables: ["op_live_match_events", "op_prediction_outcomes"],
      requiredProviderProof: [
        "Goals, cards, substitutions, injuries, and live score states are stored with provider IDs.",
        "Prediction outcomes settle against final result and market selection semantics."
      ],
      modelUse: "Supports live abstention, replay, settlement, and outcome labels for calibration.",
      rejectIfMissing: true
    }),
    evidenceGroup({
      id: "feature-snapshots",
      label: "Provider-enriched feature snapshots",
      status: coreStatus,
      requiredTables: ["op_training_feature_snapshots"],
      requiredProviderProof: [
        "Each retest row stores model key, generated time, train/validation/test split, features, targets, source, and feature hash.",
        "Feature snapshots are reproducible from raw provider payloads and exclude future leakage."
      ],
      modelUse: "Creates the training matrix for Poisson, Elo, market calibration, and shadow learning.",
      rejectIfMissing: true
    }),
    evidenceGroup({
      id: "backtest-memory",
      label: "Backtest and calibration memory",
      status: coreStatus,
      requiredTables: ["op_backtest_runs", "op_calibration_runs", "op_shadow_memory_replay"],
      requiredProviderProof: [
        "Backtest run stores sample size, pick count, Brier, log-loss, ROI, yield, CLV, calibration error, and config.",
        "Calibration and shadow replay receipts can be read back before promotion gates consume them."
      ],
      modelUse: "Prevents one-off local proof from silently becoming live model authority.",
      rejectIfMissing: true
    })
  ];
}

function metricGates(minHoldoutRows: number): FootballDataProviderRetestMetricGate[] {
  return [
    {
      id: "sample-size",
      label: "Holdout sample",
      threshold: `At least ${minHoldoutRows} provider-enriched holdout rows for the selected segment.`,
      passRule: "Rows are pre-match, deduplicated, settled, and aligned with provider fixture IDs.",
      failRule: "If the sample is thinner or contains leakage, keep thresholds locked and collect more data."
    },
    {
      id: "brier-score",
      label: "Brier beats market",
      threshold: "Model Brier score must be lower than no-vig market Brier score.",
      passRule: "Provider-enriched probabilities improve squared-error reliability against market consensus.",
      failRule: "If market Brier is equal or better, market prior remains dominant."
    },
    {
      id: "log-loss",
      label: "Log-loss beats market",
      threshold: "Model log-loss must be lower than no-vig market log-loss.",
      passRule: "Model probabilities avoid overconfident misses better than the market baseline.",
      failRule: "If log-loss fails, do not promote the segment even when ROI looks positive."
    },
    {
      id: "closing-line-value",
      label: "Positive CLV",
      threshold: "Average closing-line value must be positive after bookmaker margin removal.",
      passRule: "Selections beat closing consensus often enough to suggest real price discovery.",
      failRule: "Negative or flat CLV blocks live probability influence."
    },
    {
      id: "yield",
      label: "Positive yield",
      threshold: "Yield must be positive after realistic stake sizing and void/push handling.",
      passRule: "The selected market segment shows practical expected value, not only prettier probabilities.",
      failRule: "Negative yield keeps the segment in research mode."
    },
    {
      id: "calibration-error",
      label: "Calibration error",
      threshold: "Expected calibration error must stay at or below 0.08 on the holdout segment.",
      passRule: "Probability buckets are close enough to observed outcomes for public explanations.",
      failRule: "Poor calibration blocks promotion even when headline accuracy looks attractive."
    },
    {
      id: "market-disagreement",
      label: "Market disagreement audit",
      threshold: "Every promoted pick must explain model-vs-market disagreement and list safer alternatives.",
      passRule: "The agent names why it disagrees, what could break the edge, and when to avoid.",
      failRule: "Unsupported disagreement keeps the public answer as monitor or avoid."
    }
  ];
}

function nextAction(
  status: FootballDataProviderRetestContractStatus,
  selected: FootballDataMarketSegmentRetest["selectedCandidate"]
): FootballDataProviderRetestContract["nextAction"] {
  const verifyUrl = "/api/sports/decision/training/football-data-provider-retest-contract?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minPickCount=75&dryRun=1";
  return {
    label:
      status === "ready-provider-retest-contract"
        ? "Run provider-enriched retest dry-run"
        : status === "waiting-provider-data"
          ? "Collect provider evidence"
          : "Keep market prior locked",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    expectedEvidence:
      status === "ready-provider-retest-contract" && selected
        ? `Provider-enriched dry-run covers ${selected.id}, stores no data, and proves the evidence groups and metric gates required before shadow promotion.`
        : "Benchmark, threshold sweep, and provider evidence produce a credible segment before any retest can be queued."
  };
}

export function buildFootballDataProviderRetestContract({
  roadmap,
  segmentRetest,
  now = new Date()
}: {
  roadmap: FootballDataMarketLearningRoadmap;
  segmentRetest: FootballDataMarketSegmentRetest;
  now?: Date;
}): FootballDataProviderRetestContract {
  const selected = segmentRetest.selectedCandidate;
  const minHoldoutRows = segmentRetest.retestContract.minHoldoutRows;
  const status = contractStatus(roadmap, segmentRetest);
  const groups = evidenceGroups(status);
  const gates = metricGates(minHoldoutRows);

  return {
    mode: "football-data-provider-retest-contract",
    generatedAt: now.toISOString(),
    status,
    contractHash: stableHash({
      status,
      roadmap: [roadmap.status, roadmap.roadmapHash],
      segment: [selected?.id ?? null, selected?.minEdge ?? null, selected?.minModelProbability ?? null, selected?.pickCount ?? null],
      groups: groups.map((group) => [group.id, group.status, group.requiredTables]),
      gates: gates.map((gate) => [gate.id, gate.threshold])
    }),
    summary: summaryFor(status),
    segment: {
      selectedId: selected?.id ?? null,
      minEdge: selected?.minEdge ?? null,
      minModelProbability: selected?.minModelProbability ?? null,
      pickCount: selected?.pickCount ?? null,
      minHoldoutRows
    },
    evidenceGroups: groups,
    metricGates: gates,
    storageTargets: {
      sourceTables: unique(groups.flatMap((group) => group.requiredTables)),
      featureTable: "op_training_feature_snapshots",
      resultTable: "op_backtest_runs",
      rawPayloadTable: "op_raw_provider_payloads"
    },
    executionPlan: [
      {
        step: 1,
        label: "Build fixture and market spine",
        requiredProof: "Provider fixture IDs join historical EPL results to bookmaker odds snapshots with no duplicate matches.",
        outputTable: "op_fixtures"
      },
      {
        step: 2,
        label: "Attach context before kickoff",
        requiredProof: "Standings, form, lineups, injuries, news, weather, and market observations are timestamped before outcome knowledge.",
        outputTable: "op_training_feature_snapshots"
      },
      {
        step: 3,
        label: "Run provider-enriched holdout",
        requiredProof: "The selected threshold segment is replayed on provider-enriched holdout rows against no-vig market consensus.",
        outputTable: "op_backtest_runs"
      },
      {
        step: 4,
        label: "Store calibration and replay proof",
        requiredProof: "Backtest, calibration, and shadow replay receipts are persisted and read back before any promotion gate consumes them.",
        outputTable: "op_calibration_runs"
      }
    ],
    promotionRules: {
      canPromoteToShadow: "Only after Brier, log-loss, CLV, yield, calibration, and sample-size gates pass together on provider-enriched holdout data.",
      canPromoteToLiveProbabilities: "Only after stored backtest memory and shadow replay remain stable across a fresh EPL cycle.",
      rejectionRule: "If no-vig market consensus beats the provider-enriched segment on Brier or log-loss, keep market prior dominant.",
      publicPickRule: "Public picks remain monitor/avoid unless final promotion, AI review, risk council, and evidence freshness gates all pass."
    },
    controls: {
      canInspectReadOnly: true,
      canQueueProviderRetest: status === "ready-provider-retest-contract",
      canWriteProviderRows: false,
      canPersistBacktestMemory: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: nextAction(status, selected),
    locks: [
      "Provider retest contract is read-only and cannot write provider rows, persist backtests, apply thresholds, publish picks, or stake.",
      "No 2026 EPL fixture can receive live model authority until provider-backed fixture, odds, context, and settlement evidence is stored and replayed.",
      "Market prior remains the default unless provider-enriched retest beats no-vig market consensus on Brier and log-loss.",
      "OpenAI/AI reviewer explanations may summarize supplied evidence, but cannot upgrade a blocked metric gate."
    ],
    proofUrls: unique([
      "/api/sports/decision/training/football-data-provider-retest-contract",
      ...roadmap.proofUrls,
      ...segmentRetest.proofUrls,
      "/api/sports/decision/supabase-schema-manifest",
      "/api/sports/decision/answer-promotion-gate"
    ])
  };
}
