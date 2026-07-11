import type { DecisionMarketAuditMatrix } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import type { DecisionModelMathProof, DecisionModelMathSportProof } from "@/lib/sports/prediction/decisionModelMathProof";
import type { DecisionOddsIntelligenceProof, DecisionOddsIntelligenceProofSelection } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import type { TrainingReadiness, TrainingReadinessSport } from "@/lib/sports/training/trainingReadiness";

export type DecisionModelReasoningLedgerStatus = "ready-shadow" | "needs-training" | "needs-provider" | "blocked";
export type DecisionModelReasoningStepStatus = "pass" | "watch" | "block";

export type DecisionModelReasoningStep = {
  id: "math-prior" | "market-edge" | "training-readiness" | "risk-context" | "action-lock";
  label: string;
  status: DecisionModelReasoningStepStatus;
  evidenceHash: string | null;
  detail: string;
  nextAction: string;
};

export type DecisionModelReasoningSport = {
  sport: DecisionMultiSport;
  status: DecisionModelReasoningLedgerStatus;
  modelVersion: string;
  matches: number;
  dataQuality: number;
  formulas: string[];
  requiredInputs: string[];
  missingOrProxyInputs: string[];
  trainingStatus: TrainingReadinessSport["status"] | null;
  trainingReadinessScore: number | null;
  bestEdge: number | null;
  bestExpectedValue: number | null;
  topSelection: string | null;
  nextAction: string;
};

export type DecisionModelReasoningExample = {
  sport: DecisionMultiSport;
  matchId: string;
  match: string;
  modelVersion: string;
  expectedScore: string;
  topOutcome: string;
  bestSelection: string | null;
  modelProbability: number | null;
  noVigProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  whyModelFavorsIt: string | null;
  risk: string | null;
  saferAlternatives: string[];
  proofUrl: string;
};

