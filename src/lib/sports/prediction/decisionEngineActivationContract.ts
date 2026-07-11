import type { DecisionAILiveCycleReceipt } from "@/lib/sports/prediction/decisionAILiveCycleReceipt";
import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionEplPreKickoffRehearsal } from "@/lib/sports/prediction/decisionEplPreKickoffRehearsal";
import type { DecisionLaunchState } from "@/lib/sports/prediction/decisionLaunchState";
import type { DecisionMarketAuditMatrix } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import type { DecisionModelMathProof } from "@/lib/sports/prediction/decisionModelMathProof";
import type { DecisionShadowBacktestLedger } from "@/lib/sports/prediction/decisionShadowBacktestLedger";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionEngineActivationStatus = "blocked-storage" | "needs-evidence" | "shadow-only" | "ai-review-ready";
export type DecisionEngineActivationGateStatus = "pass" | "watch" | "block";
export type DecisionEngineActivationGateId =
  | "storage-data"
  | "fixture-context"
  | "model-math"
  | "market-edge"
  | "ai-review"
  | "shadow-backtest"
  | "public-lock";

export type DecisionEngineActivationGate = {
  id: DecisionEngineActivationGateId;
  label: string;
  status: DecisionEngineActivationGateStatus;
  score: number;
  detail: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionEngineActivationContract = {
  mode: "decision-engine-activation-contract";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionEngineActivationStatus;
  contractHash: string;
  summary: string;
  readinessScore: number;
  gates: DecisionEngineActivationGate[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  allowedActions: {
    canInspectReadOnly: true;
    canRehearseFixtures: boolean;
    canRunReadOnlyProof: boolean;
    canRunProviderDryRun: boolean;
    canRequestAIReview: boolean;
    canDisplayShadowCandidate: boolean;
  };
  forbiddenActions: {
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
  };
  totals: {
    gates: number;
    pass: number;
    watch: number;
    block: number;
    positiveEvSelections: number;
    openingFixtures: number;
    storageVerified: number;
    storageExpected: number;
    daysUntilEplStart: number;
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 50): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function gate(input: Omit<DecisionEngineActivationGate, "score"> & { score?: number }): DecisionEngineActivationGate {
  const statusScore = input.status === "pass" ? 100 : input.status === "watch" ? 55 : 0;
  return {
    ...input,
    score: input.score ?? statusScore,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction)
  };
}

function statusFromGates(gates: DecisionEngineActivationGate[], aiLiveCycleReceipt: DecisionAILiveCycleReceipt): DecisionEngineActivationStatus {
  if (gates.find((item) => item.id === "storage-data")?.status === "block") return "blocked-storage";
  if (gates.some((item) => item.status === "block")) return "needs-evidence";
  if (aiLiveCycleReceipt.status === "ready-live-review" || aiLiveCycleReceipt.status === "reviewed") return "ai-review-ready";
  return "shadow-only";
}

function summaryFor(status: DecisionEngineActivationStatus): string {
  if (status === "ai-review-ready") return "Decision engine is ready for guarded AI review, but public picks, writes, training, and staking remain locked.";
  if (status === "shadow-only") return "Decision engine can run in shadow/read-only mode while waiting for stronger proof before public action.";
  if (status === "blocked-storage") return "Decision engine activation is blocked first by storage proof; provider writes, training, and persistence cannot open.";
  return "Decision engine activation needs more evidence before AI review or shadow candidates can be trusted.";
}

function readinessScore(gates: DecisionEngineActivationGate[]): number {
  const weights: Record<DecisionEngineActivationGateId, number> = {
    "storage-data": 24,
    "fixture-context": 14,
    "model-math": 16,
    "market-edge": 16,
    "ai-review": 12,
    "shadow-backtest": 12,
    "public-lock": 6
  };
  const max = gates.reduce((sum, item) => sum + weights[item.id], 0);
  const scored = gates.reduce((sum, item) => sum + weights[item.id] * (item.score / 100), 0);
  return Math.round((scored / Math.max(1, max)) * 100);
}

function nextAction(gates: DecisionEngineActivationGate[]): DecisionEngineActivationContract["nextAction"] {
  const next = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? gates[0];
  const verifyUrl = next?.proofUrl ?? "/api/sports/decision/engine-activation-contract";
  return {
    label: next?.label ?? "Inspect activation contract",
    command: decisionCurlCommand(verifyUrl),
    verifyUrl,
    safeToRun: true,
    expectedEvidence: next?.nextAction ?? "Engine activation contract returns the current read-only capability posture."
  };
}

export function buildDecisionEngineActivationContract({
  date,
  sport,
  dataBackbone,
  eplPreKickoffRehearsal,
  launchState,
  trustFirewall,
  aiLiveCycleReceipt,
  shadowBacktestLedger,
  marketAuditMatrix,
  modelMathProof,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataBackbone: DecisionDataBackbone;
  eplPreKickoffRehearsal: DecisionEplPreKickoffRehearsal;
  launchState: DecisionLaunchState;
  trustFirewall: DecisionTrustFirewall;
  aiLiveCycleReceipt: DecisionAILiveCycleReceipt;
  shadowBacktestLedger: DecisionShadowBacktestLedger;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  modelMathProof: DecisionModelMathProof;
  now?: Date;
}): DecisionEngineActivationContract {
  const storageStatus: DecisionEngineActivationGateStatus =
    dataBackbone.status === "blocked-credentials" || dataBackbone.status === "blocked-cross-project" || dataBackbone.status === "needs-storage-proof"
      ? "block"
      : dataBackbone.status === "ready-provider-dry-run"
        ? "pass"
        : "watch";
  const fixtureStatus: DecisionEngineActivationGateStatus =
    eplPreKickoffRehearsal.status === "blocked-storage"
      ? "block"
      : eplPreKickoffRehearsal.status === "ready-read-only"
        ? "pass"
        : "watch";
  const mathStatus: DecisionEngineActivationGateStatus =
    modelMathProof.status === "ready-proof" && !modelMathProof.checks.some((check) => check.status === "blocked")
      ? "pass"
      : modelMathProof.status === "blocked"
        ? "block"
        : "watch";
  const marketStatus: DecisionEngineActivationGateStatus =
    marketAuditMatrix.status === "positive-ev" ? "pass" : marketAuditMatrix.status === "watch" ? "watch" : "block";
  const aiStatus: DecisionEngineActivationGateStatus =
    aiLiveCycleReceipt.status === "reviewed" || aiLiveCycleReceipt.status === "ready-live-review"
      ? "pass"
      : aiLiveCycleReceipt.status === "blocked"
        ? "block"
        : "watch";
  const backtestStatus: DecisionEngineActivationGateStatus =
    shadowBacktestLedger.status === "ready-shadow"
      ? "pass"
      : shadowBacktestLedger.status === "blocked" || shadowBacktestLedger.status === "needs-storage"
        ? "block"
        : "watch";
  const publicLockStatus: DecisionEngineActivationGateStatus =
    trustFirewall.status === "blocked" ? "block" : trustFirewall.status === "watchlist-only" ? "watch" : "pass";
  const gates = [
    gate({
      id: "storage-data",
      label: "Storage and data backbone",
      status: storageStatus,
      detail: `${dataBackbone.status.replaceAll("-", " ")} with ${dataBackbone.totals.storageTablesLiveVerified}/${dataBackbone.totals.storageTablesExpected} storage tables verified.`,
      nextAction: dataBackbone.nextAction.expectedEvidence,
      proofUrl: "/api/sports/decision/data-backbone"
    }),
    gate({
      id: "fixture-context",
      label: "Fixture and context rehearsal",
      status: fixtureStatus,
      detail: `${eplPreKickoffRehearsal.status.replaceAll("-", " ")} across ${eplPreKickoffRehearsal.totals.openingFixtures} EPL opening fixtures with ${eplPreKickoffRehearsal.totals.blockedSignals} blocked signal(s).`,
      nextAction: eplPreKickoffRehearsal.fixtures[0]?.nextAction.expectedEvidence ?? eplPreKickoffRehearsal.summary,
      proofUrl: "/api/sports/decision/epl-pre-kickoff-rehearsal"
    }),
    gate({
      id: "model-math",
      label: "Model math proof",
      status: mathStatus,
      detail: `${modelMathProof.status.replaceAll("-", " ")} for ${modelMathProof.totals.sports} sport model(s), ${modelMathProof.totals.markets} market(s), and ${modelMathProof.totals.formulas} formula(s).`,
      nextAction: modelMathProof.checks.find((check) => check.status !== "pass")?.detail ?? modelMathProof.summary,
      proofUrl: "/api/sports/decision/model-math-proof"
    }),
    gate({
      id: "market-edge",
      label: "Market edge and EV",
      status: marketStatus,
      detail: `${marketAuditMatrix.totals.positiveEv} positive-EV selection(s), ${marketAuditMatrix.totals.watch} watch row(s), best EV ${marketAuditMatrix.totals.bestExpectedValue ?? "none"}.`,
      nextAction: marketAuditMatrix.locks[1] ?? marketAuditMatrix.summary,
      proofUrl: "/api/sports/decision/market-audit-matrix"
    }),
    gate({
      id: "ai-review",
      label: "Guarded AI review",
      status: aiStatus,
      detail: `${aiLiveCycleReceipt.status.replaceAll("-", " ")} using ${aiLiveCycleReceipt.model}; next action ${aiLiveCycleReceipt.nextSafeAction.label}.`,
      nextAction: aiLiveCycleReceipt.nextSafeAction.expectedEvidence,
      proofUrl: "/api/sports/decision/ai-live-cycle-receipt"
    }),
    gate({
      id: "shadow-backtest",
      label: "Shadow backtest ledger",
      status: backtestStatus,
      detail: `${shadowBacktestLedger.status.replaceAll("-", " ")} with ${shadowBacktestLedger.sample.candidates} candidate(s), ${shadowBacktestLedger.historicalBacktest.sampleSize} historical backtest row(s), and ${shadowBacktestLedger.calibration.sampleSize} calibration row(s).`,
      nextAction: shadowBacktestLedger.nextSafeAction.expectedEvidence,
      proofUrl: "/api/sports/decision/shadow-backtest-ledger"
    }),
    gate({
      id: "public-lock",
      label: "Public action lock",
      status: publicLockStatus,
      detail: `Maximum public action is ${trustFirewall.actionContract.maximumPublicAction}; launch posture is ${launchState.posture.publicAction}.`,
      nextAction:
        publicLockStatus === "block"
          ? trustFirewall.actionContract.reason
          : "Keep public picks, staking, persistence, training, learned weights, and provider writes locked until every upstream proof passes and an operator explicitly unlocks them.",
      proofUrl: "/api/sports/decision/trust-firewall"
    })
  ];
  const status = statusFromGates(gates, aiLiveCycleReceipt);
  const score = readinessScore(gates);
  const contractHash = stableHash({
    date,
    sport,
    status,
    score,
    gates: gates.map((item) => [item.id, item.status, item.score]),
    hashes: [
      dataBackbone.backboneHash,
      eplPreKickoffRehearsal.rehearsalHash,
      launchState.stateHash,
      trustFirewall.firewallHash,
      aiLiveCycleReceipt.receiptHash,
      shadowBacktestLedger.ledgerHash,
      marketAuditMatrix.matrixHash,
      modelMathProof.proofHash
    ]
  });

  return {
    mode: "decision-engine-activation-contract",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    contractHash,
    summary: summaryFor(status),
    readinessScore: score,
    gates,
    nextAction: nextAction(gates),
    allowedActions: {
      canInspectReadOnly: true,
      canRehearseFixtures: eplPreKickoffRehearsal.controls.canInspectReadOnly,
      canRunReadOnlyProof: launchState.controls.canRunNextProof || aiLiveCycleReceipt.controls.canRunNextSafeCommand,
      canRunProviderDryRun: dataBackbone.controls.canRunProviderDryRun && eplPreKickoffRehearsal.controls.canRunFixtureDryRun,
      canRequestAIReview: launchState.controls.canRunOpenAIReview && aiLiveCycleReceipt.controls.canRequestLiveReview,
      canDisplayShadowCandidate: trustFirewall.controls.canDisplayInternalCandidate && marketAuditMatrix.totals.positiveEv > 0
    },
    forbiddenActions: {
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    totals: {
      gates: gates.length,
      pass: gates.filter((item) => item.status === "pass").length,
      watch: gates.filter((item) => item.status === "watch").length,
      block: gates.filter((item) => item.status === "block").length,
      positiveEvSelections: marketAuditMatrix.totals.positiveEv,
      openingFixtures: eplPreKickoffRehearsal.totals.openingFixtures,
      storageVerified: dataBackbone.totals.storageTablesLiveVerified,
      storageExpected: dataBackbone.totals.storageTablesExpected,
      daysUntilEplStart: eplPreKickoffRehearsal.totals.daysUntilStart
    },
    locks: unique([
      "This contract is read-only and cannot unlock provider writes, persistence, training, public picks, staking, or hidden chain-of-thought.",
      ...dataBackbone.locks,
      ...eplPreKickoffRehearsal.locks,
      ...trustFirewall.locks,
      ...aiLiveCycleReceipt.locks,
      ...shadowBacktestLedger.locks
    ]),
    proofUrls: unique([
      "/api/sports/decision/engine-activation-contract",
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/epl-pre-kickoff-rehearsal",
      "/api/sports/decision/model-math-proof",
      "/api/sports/decision/market-audit-matrix",
      "/api/sports/decision/ai-live-cycle-receipt",
      "/api/sports/decision/shadow-backtest-ledger",
      "/api/sports/decision/trust-firewall",
      ...launchState.proofUrls
    ])
  };
}
