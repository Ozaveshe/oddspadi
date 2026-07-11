import type { DecisionOddsSnapshotWriteReceipt } from "@/lib/sports/prediction/decisionOddsSnapshotWriteReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { TrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";
import type { TrainingReadiness } from "@/lib/sports/training/trainingReadiness";

export type DecisionOddsFeatureReadinessStatus =
  | "waiting-odds-write"
  | "needs-training-corpus"
  | "ready-feature-shadow-review"
  | "blocked-training-proof";

export type DecisionOddsFeatureReadinessGateStatus = "pass" | "watch" | "block";

export type DecisionOddsFeatureReadinessGate = {
  id: "stored-odds" | "feature-table" | "snapshot-slots" | "market-features" | "corpus-volume" | "training-lock";
  label: string;
  status: DecisionOddsFeatureReadinessGateStatus;
  evidence: string;
  nextAction: string;
};

export type DecisionOddsFeatureReadinessFeature = {
  id:
    | "opening_no_vig_probability"
    | "pre_kickoff_no_vig_probability"
    | "closing_no_vig_probability"
    | "bookmaker_margin"
    | "line_movement"
    | "market_edge"
    | "expected_value"
    | "closing_line_value";
  label: string;
  sourceTable: "op_odds_snapshots";
  targetTable: "op_training_feature_snapshots";
  formula: string;
  requiredFor: "market-prior" | "value-edge" | "clv" | "audit";
};

