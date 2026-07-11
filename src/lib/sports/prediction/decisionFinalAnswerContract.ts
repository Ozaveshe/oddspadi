import type { DecisionAILiveCycleReceipt } from "@/lib/sports/prediction/decisionAILiveCycleReceipt";
import type { DecisionAbstentionAudit } from "@/lib/sports/prediction/decisionAbstentionAudit";
import type { DecisionEngineActivationContract } from "@/lib/sports/prediction/decisionEngineActivationContract";
import type { DecisionMarketAuditMatrix, DecisionMarketAuditMatrixRow } from "@/lib/sports/prediction/decisionMarketAuditMatrix";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionAction, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionFinalAnswerStatus = "blocked" | "avoid" | "monitor" | "shadow-candidate";
export type DecisionFinalAnswerPublicAction = "avoid" | "monitor";

export type DecisionFinalAnswerContract = {
  mode: "decision-final-answer-contract";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionFinalAnswerStatus;
  answerHash: string;
  summary: string;
  target: {
    matchId: string | null;
    match: string | null;
    league: string | null;
    kickoffTime: string | null;
    market: string | null;
    selection: string | null;
  };
  publicAnswer: {
    action: DecisionFinalAnswerPublicAction;
    headline: string;
    explanation: string;
    confidence: "low" | "medium" | "high";
    publicPickAllowed: false;
  };
  modelView: {
    deterministicAction: DecisionAction | null;
    verdict: string | null;
    modelProbability: number | null;
    noVigProbability: number | null;
    posteriorProbability: number | null;
    edge: number | null;
    expectedValue: number | null;
    fairOdds: number | null;
    whyModelFavorsIt: string;
  };
  abstentionGuard: {
    status: DecisionAbstentionAudit["status"];
    auditHash: string;
    topCandidateId: string | null;
    publicDecision: NonNullable<DecisionAbstentionAudit["topCandidate"]>["publicDecision"] | null;
    actionCeiling: DecisionFinalAnswerPublicAction;
    whyAvoidOrWait: string;
    missingEvidence: string[];
    saferAlternatives: string[];
    positiveEvBlocked: number;
    canOverride: false;
  };
  riskReview: {
    primaryRisk: string;
    avoidReason: string | null;
    portfolioStress: {
      status: string;
      detail: string;
      nextAction: string;
      evidence: string[];
    } | null;
    dataGaps: string[];
    newsOrContextRisks: string[];
    requiredBeforeUpgrade: string[];
  };
  alternatives: Array<{
    market: string;
    selection: string;
    rationale: string;
    fairOdds: number | null;
  }>;
  aiReview: {
    status: DecisionAILiveCycleReceipt["status"];
    model: string;
    mayRequestReview: boolean;
    rule: string;
    nextAction: string;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRequestAIReview: boolean;
    canDisplayMonitor: true;
    canDisplayAsPick: false;
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

function compact(value: string | null | undefined, maxLength = 260): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function pickTargetRow(rows: DecisionRow[], marketRow: DecisionMarketAuditMatrixRow | null): DecisionRow | null {
  if (marketRow) {
    const match = rows.find((row) => row.match.id === marketRow.matchId);
    if (match) return match;
  }
  return rows[0] ?? null;
}

function topMarketRow(matrix: DecisionMarketAuditMatrix, sport: Sport): DecisionMarketAuditMatrixRow | null {
  return (
    matrix.rows
      .filter((row) => row.sport === sport)
      .slice()
      .sort((a, b) => {
        const rank = { "positive-ev": 3, watch: 2, avoid: 1, unpriced: 0 } as const;
        const verdictDiff = rank[b.verdict] - rank[a.verdict];
        if (verdictDiff !== 0) return verdictDiff;
        if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
        if (b.edge !== a.edge) return b.edge - a.edge;
        return b.valueRankScore - a.valueRankScore;
      })[0] ?? null
  );
}

function statusFor(contract: DecisionEngineActivationContract, marketRow: DecisionMarketAuditMatrixRow | null): DecisionFinalAnswerStatus {
  if (contract.status === "blocked-storage" || contract.totals.block > 0) return "blocked";
  if (!marketRow || marketRow.verdict === "avoid" || marketRow.verdict === "unpriced") return "avoid";
  if (marketRow.verdict === "watch" || contract.status === "needs-evidence") return "monitor";
  return "shadow-candidate";
}

function publicActionFor(status: DecisionFinalAnswerStatus): DecisionFinalAnswerPublicAction {
  return status === "shadow-candidate" || status === "monitor" ? "monitor" : "avoid";
}

function actionWithAbstentionGuard(
  status: DecisionFinalAnswerStatus,
  abstentionAudit: DecisionAbstentionAudit
): DecisionFinalAnswerPublicAction {
  const baseAction = publicActionFor(status);
  if (baseAction === "avoid") return "avoid";
  return abstentionAudit.topCandidate?.publicDecision === "monitor-only" ? "monitor" : "avoid";
}

function statusWithAbstentionGuard(
  status: DecisionFinalAnswerStatus,
  action: DecisionFinalAnswerPublicAction
): DecisionFinalAnswerStatus {
  if (status === "blocked" || action === "monitor") return status;
  return "avoid";
}

function confidenceFor(status: DecisionFinalAnswerStatus, row: DecisionRow | null): DecisionFinalAnswerContract["publicAnswer"]["confidence"] {
  if (status === "blocked" || status === "avoid") return "low";
  if (row?.prediction.decision.confidence === "high" && status === "shadow-candidate") return "medium";
  return "low";
}

function headlineFor(status: DecisionFinalAnswerStatus, target: string | null, selection: string | null): string {
  if (status === "shadow-candidate" && selection) return `Monitor ${selection} as a shadow value candidate for ${target ?? "the selected match"}.`;
  if (status === "monitor") return `Monitor ${target ?? "the selected match"}; the edge is not cleared for public action.`;
  if (status === "avoid") return `Avoid forcing a pick on ${target ?? "the selected match"}.`;
  return `No public pick: storage and evidence gates are still blocking ${target ?? "this slate"}.`;
}

function explanationFor({
  status,
  row,
  marketRow,
  activationContract,
  trustFirewall
}: {
  status: DecisionFinalAnswerStatus;
  row: DecisionRow | null;
  marketRow: DecisionMarketAuditMatrixRow | null;
  activationContract: DecisionEngineActivationContract;
  trustFirewall: DecisionTrustFirewall;
}): string {
  if (!row) return "No target match was available, so the engine cannot issue a responsible answer.";
  if (status === "blocked") {
    const portfolioBlock = trustFirewall.gates.find((gate) => gate.id === "portfolio-risk" && gate.status === "block");
    return compact(
      portfolioBlock
        ? `${activationContract.summary} Portfolio stress blocker: ${portfolioBlock.detail}`
        : `${activationContract.summary} First blocker: ${activationContract.nextAction.expectedEvidence}`,
      360
    );
  }
  if (marketRow && (status === "shadow-candidate" || status === "monitor")) {
    return compact(`${marketRow.whyModelFavorsIt} Firewall: ${trustFirewall.summary}`, 360);
  }
  return compact(row.prediction.decision.summary, 360);
}

export function buildDecisionFinalAnswerContract({
  date,
  sport,
  rows,
  activationContract,
  trustFirewall,
  marketAuditMatrix,
  aiLiveCycleReceipt,
  abstentionAudit,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  rows: DecisionRow[];
  activationContract: DecisionEngineActivationContract;
  trustFirewall: DecisionTrustFirewall;
  marketAuditMatrix: DecisionMarketAuditMatrix;
  aiLiveCycleReceipt: DecisionAILiveCycleReceipt;
  abstentionAudit: DecisionAbstentionAudit;
  now?: Date;
}): DecisionFinalAnswerContract {
  const marketRow = topMarketRow(marketAuditMatrix, sport);
  const row = pickTargetRow(rows, marketRow);
  const decision = row?.prediction.decision ?? null;
  const bestPick = row?.prediction.bestPick ?? null;
  const rawStatus = statusFor(activationContract, marketRow);
  const action = actionWithAbstentionGuard(rawStatus, abstentionAudit);
  const status = statusWithAbstentionGuard(rawStatus, action);
  const targetMatch = row ? matchLabel(row.match) : marketRow?.match ?? null;
  const selection = marketRow?.selection ?? (bestPick?.hasValue ? bestPick.label : decision?.recommendedSelection ?? null);
  const abstentionCandidate = abstentionAudit.topCandidate;
  const abstentionWhy = compact(
    abstentionCandidate?.whyAvoidOrWait ??
      "No abstention candidate cleared the guard, so the public answer must remain conservative until provider and trust evidence improves.",
    360
  );
  const abstentionGuard = {
    status: abstentionAudit.status,
    auditHash: abstentionAudit.auditHash,
    topCandidateId: abstentionCandidate?.id ?? null,
    publicDecision: abstentionCandidate?.publicDecision ?? null,
    actionCeiling: action,
    whyAvoidOrWait: abstentionWhy,
    missingEvidence: abstentionCandidate?.missingEvidence.slice(0, 8) ?? [],
    saferAlternatives: abstentionCandidate?.saferAlternatives.slice(0, 5) ?? [],
    positiveEvBlocked: abstentionAudit.totals.positiveEvBlocked,
    canOverride: false as const
  };
  const portfolioStressGate = trustFirewall.gates.find((gate) => gate.id === "portfolio-risk") ?? null;
  const risks = unique([
    abstentionCandidate?.risks[0],
    abstentionWhy,
    portfolioStressGate?.status === "block" ? portfolioStressGate.detail : null,
    marketRow?.riskNote,
    decision?.risks[0],
    trustFirewall.gates.find((gate) => gate.status === "block")?.detail,
    activationContract.gates.find((gate) => gate.status === "block")?.detail
  ]);
  const dataGaps = unique([...(abstentionCandidate?.missingEvidence ?? []), ...(decision?.dataCoverage.requiredBeforeTrust ?? []), ...(decision?.missingSignals ?? []), ...activationContract.gates.filter((gate) => gate.status !== "pass").map((gate) => gate.nextAction)], 8);
  const newsOrContextRisks = unique([...(decision?.researchBrief.dataGaps ?? []), ...(decision?.researchBrief.requiredChecks ?? []), ...(decision?.contextAdjustment?.riskFlags ?? [])], 8);
  const abstentionAlternatives = (abstentionCandidate?.saferAlternatives ?? []).slice(0, 3).map((alternative) => ({
    market: alternative,
    selection: alternative,
    rationale: "Safer alternative suggested by the abstention audit while the primary selection remains locked.",
    fairOdds: null
  }));
  const alternatives = [
    ...abstentionAlternatives,
    ...(decision?.saferAlternatives ?? []).slice(0, Math.max(0, 5 - abstentionAlternatives.length)).map((alternative) => ({
    market: alternative.market,
    selection: alternative.selection,
    rationale: alternative.rationale,
    fairOdds: alternative.fairOdds ?? null
    }))
  ];
  const next = activationContract.nextAction;
  const answerHash = stableHash({
    date,
    sport,
    status,
    action,
    target: [row?.match.id ?? null, marketRow?.id ?? null, selection],
    activation: activationContract.contractHash,
    firewall: trustFirewall.firewallHash,
    ai: aiLiveCycleReceipt.receiptHash,
    abstention: [abstentionAudit.auditHash, abstentionCandidate?.id, abstentionCandidate?.publicDecision]
  });

  return {
    mode: "decision-final-answer-contract",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    answerHash,
    summary:
      status === "shadow-candidate"
        ? "Final answer contract allows monitor-only display of a shadow value candidate; public pick publishing remains locked."
        : status === "monitor"
          ? "Final answer contract keeps the selected match on monitor because not every proof gate cleared."
          : status === "avoid"
            ? "Final answer contract says avoid forcing a pick because the market edge is weak or unavailable."
            : "Final answer contract blocks public picks because storage or critical proof gates are not satisfied.",
    target: {
      matchId: row?.match.id ?? marketRow?.matchId ?? null,
      match: targetMatch,
      league: row?.match.league.name ?? marketRow?.league ?? null,
      kickoffTime: row?.match.kickoffTime ?? marketRow?.kickoffTime ?? null,
      market: marketRow?.marketName ?? (bestPick?.hasValue ? bestPick.marketId : null),
      selection
    },
    publicAnswer: {
      action,
      headline: headlineFor(status, targetMatch, selection),
      explanation: explanationFor({ status, row, marketRow, activationContract, trustFirewall }),
      confidence: confidenceFor(status, row),
      publicPickAllowed: false
    },
    modelView: {
      deterministicAction: decision?.action ?? null,
      verdict: decision?.verdict ?? null,
      modelProbability: marketRow?.modelProbability ?? (bestPick?.hasValue ? bestPick.modelProbability : null),
      noVigProbability: marketRow?.noVigProbability ?? (bestPick?.hasValue ? bestPick.noVigImpliedProbability : null),
      posteriorProbability: marketRow?.posteriorProbability ?? decision?.beliefState.believedProbability ?? null,
      edge: marketRow?.edge ?? (bestPick?.hasValue ? bestPick.edge : null),
      expectedValue: marketRow?.expectedValue ?? (bestPick?.hasValue ? bestPick.expectedValue : null),
      fairOdds: marketRow?.fairOdds ?? (bestPick?.hasValue && bestPick.modelProbability > 0 ? 1 / bestPick.modelProbability : null),
      whyModelFavorsIt: compact(marketRow?.whyModelFavorsIt ?? decision?.attribution.explanation ?? decision?.summary, 360)
    },
    abstentionGuard,
    riskReview: {
      primaryRisk: compact(risks[0] ?? "No primary risk was available, so the answer remains conservative."),
      avoidReason: marketRow?.avoidReason ?? decision?.avoidReasons[0] ?? null,
      portfolioStress: portfolioStressGate
        ? {
            status: portfolioStressGate.status,
            detail: portfolioStressGate.detail,
            nextAction: portfolioStressGate.nextAction,
            evidence: portfolioStressGate.evidence
          }
        : null,
      dataGaps,
      newsOrContextRisks,
      requiredBeforeUpgrade: unique(
        [
          portfolioStressGate?.status === "block" ? portfolioStressGate.nextAction : null,
          trustFirewall.actionContract.reason,
          abstentionGuard.whyAvoidOrWait,
          ...abstentionGuard.missingEvidence,
          ...activationContract.gates.filter((gate) => gate.status !== "pass").map((gate) => gate.nextAction),
          ...(decision?.nextChecks ?? [])
        ],
        10
      )
    },
    alternatives,
    aiReview: {
      status: aiLiveCycleReceipt.status,
      model: aiLiveCycleReceipt.model,
      mayRequestReview: activationContract.allowedActions.canRequestAIReview,
      rule: "AI review may agree, downgrade, or request evidence, but it cannot upgrade an avoid/monitor answer into a public pick.",
      nextAction: aiLiveCycleReceipt.nextSafeAction.expectedEvidence
    },
    nextAction: {
      label: next.label,
      command: next.command || decisionCurlCommand(next.verifyUrl),
      verifyUrl: next.verifyUrl,
      safeToRun: next.safeToRun,
      expectedEvidence: next.expectedEvidence
    },
    controls: {
      canInspectReadOnly: true,
      canRequestAIReview: activationContract.allowedActions.canRequestAIReview,
      canDisplayMonitor: true,
      canDisplayAsPick: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/final-answer-council",
      "/api/sports/decision/final-answer-ai-review",
      "/api/sports/decision/change-mind-ledger",
      "/api/sports/decision/engine-activation-contract",
      "/api/sports/decision/trust-firewall",
      "/api/sports/decision/market-audit-matrix",
      "/api/sports/decision/abstention-audit",
      "/api/sports/decision/portfolio-risk",
      "/api/sports/decision/ai-live-cycle-receipt",
      "/api/sports/decision/odds-intelligence-proof"
    ]),
    locks: unique([
      "Final answer contract cannot publish picks, stake, persist, train, apply learned weights, or expose hidden chain-of-thought.",
      "The abstention guard can only lower the public answer to avoid or monitor; it cannot be overridden by model edge, odds edge, or AI review.",
      "AI review may only preserve or downgrade the deterministic answer.",
      ...activationContract.locks,
      ...trustFirewall.locks,
      ...aiLiveCycleReceipt.locks
    ])
  };
}