export type DecisionModelReasoningLedger = {
  generatedAt: string;
  mode: "model-reasoning-ledger";
  status: DecisionModelReasoningLedgerStatus;
  ledgerHash: string;
  summary: string;
  totals: {
    sports: number;
    matches: number;
    formulas: number;
    positiveEv: number;
    watch: number;
    avoid: number;
    trainableSports: number;
    fixtureDeficit: number;
    oddsDeficit: number;
    backtestDeficit: number;
  };
  sports: DecisionModelReasoningSport[];
  reasoningSteps: DecisionModelReasoningStep[];
  examples: DecisionModelReasoningExample[];
  nextSafeCommand: {
    label: string;
    command: string | null;
    expectedEvidence: string;
    safeToRun: boolean;
  };
  controls: {
    canInspectReadOnly: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUseLearnedWeights: false;
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

function round(value: number | null | undefined, digits = 4): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function compact(value: string | null | undefined, maxLength = 240): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusFromSport({
  sportProof,
  trainingSport,
  topEdge
}: {
  sportProof: DecisionModelMathSportProof;
  trainingSport: TrainingReadinessSport | null;
  topEdge: DecisionOddsIntelligenceProofSelection | null;
}): DecisionModelReasoningLedgerStatus {
  if (sportProof.status === "blocked") return "blocked";
  if (sportProof.status === "needs-provider" || sportProof.proxyOrMissingInputs.length) return "needs-provider";
  if (!trainingSport || trainingSport.status === "waiting-corpus" || trainingSport.status === "blocked") return "needs-training";
  return topEdge ? "ready-shadow" : "needs-training";
}

function step(input: DecisionModelReasoningStep): DecisionModelReasoningStep {
  return {
    ...input,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction, 220)
  };
}

function ledgerStatus(sports: DecisionModelReasoningSport[], steps: DecisionModelReasoningStep[]): DecisionModelReasoningLedgerStatus {
  if (steps.some((item) => item.status === "block") || sports.some((sport) => sport.status === "blocked")) return "blocked";
  if (sports.some((sport) => sport.status === "needs-provider")) return "needs-provider";
  if (sports.some((sport) => sport.status === "needs-training") || steps.some((item) => item.status === "watch")) return "needs-training";
  return "ready-shadow";
}

function summaryFor(status: DecisionModelReasoningLedgerStatus, totals: DecisionModelReasoningLedger["totals"]): string {
  if (status === "ready-shadow") return `Model reasoning is ready for shadow review across ${totals.sports} sport(s), with positive EV still gated from public publishing.`;
  if (status === "needs-provider") return "Model reasoning is explainable, but provider-backed inputs are still missing or proxy-backed.";
  if (status === "blocked") return "Model reasoning is blocked because required math, markets, or safety checks are missing.";
  return `Model reasoning is explainable, but training needs more corpus evidence: ${totals.fixtureDeficit} fixture labels, ${totals.oddsDeficit} odds snapshots, and ${totals.backtestDeficit} backtest run(s).`;
}

function exampleForSelection({
  selection,
  modelMathProof
}: {
  selection: DecisionOddsIntelligenceProofSelection;
  modelMathProof: DecisionModelMathProof;
}): DecisionModelReasoningExample {
  const mathExample = modelMathProof.examples.find((example) => example.matchId === selection.matchId);
  return {
    sport: selection.sport as DecisionMultiSport,
    matchId: selection.matchId,
    match: selection.match,
    modelVersion: mathExample?.modelVersion ?? "unknown-model",
    expectedScore: mathExample?.expectedScore ?? "No score projection available.",
    topOutcome: mathExample?.topOutcome ?? selection.verdict,
    bestSelection: selection.selection,
    modelProbability: round(selection.modelProbability),
    noVigProbability: round(selection.noVigProbability),
    edge: round(selection.edge),
    expectedValue: round(selection.expectedValue),
    whyModelFavorsIt: compact(selection.whyModelLikesIt, 220),
    risk: compact(selection.risks[0] ?? selection.avoidReason),
    saferAlternatives: selection.saferAlternatives,
    proofUrl: selection.verifyUrl
  };
}

export function buildDecisionModelReasoningLedger({
  modelMathProof,
  marketAuditMatrix,
  oddsIntelligenceProof,
  trainingReadiness,
  now = new Date()
}: {
  modelMathProof: DecisionModelMathProof;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  trainingReadiness: TrainingReadiness;
  now?: Date;
}): DecisionModelReasoningLedger {
  const sports = modelMathProof.sports.map((sportProof) => {
    const trainingSport = trainingReadiness.sports.find((item) => item.sport === sportProof.sport) ?? null;
    const topEdge = oddsIntelligenceProof.topEdges.find((item) => item.sport === sportProof.sport) ?? null;
    const sportStatus = statusFromSport({ sportProof, trainingSport, topEdge });
    return {
      sport: sportProof.sport,
      status: sportStatus,
      modelVersion: sportProof.modelVersion,
      matches: sportProof.matches,
      dataQuality: sportProof.averageDataQuality,
      formulas: sportProof.formulas.map((formula) => formula.label),
      requiredInputs: sportProof.requiredInputs,
      missingOrProxyInputs: sportProof.proxyOrMissingInputs,
      trainingStatus: trainingSport?.status ?? null,
      trainingReadinessScore: trainingSport?.readinessScore ?? null,
      bestEdge: round(topEdge?.edge),
      bestExpectedValue: round(topEdge?.expectedValue),
      topSelection: topEdge ? `${topEdge.marketName}: ${topEdge.selection}` : null,
      nextAction:
        sportStatus === "ready-shadow"
          ? "Keep the edge in shadow review until backtest, CLV, and publish gates are separately proven."
          : sportStatus === "needs-provider"
            ? sportProof.proxyOrMissingInputs[0] ?? "Replace proxy model inputs with provider-backed evidence."
            : trainingSport?.nextAction ?? trainingReadiness.nextSafeCommand.expectedEvidence
    };
  });

  const totals: DecisionModelReasoningLedger["totals"] = {
    sports: modelMathProof.totals.sports,
    matches: modelMathProof.totals.matches,
    formulas: modelMathProof.totals.formulas,
    positiveEv: marketAuditMatrix.totals.positiveEv,
    watch: marketAuditMatrix.totals.watch,
    avoid: marketAuditMatrix.totals.avoid,
    trainableSports: trainingReadiness.totals.trainableSports,
    fixtureDeficit: trainingReadiness.totals.fixtureDeficit,
    oddsDeficit: trainingReadiness.totals.oddsDeficit,
    backtestDeficit: trainingReadiness.totals.backtestDeficit
  };

  const reasoningSteps = [
    step({
      id: "math-prior",
      label: "Model prior",
      status: modelMathProof.status === "blocked" ? "block" : modelMathProof.status === "ready-proof" ? "pass" : "watch",
      evidenceHash: modelMathProof.proofHash,
      detail: modelMathProof.summary,
      nextAction: modelMathProof.locks[1] ?? "Keep model math read-only until provider evidence is proven."
    }),
    step({
      id: "market-edge",
      label: "Market edge",
      status: oddsIntelligenceProof.status === "blocked" ? "block" : oddsIntelligenceProof.totals.positiveValue > 0 ? "pass" : "watch",
      evidenceHash: oddsIntelligenceProof.proofHash,
      detail: oddsIntelligenceProof.summary,
      nextAction: oddsIntelligenceProof.totals.positiveValue > 0 ? "Rank positive EV selections, but keep public action locked." : "Wait for priced markets with positive no-vig edge and EV."
    }),
    step({
      id: "training-readiness",
      label: "Training readiness",
      status:
        trainingReadiness.status === "trainable-shadow"
          ? "pass"
          : trainingReadiness.status === "backfill-ready" || trainingReadiness.status === "waiting-corpus"
            ? "watch"
            : "block",
      evidenceHash: trainingReadiness.readinessHash,
      detail: trainingReadiness.summary,
      nextAction: trainingReadiness.nextSafeCommand.expectedEvidence
    }),
    step({
      id: "risk-context",
      label: "Risk context",
      status: marketAuditMatrix.status === "blocked" ? "block" : marketAuditMatrix.totals.watch || marketAuditMatrix.totals.avoid ? "watch" : "pass",
      evidenceHash: marketAuditMatrix.matrixHash,
      detail: marketAuditMatrix.summary,
      nextAction: "Require injury/news/weather/context proof before any model edge can become public action."
    }),
    step({
      id: "action-lock",
      label: "Action lock",
      status: "pass",
      evidenceHash: stableHash([modelMathProof.controls, marketAuditMatrix.controls, oddsIntelligenceProof.controls, trainingReadiness.controls]),
      detail: "Model reasoning is read-only: no persistence, publishing, staking, training, learned weights, or public action upgrade.",
      nextAction: "Promote only after provider data, historical labels, backtests, CLV, and governance receipts pass."
    })
  ];
  const status = ledgerStatus(sports, reasoningSteps);

  return {
    generatedAt: now.toISOString(),
    mode: "model-reasoning-ledger",
    status,
    ledgerHash: stableHash({
      status,
      math: modelMathProof.proofHash,
      market: marketAuditMatrix.matrixHash,
      odds: oddsIntelligenceProof.proofHash,
      training: trainingReadiness.readinessHash,
      sports: sports.map((sport) => [sport.sport, sport.status, sport.modelVersion, sport.bestExpectedValue])
    }),
    summary: summaryFor(status, totals),
    totals,
    sports,
    reasoningSteps,
    examples: oddsIntelligenceProof.topEdges.slice(0, 6).map((selection) => exampleForSelection({ selection, modelMathProof })),
    nextSafeCommand: {
      label: trainingReadiness.nextSafeCommand.label,
      command: trainingReadiness.nextSafeCommand.safeToRun ? trainingReadiness.nextSafeCommand.command : null,
      expectedEvidence: trainingReadiness.nextSafeCommand.expectedEvidence,
      safeToRun: trainingReadiness.nextSafeCommand.safeToRun
    },
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseLearnedWeights: false,
      canUpgradePublicAction: false
    },
    proofUrls: [
      "/api/sports/decision/model-reasoning-ledger",
      "/api/sports/decision/model-math-proof",
      "/api/sports/decision/market-audit-matrix",
      "/api/sports/decision/odds-intelligence-proof",
      "/api/sports/decision/training/readiness"
    ],
    locks: unique([
      ...modelMathProof.locks,
      ...oddsIntelligenceProof.locks,
      "Reasoning ledger cannot publish picks, stake, train, persist, or apply learned weights."
    ])
  };
}
