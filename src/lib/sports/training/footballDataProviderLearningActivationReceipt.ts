import type { FootballDataProviderRetestBridge } from "@/lib/sports/training/footballDataProviderRetestBridge";
import type { FootballDataProviderRetestContract } from "@/lib/sports/training/footballDataProviderRetestContract";
import type { FootballDataProviderRetestRunner } from "@/lib/sports/training/footballDataProviderRetestRunner";

export type FootballDataProviderLearningActivationSource = "stored-supabase" | "demo-preview";

export type FootballDataProviderLearningActivationStatus =
  | "shadow-eligible"
  | "demo-preview-only"
  | "waiting-feature-storage"
  | "waiting-contract"
  | "waiting-retest-evidence"
  | "blocked-market-gates";

export type FootballDataProviderLearningActivationReceipt = {
  mode: "football-data-provider-learning-activation";
  generatedAt: string;
  status: FootballDataProviderLearningActivationStatus;
  activationHash: string;
  summary: string;
  source: FootballDataProviderLearningActivationSource;
  contract: {
    status: FootballDataProviderRetestContract["status"];
    selectedSegmentId: string | null;
    minHoldoutRows: number;
    canQueueProviderRetest: boolean;
  };
  bridge: {
    status: FootballDataProviderRetestBridge["status"];
    storedFeatureRows: number;
    normalizedRows: number;
    rejectedRows: number;
    sourceTable: "op_training_feature_snapshots";
    targetMatchesExpected: boolean;
    serverReadReady: boolean;
  };
  runner: {
    status: FootballDataProviderRetestRunner["status"];
    usableRows: number;
    pickCount: number;
    brierScore: number | null;
    marketBrierScore: number | null;
    logLoss: number | null;
    marketLogLoss: number | null;
    yield: number | null;
    closingLineValue: number | null;
    calibrationError: number | null;
    gatesPassed: number;
    gatesBlocked: number;
  };
  activationChecks: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canUseDemoRowsForMathProof: boolean;
    canQueueShadowComparison: boolean;
    canApplyLearnedWeights: false;
    canPromoteLiveProbabilities: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
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

function activationStatus({
  source,
  contract,
  bridge,
  runner
}: {
  source: FootballDataProviderLearningActivationSource;
  contract: FootballDataProviderRetestContract;
  bridge: FootballDataProviderRetestBridge;
  runner: FootballDataProviderRetestRunner;
}): FootballDataProviderLearningActivationStatus {
  if (source === "demo-preview") return "demo-preview-only";
  if (!contract.controls.canQueueProviderRetest) return "waiting-contract";
  if (!bridge.corpus.normalizedRows) return "waiting-feature-storage";
  if (runner.status === "passed-shadow-retest") return "shadow-eligible";
  if (runner.status === "failed-market-gates") return "blocked-market-gates";
  return "waiting-retest-evidence";
}

function summaryFor(status: FootballDataProviderLearningActivationStatus): string {
  if (status === "shadow-eligible") return "Stored provider-enriched rows passed read-only retest gates and are eligible for shadow comparison; live picks remain locked.";
  if (status === "demo-preview-only") return "Demo provider rows prove the math path, but production activation still waits for stored Supabase feature rows.";
  if (status === "waiting-contract") return "Provider learning activation is waiting for a queueable market-learning contract.";
  if (status === "waiting-feature-storage") return "Provider learning activation is waiting for stored op_training_feature_snapshots rows.";
  if (status === "blocked-market-gates") return "Stored provider rows ran through retest, but market-comparison gates blocked shadow promotion.";
  return "Provider rows need stronger evidence, larger holdout samples, or cleaner settlement before activation.";
}

function check(id: string, label: string, status: "pass" | "watch" | "block", detail: string) {
  return { id, label, status, detail };
}

function activationChecks({
  source,
  contract,
  bridge,
  runner
}: {
  source: FootballDataProviderLearningActivationSource;
  contract: FootballDataProviderRetestContract;
  bridge: FootballDataProviderRetestBridge;
  runner: FootballDataProviderRetestRunner;
}): FootballDataProviderLearningActivationReceipt["activationChecks"] {
  return [
    check(
      "source-authority",
      "Source authority",
      source === "stored-supabase" ? "pass" : "watch",
      source === "stored-supabase" ? "Activation is based on stored Supabase feature rows." : "Demo preview rows can prove math only; they cannot activate learning."
    ),
    check(
      "contract-ready",
      "Provider retest contract",
      contract.controls.canQueueProviderRetest ? "pass" : "block",
      `${contract.status}; selected segment ${contract.segment.selectedId ?? "none"}.`
    ),
    check(
      "feature-storage",
      "Stored feature snapshots",
      bridge.corpus.normalizedRows > 0 ? "pass" : "block",
      `${bridge.corpus.normalizedRows} normalized row(s) from ${bridge.target.sourceTable}; ${bridge.corpus.rejectedRows} rejected.`
    ),
    check(
      "target-isolation",
      "OddsPadi Supabase target",
      bridge.target.serverReadReady && bridge.target.targetMatchesExpected ? "pass" : "block",
      `serverReadReady=${bridge.target.serverReadReady}; targetMatchesExpected=${bridge.target.targetMatchesExpected}.`
    ),
    check(
      "market-gates",
      "Model beats market gates",
      runner.status === "passed-shadow-retest" ? "pass" : runner.status === "failed-market-gates" ? "block" : "watch",
      `${runner.status}; ${runner.gateResults.filter((gate) => gate.status === "pass").length}/${runner.gateResults.length} runner gate(s) pass.`
    ),
    check(
      "promotion-locks",
      "Promotion locks",
      "pass",
      "Activation receipt can only queue shadow comparison; it cannot apply weights, publish picks, or stake."
    )
  ];
}

function nextAction(status: FootballDataProviderLearningActivationStatus): FootballDataProviderLearningActivationReceipt["nextAction"] {
  const verifyUrl = "/api/sports/decision/training/football-data-provider-learning-activation?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minPickCount=75&dryRun=1";
  if (status === "shadow-eligible") {
    return {
      label: "Run shadow comparison",
      verifyUrl,
      expectedEvidence: "A separate shadow comparison reads stored backtest/calibration proof before learned weights can influence any public probability."
    };
  }
  if (status === "demo-preview-only") {
    return {
      label: "Store real provider feature rows",
      verifyUrl,
      expectedEvidence: "Real provider-enriched op_training_feature_snapshots rows exist in Supabase and replace demo-preview proof."
    };
  }
  if (status === "waiting-feature-storage") {
    return {
      label: "Run feature storage receipt with real provider rows",
      verifyUrl,
      expectedEvidence: "op_training_feature_snapshots contains football-provider-enriched-retest-v1 rows with odds, model probabilities, targets, and raw payload links."
    };
  }
  return {
    label: "Keep learning locked",
    verifyUrl,
    expectedEvidence: "Provider contract, feature storage, retest metrics, and market gates all pass before shadow activation."
  };
}

export function buildFootballDataProviderLearningActivationReceipt({
  contract,
  bridge,
  runner,
  source = "stored-supabase",
  now = new Date()
}: {
  contract: FootballDataProviderRetestContract;
  bridge: FootballDataProviderRetestBridge;
  runner: FootballDataProviderRetestRunner;
  source?: FootballDataProviderLearningActivationSource;
  now?: Date;
}): FootballDataProviderLearningActivationReceipt {
  const checks = activationChecks({ source, contract, bridge, runner });
  const status = activationStatus({ source, contract, bridge, runner });

  return {
    mode: "football-data-provider-learning-activation",
    generatedAt: now.toISOString(),
    status,
    activationHash: stableHash({
      status,
      source,
      contract: [contract.contractHash, contract.status, contract.segment.selectedId],
      bridge: [bridge.bridgeHash, bridge.status, bridge.corpus.normalizedRows, bridge.corpus.rejectedRows],
      runner: [runner.runnerHash, runner.status, runner.corpus.usableRows, runner.corpus.pickCount],
      checks: checks.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status),
    source,
    contract: {
      status: contract.status,
      selectedSegmentId: contract.segment.selectedId,
      minHoldoutRows: contract.segment.minHoldoutRows,
      canQueueProviderRetest: contract.controls.canQueueProviderRetest
    },
    bridge: {
      status: bridge.status,
      storedFeatureRows: bridge.corpus.featureRows,
      normalizedRows: bridge.corpus.normalizedRows,
      rejectedRows: bridge.corpus.rejectedRows,
      sourceTable: bridge.target.sourceTable,
      targetMatchesExpected: bridge.target.targetMatchesExpected,
      serverReadReady: bridge.target.serverReadReady
    },
    runner: {
      status: runner.status,
      usableRows: runner.corpus.usableRows,
      pickCount: runner.corpus.pickCount,
      brierScore: runner.model.brierScore,
      marketBrierScore: runner.market.brierScore,
      logLoss: runner.model.logLoss,
      marketLogLoss: runner.market.logLoss,
      yield: runner.picks.yield,
      closingLineValue: runner.picks.closingLineValue,
      calibrationError: runner.model.calibrationError,
      gatesPassed: runner.gateResults.filter((gate) => gate.status === "pass").length,
      gatesBlocked: runner.gateResults.filter((gate) => gate.status === "block").length
    },
    activationChecks: checks,
    controls: {
      canInspectReadOnly: true,
      canUseDemoRowsForMathProof: source === "demo-preview",
      canQueueShadowComparison: source === "stored-supabase" && status === "shadow-eligible",
      canApplyLearnedWeights: false,
      canPromoteLiveProbabilities: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: nextAction(status),
    locks: [
      "Learning activation is read-only and cannot write provider rows, apply learned weights, publish picks, or stake.",
      "Demo preview rows can prove math and UI wiring only; production activation requires stored Supabase feature rows.",
      "The no-vig market remains dominant unless stored provider rows pass Brier, log-loss, CLV, yield, calibration, and sample-size gates.",
      "Shadow eligibility is not live promotion; separate promotion, explanation, and evidence freshness gates still apply."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-data-provider-learning-activation",
      ...bridge.proofUrls,
      ...runner.proofUrls,
      "/api/sports/decision/learning-promotion-gate"
    ]
  };
}
