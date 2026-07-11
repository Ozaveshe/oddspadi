import type { DecisionAgentOperationQueue } from "@/lib/sports/prediction/decisionAgentOperationQueue";
import type { DecisionAgentThoughtBoard } from "@/lib/sports/prediction/decisionAgentThoughtBoard";
import type { DecisionBayesianBeliefLedger } from "@/lib/sports/prediction/decisionBayesianBeliefLedger";
import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionEvidenceAcquisitionPlanner } from "@/lib/sports/prediction/decisionEvidenceAcquisitionPlanner";
import type { DecisionLaunchState } from "@/lib/sports/prediction/decisionLaunchState";
import type { DecisionModelMathProof } from "@/lib/sports/prediction/decisionModelMathProof";
import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionProviderLearningBridge } from "@/lib/sports/prediction/decisionProviderLearningBridge";
import type { DecisionRequirementPulse } from "@/lib/sports/prediction/decisionRequirementPulse";
import type { SupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionCognitiveKernelStatus = "ready-shadow" | "waiting-openai-quota" | "needs-evidence" | "blocked";
export type DecisionCognitiveKernelPhaseStatus = "pass" | "watch" | "block";
export type DecisionCognitiveKernelPhaseId = "observe" | "model" | "market" | "context" | "challenge" | "decide" | "act" | "learn";

export type DecisionCognitiveKernelPhase = {
  id: DecisionCognitiveKernelPhaseId;
  label: string;
  status: DecisionCognitiveKernelPhaseStatus;
  signal: string;
  evidence: Array<string | null | undefined>;
  nextAction: string;
};

export type DecisionCognitiveKernelHypothesis = {
  id: string;
  status: DecisionCognitiveKernelPhaseStatus;
  score: number;
  thesis: string;
  supports: Array<string | null | undefined>;
  challenges: Array<string | null | undefined>;
  falsifier: string;
  proofUrl: string;
};

export type DecisionCognitiveKernel = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "cognitive-kernel";
  status: DecisionCognitiveKernelStatus;
  kernelHash: string;
  summary: string;
  focus: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    action: DecisionAction | "hold";
    confidenceScore: number;
  };
  state: {
    workingHypothesis: string;
    strongestObjection: string;
    confidenceCeiling: "candidate" | "monitor" | "shadow" | "none";
    evidenceDebt: number;
    consensusScore: number;
    contradictionCount: number;
    openAiState: DecisionOpenAILiveReviewReceipt["status"];
    beliefLedgerState: DecisionBayesianBeliefLedger["status"];
    acquisitionState: DecisionEvidenceAcquisitionPlanner["status"];
    providerLearningState: DecisionProviderLearningBridge["status"] | "not-attached";
    corpusMemoryState: SupabaseTrainingCorpusCensus["status"] | "not-attached";
  };
  phases: DecisionCognitiveKernelPhase[];
  hypotheses: DecisionCognitiveKernelHypothesis[];
  finalDirective: {
    action: "inspect-proof" | "run-readonly-proof" | "wait-openai-quota" | "repair-evidence" | "hold";
    publicStance: "consider-shadow" | "monitor-only" | "avoid";
    reason: string;
    command: string | null;
    verifyUrl: string | null;
    expectedEvidence: string;
    canShowAsPick: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
  };
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyCommand: boolean;
    canAskOpenAI: boolean;
    canCompleteOpenAIReview: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function compact(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function phase(input: DecisionCognitiveKernelPhase): DecisionCognitiveKernelPhase {
  return {
    ...input,
    signal: compact(input.signal, 240),
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction, 220)
  };
}

function hypothesis(input: DecisionCognitiveKernelHypothesis): DecisionCognitiveKernelHypothesis {
  return {
    ...input,
    score: clamp(input.score),
    thesis: compact(input.thesis, 260),
    supports: unique(input.supports, 6),
    challenges: unique(input.challenges, 6),
    falsifier: compact(input.falsifier, 220)
  };
}