export type DecisionOddsFeatureReadiness = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-odds-feature-readiness";
  status: DecisionOddsFeatureReadinessStatus;
  readinessHash: string;
  summary: string;
  input: {
    writeReceiptHash: string;
    writeStatus: DecisionOddsSnapshotWriteReceipt["status"];
    trainingBlueprintHash: string;
    trainingReadinessHash: string;
    oddsRows: number;
    rowsWritten: number;
    candidateFeatureRows: number;
  };
  target: {
    sourceTable: "op_odds_snapshots";
    targetTable: "op_training_feature_snapshots";
    featureTableDeclared: boolean;
    realOddsSnapshots: number;
    featureSnapshots: number;
    backtestRuns: number;
  };
  features: DecisionOddsFeatureReadinessFeature[];
  gates: DecisionOddsFeatureReadinessGate[];
  nextTurn: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    requiresAdminHeader: boolean;
  };
  controls: {
    canInspectReadOnly: true;
    canUseStoredOddsForFeatureReview: boolean;
    canGenerateTrainingFeatureSnapshots: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canUseLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
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

function features(): DecisionOddsFeatureReadinessFeature[] {
  return [
    {
      id: "opening_no_vig_probability",
      label: "Opening no-vig market prior",
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      formula: "first non-closing margin_adjusted_probability by fixture, bookmaker, market, selection",
      requiredFor: "market-prior"
    },
    {
      id: "pre_kickoff_no_vig_probability",
      label: "Pre-kickoff no-vig market prior",
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      formula: "latest pre-match non-closing margin_adjusted_probability before kickoff",
      requiredFor: "market-prior"
    },
    {
      id: "closing_no_vig_probability",
      label: "Closing no-vig market prior",
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      formula: "is_closing=true margin_adjusted_probability by fixture, bookmaker, market, selection",
      requiredFor: "clv"
    },
    {
      id: "bookmaker_margin",
      label: "Bookmaker margin",
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      formula: "sum(implied_probability for complete bookmaker market) - 1",
      requiredFor: "audit"
    },
    {
      id: "line_movement",
      label: "Line movement",
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      formula: "closing_no_vig_probability - opening_no_vig_probability",
      requiredFor: "clv"
    },
    {
      id: "market_edge",
      label: "Model edge versus market",
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      formula: "model_probability - selected_snapshot_no_vig_probability",
      requiredFor: "value-edge"
    },
    {
      id: "expected_value",
      label: "Expected value",
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      formula: "model_probability * decimal_odds - 1",
      requiredFor: "value-edge"
    },
    {
      id: "closing_line_value",
      label: "Closing-line value",
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      formula: "selected_price_probability - closing_no_vig_probability for the same side/market",
      requiredFor: "clv"
    }
  ];
}

function statusFor({
  writeReceipt,
  trainingReadiness,
  featureTableDeclared
}: {
  writeReceipt: DecisionOddsSnapshotWriteReceipt;
  trainingReadiness: TrainingReadiness;
  featureTableDeclared: boolean;
}): DecisionOddsFeatureReadinessStatus {
  if (writeReceipt.status !== "stored") return "waiting-odds-write";
  if (!featureTableDeclared || trainingReadiness.status === "blocked") return "blocked-training-proof";
  if (trainingReadiness.totals.realOddsSnapshots === 0 || trainingReadiness.totals.featureSnapshots === 0) return "needs-training-corpus";
  return "ready-feature-shadow-review";
}

function summaryFor(status: DecisionOddsFeatureReadinessStatus, oddsRows: number): string {
  if (status === "ready-feature-shadow-review") return `Stored odds can feed shadow feature review from ${oddsRows} odds row(s); training remains locked.`;
  if (status === "needs-training-corpus") return "Stored odds exist, but the broader training corpus still needs feature snapshots, labels, and backtests.";
  if (status === "blocked-training-proof") return "Odds feature readiness is blocked by training schema or Supabase proof.";
  return "Odds feature readiness is waiting for a stored odds snapshot write receipt.";
}

function nextTurnFor(status: DecisionOddsFeatureReadinessStatus): DecisionOddsFeatureReadiness["nextTurn"] {
  if (status === "ready-feature-shadow-review" || status === "needs-training-corpus") {
    return {
      label: "Review training readiness before feature generation",
      command: decisionCurlCommand("/api/sports/decision/training/readiness"),
      verifyUrl: "/api/sports/decision/training/readiness",
      safeToRun: true,
      requiresAdminHeader: false
    };
  }
  if (status === "blocked-training-proof") {
    return {
      label: "Prove training feature schema",
      command: decisionCurlCommand("/api/sports/decision/supabase-schema-manifest"),
      verifyUrl: "/api/sports/decision/supabase-schema-manifest",
      safeToRun: true,
      requiresAdminHeader: false
    };
  }
  return {
    label: "Store bookmaker odds snapshots first",
    command: null,
    verifyUrl: "/api/sports/decision/odds-snapshot-write-receipt",
    safeToRun: false,
    requiresAdminHeader: true
  };
}

function gate(input: DecisionOddsFeatureReadinessGate): DecisionOddsFeatureReadinessGate {
  return input;
}

export function buildDecisionOddsFeatureReadiness({
  writeReceipt,
  trainingBlueprint,
  trainingReadiness,
  now = new Date()
}: {
  writeReceipt: DecisionOddsSnapshotWriteReceipt;
  trainingBlueprint: TrainingDataBlueprint;
  trainingReadiness: TrainingReadiness;
  now?: Date;
}): DecisionOddsFeatureReadiness {
  const featureTableDeclared = trainingBlueprint.storageTables.some((table) => table.table === "op_training_feature_snapshots");
  const status = statusFor({ writeReceipt, trainingReadiness, featureTableDeclared });
  const nextTurn = nextTurnFor(status);
  const candidateFeatureRows = writeReceipt.status === "stored" ? writeReceipt.observation.normalizedFixtures : 0;
  const storedOddsReady = writeReceipt.status === "stored" && writeReceipt.observation.oddsRows > 0 && writeReceipt.observation.rowsWritten > 0;
  const gates = [
    gate({
      id: "stored-odds",
      label: "Stored odds receipt",
      status: storedOddsReady ? "pass" : writeReceipt.observation.attempted ? "block" : "watch",
      evidence: `${writeReceipt.status}; oddsRows=${writeReceipt.observation.oddsRows}; rowsWritten=${writeReceipt.observation.rowsWritten}.`,
      nextAction: storedOddsReady ? "Use stored odds only for shadow feature review." : "Complete the guarded odds snapshot write receipt first."
    }),
    gate({
      id: "feature-table",
      label: "Feature snapshot table",
      status: featureTableDeclared ? "pass" : "block",
      evidence: featureTableDeclared ? "op_training_feature_snapshots is declared in the training blueprint." : "Training feature table is missing from the blueprint.",
      nextAction: featureTableDeclared ? "Keep feature rows server-only and supervised." : "Repair the training data blueprint and schema manifest."
    }),
    gate({
      id: "snapshot-slots",
      label: "Opening, pre-kickoff, and closing slots",
      status: storedOddsReady && writeReceipt.observation.oddsRows >= 3 ? "watch" : "block",
      evidence: `${writeReceipt.observation.oddsRows} stored odds row(s); complete CLV needs opening, pre-kickoff, and closing coverage.`,
      nextAction: "Do not calculate CLV until closing snapshots exist for the same fixture, bookmaker, market, and selection."
    }),
    gate({
      id: "market-features",
      label: "Market feature formulas",
      status: "pass",
      evidence: `${features().length} formulas map op_odds_snapshots into model feature candidates.`,
      nextAction: "Review formulas in shadow mode before writing op_training_feature_snapshots."
    }),
    gate({
      id: "corpus-volume",
      label: "Training corpus volume",
      status: trainingReadiness.totals.realOddsSnapshots >= 2000 ? "pass" : trainingReadiness.totals.realOddsSnapshots > 0 ? "watch" : "block",
      evidence: `${trainingReadiness.totals.realOddsSnapshots} real odds snapshot(s), ${trainingReadiness.totals.featureSnapshots} feature snapshot(s), ${trainingReadiness.totals.backtestRuns} backtest run(s).`,
      nextAction: "Backfill enough real odds, feature snapshots, labels, and backtests before model training."
    }),
    gate({
      id: "training-lock",
      label: "Training lock",
      status: "pass",
      evidence: "This packet cannot generate feature snapshots, train models, use learned weights, publish picks, or stake.",
      nextAction: "Use separate admin receipts for feature generation and backtesting after corpus proof passes."
    })
  ];
  const readinessHash = stableHash({
    status,
    write: writeReceipt.receiptHash,
    blueprint: trainingBlueprint.blueprintHash,
    training: trainingReadiness.readinessHash,
    gates: gates.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: writeReceipt.date,
    sport: "football",
    mode: "decision-odds-feature-readiness",
    status,
    readinessHash,
    summary: summaryFor(status, writeReceipt.observation.oddsRows),
    input: {
      writeReceiptHash: writeReceipt.receiptHash,
      writeStatus: writeReceipt.status,
      trainingBlueprintHash: trainingBlueprint.blueprintHash,
      trainingReadinessHash: trainingReadiness.readinessHash,
      oddsRows: writeReceipt.observation.oddsRows,
      rowsWritten: writeReceipt.observation.rowsWritten,
      candidateFeatureRows
    },
    target: {
      sourceTable: "op_odds_snapshots",
      targetTable: "op_training_feature_snapshots",
      featureTableDeclared,
      realOddsSnapshots: trainingReadiness.totals.realOddsSnapshots,
      featureSnapshots: trainingReadiness.totals.featureSnapshots,
      backtestRuns: trainingReadiness.totals.backtestRuns
    },
    features: features(),
    gates,
    nextTurn,
    controls: {
      canInspectReadOnly: true,
      canUseStoredOddsForFeatureReview: storedOddsReady,
      canGenerateTrainingFeatureSnapshots: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canUseLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/odds-feature-readiness",
      "/api/sports/decision/odds-snapshot-write-receipt",
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/training/data-blueprint",
      "/api/sports/decision/training/corpus-proof",
      nextTurn.verifyUrl,
      ...writeReceipt.proofUrls,
      ...trainingReadiness.proofUrls,
      ...trainingBlueprint.proofUrls
    ]),
    locks: unique([
      "Odds feature readiness is read-only and cannot write op_training_feature_snapshots.",
      "Stored odds can only become model features after feature-generation and backtest receipts are separately proven.",
      "CLV features require closing snapshots; a single odds write does not prove closing-line coverage.",
      "No training, learned-weight use, probability adjustment, confidence raise, public pick, stake, or public-action upgrade is allowed from this packet.",
      ...writeReceipt.locks
    ])
  };
}