function statusFromScore(score: number): DecisionCognitiveKernelPhaseStatus {
  if (score >= 70) return "pass";
  if (score >= 38) return "watch";
  return "block";
}

function confidenceCeiling({
  agentThoughtBoard,
  dataAuthority,
  openAiLiveReviewReceipt
}: {
  agentThoughtBoard: DecisionAgentThoughtBoard;
  dataAuthority: DecisionDataAuthority;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
}): DecisionCognitiveKernel["state"]["confidenceCeiling"] {
  if (agentThoughtBoard.counts.block || dataAuthority.status === "blocked") return "none";
  if (openAiLiveReviewReceipt.status !== "reviewed") return "shadow";
  if (agentThoughtBoard.counts.watch || dataAuthority.trustScore < 70) return "monitor";
  return "candidate";
}

function publicStance(action: DecisionAction | "hold", ceiling: DecisionCognitiveKernel["state"]["confidenceCeiling"]): DecisionCognitiveKernel["finalDirective"]["publicStance"] {
  if (action === "avoid" || ceiling === "none") return "avoid";
  if (action === "consider" && ceiling === "candidate") return "consider-shadow";
  return "monitor-only";
}

function kernelStatus({
  agentThoughtBoard,
  openAiLiveReviewReceipt,
  phases
}: {
  agentThoughtBoard: DecisionAgentThoughtBoard;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  phases: DecisionCognitiveKernelPhase[];
}): DecisionCognitiveKernelStatus {
  if (phases.some((item) => item.status === "block") || agentThoughtBoard.status === "blocked") return "blocked";
  if (openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited") return "waiting-openai-quota";
  if (phases.some((item) => item.status === "watch") || agentThoughtBoard.status === "needs-evidence") return "needs-evidence";
  return "ready-shadow";
}

function corpusEvidenceDebtDelta(census: SupabaseTrainingCorpusCensus | null): number {
  if (!census) return 0;
  if (census.status === "ready-shadow-backtest") return -22;
  if (census.status === "ready-live-monitor") return -16;
  if (census.status === "partial-corpus") return -8;
  return 0;
}

function learningSignal({
  providerLearningBridge,
  supabaseTrainingCorpusCensus,
  requirementPulse
}: {
  providerLearningBridge: DecisionProviderLearningBridge | null;
  supabaseTrainingCorpusCensus: SupabaseTrainingCorpusCensus | null;
  requirementPulse: DecisionRequirementPulse;
}): string {
  const trainingGroup = requirementPulse.groups.find((item) => item.id === "training-data");
  if (providerLearningBridge && supabaseTrainingCorpusCensus) {
    return `${providerLearningBridge.summary} Stored corpus: ${supabaseTrainingCorpusCensus.summary}`;
  }
  return providerLearningBridge?.summary ?? supabaseTrainingCorpusCensus?.summary ?? trainingGroup?.evidence ?? "Training data gate is missing.";
}

function learningNextAction({
  providerLearningBridge,
  supabaseTrainingCorpusCensus,
  requirementPulse
}: {
  providerLearningBridge: DecisionProviderLearningBridge | null;
  supabaseTrainingCorpusCensus: SupabaseTrainingCorpusCensus | null;
  requirementPulse: DecisionRequirementPulse;
}): string {
  return (
    supabaseTrainingCorpusCensus?.nextAction.expectedEvidence ??
    providerLearningBridge?.learningImpact.nextAction ??
    requirementPulse.groups.find((item) => item.id === "training-data")?.nextAction ??
    "Prove corpus before any learned-weight training."
  );
}

export function buildDecisionCognitiveKernel({
  date,
  sport,
  dataAuthority,
  modelMathProof,
  oddsIntelligenceProof,
  beliefLedger,
  evidenceAcquisitionPlanner,
  agentThoughtBoard,
  agentOperationQueue,
  launchState,
  openAiLiveReviewReceipt,
  requirementPulse,
  providerLearningBridge = null,
  supabaseTrainingCorpusCensus = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  dataAuthority: DecisionDataAuthority;
  modelMathProof: DecisionModelMathProof;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  beliefLedger: DecisionBayesianBeliefLedger;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  agentThoughtBoard: DecisionAgentThoughtBoard;
  agentOperationQueue: DecisionAgentOperationQueue;
  launchState: DecisionLaunchState;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  requirementPulse: DecisionRequirementPulse;
  providerLearningBridge?: DecisionProviderLearningBridge | null;
  supabaseTrainingCorpusCensus?: SupabaseTrainingCorpusCensus | null;
  now?: Date;
}): DecisionCognitiveKernel {
  const sportMath = modelMathProof.sports.find((item) => item.sport === sport) ?? modelMathProof.sports[0] ?? null;
  const topEdge = oddsIntelligenceProof.topEdges.find((item) => item.sport === sport) ?? oddsIntelligenceProof.topEdges[0] ?? null;
  const activeBelief = beliefLedger.activeBelief;
  const topGap = requirementPulse.topGap;
  const blockedRoles = agentThoughtBoard.roles.filter((role) => role.status === "block");
  const watchRoles = agentThoughtBoard.roles.filter((role) => role.status === "watch");
  const ceiling = confidenceCeiling({ agentThoughtBoard, dataAuthority, openAiLiveReviewReceipt });
  const providerEvidenceDebtDelta = providerLearningBridge?.learningImpact.evidenceDebtDelta ?? 0;
  const corpusDebtDelta = corpusEvidenceDebtDelta(supabaseTrainingCorpusCensus);
  const evidenceDebt = clamp(
    100 -
      Math.round((dataAuthority.trustScore + modelMathProof.totals.averageDataQuality) / 2) +
      agentThoughtBoard.counts.block * 12 +
      agentThoughtBoard.counts.watch * 5 +
      providerEvidenceDebtDelta +
      corpusDebtDelta
  );
  const consensusScore = clamp(agentThoughtBoard.counts.roles ? (agentThoughtBoard.counts.support / agentThoughtBoard.counts.roles) * 100 - agentThoughtBoard.counts.block * 12 : 0);
  const contradictionCount = blockedRoles.length + oddsIntelligenceProof.topEdges.filter((item) => item.action === "avoid").length + requirementPulse.counts.blocked;
  const workingHypothesis =
    topEdge && agentThoughtBoard.focus.match
      ? `${agentThoughtBoard.focus.match}: ${topEdge.selection} is the current shadow hypothesis, but it must survive data, market, and AI review gates.`
      : agentThoughtBoard.focus.match
        ? `${agentThoughtBoard.focus.match} is the current focus, but evidence gates prevent a public pick.`
        : "No match has enough evidence to become a public decision.";
  const strongestObjection =
    blockedRoles[0]?.nextAction ??
    topGap?.nextAction ??
    topEdge?.avoidReason ??
    openAiLiveReviewReceipt.nextAction ??
    "Refresh proof before trust can rise.";

  const phases = [
    phase({
      id: "observe",
      label: "Observe evidence",
      status: dataAuthority.status === "blocked" ? "block" : dataAuthority.status === "dry-run-ready" || dataAuthority.status === "live-authorized" ? "pass" : "watch",
      signal: dataAuthority.summary,
      evidence: [dataAuthority.topFamily?.decisionImpact, `${dataAuthority.trustScore}/100 data trust`, dataAuthority.input.providerIngestionStatus],
      nextAction: dataAuthority.nextCommand.expectedEvidence
    }),
    phase({
      id: "model",
      label: "Model math",
      status: modelMathProof.status === "blocked" || sportMath?.status === "blocked" ? "block" : modelMathProof.status === "ready-proof" && sportMath?.status === "ready-proof" ? "pass" : "watch",
      signal: sportMath?.summary ?? modelMathProof.summary,
      evidence: [sportMath?.formulas.map((item) => item.label).join(", "), sportMath?.example?.expectedScore, `${modelMathProof.totals.normalizedWinnerMarkets} normalized winner markets`],
      nextAction: modelMathProof.checks.find((item) => item.status !== "pass")?.detail ?? "Keep model proof attached to the active decision."
    }),
    phase({
      id: "market",
      label: "Market edge",
      status: oddsIntelligenceProof.status === "blocked" ? "block" : oddsIntelligenceProof.totals.positiveValue ? "pass" : "watch",
      signal: oddsIntelligenceProof.summary,
      evidence: [topEdge?.verdict, topEdge?.whyModelLikesIt, topEdge ? `edge ${topEdge.edge}, EV ${topEdge.expectedValue}` : null],
      nextAction: topEdge?.avoidReason ?? topEdge?.saferAlternatives[0] ?? "Refresh odds and no-vig edge before any operator action."
    }),
    phase({
      id: "context",
      label: "Context and data gaps",
      status: topGap?.status === "blocked" ? "block" : topGap?.status === "watch" ? "watch" : "pass",
      signal: topGap ? `${topGap.label}: ${topGap.evidence}` : requirementPulse.summary,
      evidence: requirementPulse.groups.map((item) => `${item.label}: ${item.status}`),
      nextAction: topGap?.nextAction ?? "Keep all MVP requirement groups attached to the kernel."
    }),
    phase({
      id: "challenge",
      label: "Challenge thesis",
      status: blockedRoles.length ? "block" : watchRoles.length ? "watch" : "pass",
      signal: agentThoughtBoard.decision.rationale,
      evidence: agentThoughtBoard.roles.map((role) => `${role.label}: ${role.status}`),
      nextAction: strongestObjection
    }),
    phase({
      id: "decide",
      label: "Decide posture",
      status: ceiling === "none" ? "block" : ceiling === "candidate" ? "pass" : "watch",
      signal: `${publicStance(agentThoughtBoard.decision.finalAction, ceiling)} with ${ceiling} ceiling and ${beliefLedger.status.replaceAll("-", " ")} belief ledger.`,
      evidence: [
        launchState.posture.engineMode,
        launchState.posture.publicAction,
        `consensus ${consensusScore}/100`,
        activeBelief ? `posterior ${activeBelief.posteriorProbability ?? "n/a"}; pressure ${activeBelief.revisionPressure}/100` : null
      ],
      nextAction: activeBelief?.nextObservation ?? launchState.posture.nextProof ?? agentOperationQueue.nextOperation?.expectedEvidence ?? "Keep monitor-only posture."
    }),
    phase({
      id: "act",
      label: "Act safely",
      status: agentOperationQueue.controls.canRunReadOnlyCommand ? "pass" : agentOperationQueue.status === "blocked" ? "block" : "watch",
      signal: agentOperationQueue.summary,
      evidence: [agentOperationQueue.nextOperation?.label, agentOperationQueue.nextOperation?.verifyUrl, `${agentOperationQueue.totals.blocked} blocked operation(s)`],
      nextAction: agentOperationQueue.nextOperation?.expectedEvidence ?? "No safe operation selected."
    }),
    phase({
      id: "learn",
      label: "Learn later",
      status:
        providerLearningBridge?.status === "historical-proof-ready" ||
        supabaseTrainingCorpusCensus?.status === "partial-corpus" ||
        supabaseTrainingCorpusCensus?.status === "ready-live-monitor" ||
        supabaseTrainingCorpusCensus?.status === "ready-shadow-backtest"
          ? "watch"
          : requirementPulse.groups.find((item) => item.id === "training-data")?.status === "ready"
            ? "watch"
            : "block",
      signal: learningSignal({ providerLearningBridge, supabaseTrainingCorpusCensus, requirementPulse }),
      evidence: [
        providerLearningBridge ? `${providerLearningBridge.status}; ${providerLearningBridge.dryRun.normalized} normalized provider row(s)` : null,
        supabaseTrainingCorpusCensus
          ? `${supabaseTrainingCorpusCensus.status}; fixtures ${supabaseTrainingCorpusCensus.totals.fixtures}; odds ${supabaseTrainingCorpusCensus.totals.oddsSnapshots}; features ${supabaseTrainingCorpusCensus.totals.featureSnapshots}; backtests ${supabaseTrainingCorpusCensus.totals.completedBacktests}`
          : null,
        "Training, persistence, and learned-weight promotion remain locked.",
        openAiLiveReviewReceipt.summary
      ],
      nextAction: learningNextAction({ providerLearningBridge, supabaseTrainingCorpusCensus, requirementPulse })
    })
  ];

  const hypotheses = [
    hypothesis({
      id: "value-thesis",
      status: topEdge && topEdge.action === "value" ? "pass" : topEdge ? "watch" : "block",
      score: topEdge ? (topEdge.edge + topEdge.expectedValue) * 100 + 55 : 12,
      thesis: topEdge ? `${topEdge.selection} has model-vs-market signal after implied probability and no-vig conversion.` : "No priced value thesis is available.",
      supports: [topEdge?.verdict, topEdge?.whyModelLikesIt, topEdge ? `fair odds ${topEdge.fairOdds ?? "n/a"}` : null],
      challenges: [topEdge?.avoidReason, ...(topEdge?.risks ?? [])],
      falsifier: "A fresh odds refresh removes positive expected value, flips no-vig edge negative, or adds stronger injury/news risk.",
      proofUrl: topEdge?.verifyUrl ?? "/api/sports/decision/odds-intelligence-proof"
    }),
    hypothesis({
      id: "data-trust-thesis",
      status: statusFromScore(dataAuthority.trustScore),
      score: dataAuthority.trustScore,
      thesis: "The decision can only advance as far as provider, Supabase, and historical evidence allow.",
      supports: [dataAuthority.summary, dataAuthority.topFamily?.expectedEvidence],
      challenges: [dataAuthority.topFamily?.blockers.join("; "), dataAuthority.nextCommand.expectedEvidence],
      falsifier: "Live provider rows, clean OddsPadi Supabase proof, or fixture/context reconciliation contradict the current blocker.",
      proofUrl: "/api/sports/decision/data-authority"
    }),
    hypothesis({
      id: "ai-review-thesis",
      status: openAiLiveReviewReceipt.status === "reviewed" ? "pass" : openAiLiveReviewReceipt.status === "quota-or-billing-blocked" ? "watch" : "block",
      score: openAiLiveReviewReceipt.status === "reviewed" ? 90 : openAiLiveReviewReceipt.status === "quota-or-billing-blocked" ? 45 : 18,
      thesis: "OpenAI review may critique the decision, but cannot upgrade trust without deterministic proof.",
      supports: [openAiLiveReviewReceipt.summary, openAiLiveReviewReceipt.latestRun.reviewHash],
      challenges: [openAiLiveReviewReceipt.latestRun.reason, ...openAiLiveReviewReceipt.locks],
      falsifier: "A guarded run=1 review returns a valid schema with cited evidence and no safety-gate blocks.",
      proofUrl: "/api/sports/decision/openai-live-review-receipt"
    })
  ];
  const status = kernelStatus({ agentThoughtBoard, openAiLiveReviewReceipt, phases });
  const nextOperation = agentOperationQueue.nextOperation;
  const nextAcquisition = evidenceAcquisitionPlanner.nextCandidate;
  const finalDirective: DecisionCognitiveKernel["finalDirective"] = {
    action:
      status === "waiting-openai-quota"
        ? "wait-openai-quota"
        : nextAcquisition?.safeToRun || nextOperation?.safeToRun
          ? "run-readonly-proof"
          : status === "blocked"
            ? "repair-evidence"
            : "inspect-proof",
    publicStance: publicStance(agentThoughtBoard.decision.finalAction, ceiling),
    reason:
      status === "blocked"
        ? strongestObjection
        : status === "waiting-openai-quota"
          ? openAiLiveReviewReceipt.nextAction
          : nextAcquisition?.expectedBeliefChange ?? agentOperationQueue.summary,
    command: nextAcquisition?.safeToRun ? nextAcquisition.command : nextOperation?.safeToRun ? nextOperation.command : null,
    verifyUrl: nextAcquisition?.verifyUrl ?? nextOperation?.verifyUrl ?? null,
    expectedEvidence: nextAcquisition?.expectedEvidence ?? nextOperation?.expectedEvidence ?? strongestObjection,
    canShowAsPick: false,
    canPersist: false,
    canPublish: false,
    canTrain: false
  };

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "cognitive-kernel",
    status,
    kernelHash: stableHash({
      date,
      sport,
      status,
      focus: agentThoughtBoard.focus,
      phases: phases.map((item) => [item.id, item.status, item.nextAction]),
      hypotheses: hypotheses.map((item) => [item.id, item.status, item.score]),
      beliefLedger: beliefLedger.ledgerHash,
      acquisition: evidenceAcquisitionPlanner.plannerHash,
      providerLearning: providerLearningBridge?.bridgeHash ?? null,
      corpusMemory: supabaseTrainingCorpusCensus?.censusHash ?? null,
      operation: agentOperationQueue.queueHash,
      openAi: openAiLiveReviewReceipt.receiptHash
    }),
    summary:
      status === "ready-shadow"
        ? "Cognitive kernel can inspect a shadow decision with model, market, data, challenge, and action phases attached."
        : status === "waiting-openai-quota"
          ? "Cognitive kernel is waiting on OpenAI quota/billing for live critique while deterministic proof stays read-only."
          : status === "blocked"
            ? `Cognitive kernel blocks public action: ${compact(strongestObjection, 160)}`
            : "Cognitive kernel needs more evidence before trust can rise.",
    focus: {
      matchId: agentThoughtBoard.focus.matchId,
      match: agentThoughtBoard.focus.match,
      selection: agentThoughtBoard.focus.selection,
      action: agentThoughtBoard.decision.finalAction,
      confidenceScore: agentThoughtBoard.focus.confidenceScore
    },
    state: {
      workingHypothesis,
      strongestObjection,
      confidenceCeiling: ceiling,
      evidenceDebt,
      consensusScore,
      contradictionCount,
      openAiState: openAiLiveReviewReceipt.status,
      beliefLedgerState: beliefLedger.status,
      acquisitionState: evidenceAcquisitionPlanner.status,
      providerLearningState: providerLearningBridge?.status ?? "not-attached",
      corpusMemoryState: supabaseTrainingCorpusCensus?.status ?? "not-attached"
    },
    phases,
    hypotheses,
    finalDirective,
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyCommand: Boolean(nextAcquisition?.safeToRun || nextOperation?.safeToRun),
      canAskOpenAI: openAiLiveReviewReceipt.controls.canRequestLiveReview,
      canCompleteOpenAIReview: openAiLiveReviewReceipt.status === "reviewed",
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/cognitive-kernel",
      ...modelMathProof.proofUrls,
      ...oddsIntelligenceProof.proofUrls,
      ...beliefLedger.proofUrls,
      ...evidenceAcquisitionPlanner.proofUrls,
      ...agentThoughtBoard.proofUrls,
      ...agentOperationQueue.proofUrls,
      ...launchState.proofUrls,
      ...openAiLiveReviewReceipt.proofUrls,
      ...requirementPulse.proofUrls,
      ...(providerLearningBridge?.proofUrls ?? []),
      ...(supabaseTrainingCorpusCensus?.proofUrls ?? [])
    ]),
    locks: unique([
      "Cognitive kernel exposes public reasoning steps only; hidden chain-of-thought stays disabled.",
      "Cognitive kernel cannot persist decisions, publish picks, train models, stake, or upgrade public action.",
      ...modelMathProof.locks,
      ...oddsIntelligenceProof.locks,
      ...beliefLedger.locks,
      ...evidenceAcquisitionPlanner.locks,
      ...agentThoughtBoard.locks,
      ...agentOperationQueue.locks,
      ...launchState.locks,
      ...openAiLiveReviewReceipt.locks,
      ...(providerLearningBridge?.locks ?? []),
      ...(supabaseTrainingCorpusCensus?.locks ?? [])
    ])
  };
}
