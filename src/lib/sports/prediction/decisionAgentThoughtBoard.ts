import type { DecisionAdversarialPanel } from "@/lib/sports/prediction/decisionAdversarialPanel";
import type { DecisionEvidenceGraph } from "@/lib/sports/prediction/decisionEvidenceGraph";
import type { DecisionModelEnsemble } from "@/lib/sports/prediction/decisionModelEnsemble";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionAgentThoughtBoardStatus = "ready-shadow" | "needs-evidence" | "quota-waiting" | "blocked" | "no-candidates";
export type DecisionAgentThoughtBoardSignalStatus = "support" | "watch" | "block";
export type DecisionAgentThoughtBoardRoleId = "quant" | "market" | "data" | "risk" | "ai-review" | "arbiter";

export type DecisionAgentThoughtBoardRole = {
  id: DecisionAgentThoughtBoardRoleId;
  label: string;
  status: DecisionAgentThoughtBoardSignalStatus;
  stance: string;
  detail: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAgentThoughtBoard = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "agent-thought-board";
  status: DecisionAgentThoughtBoardStatus;
  boardHash: string;
  summary: string;
  focus: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    action: DecisionAction | "hold";
    confidenceScore: number;
  };
  counts: {
    roles: number;
    support: number;
    watch: number;
    block: number;
    evidenceNodes: number;
    adversarialCases: number;
  };
  roles: DecisionAgentThoughtBoardRole[];
  decision: {
    finalAction: DecisionAction | "hold";
    publicLabel: string;
    rationale: string;
    nextEvidenceAction: string;
    proofCommand: string | null;
    verifyUrl: string | null;
  };
  controls: {
    canInspectReadOnly: true;
    canRequestOpenAIReview: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canRaiseTrust: false;
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 6): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function role(input: Omit<DecisionAgentThoughtBoardRole, "evidence"> & { evidence: Array<string | null | undefined> }): DecisionAgentThoughtBoardRole {
  return {
    ...input,
    detail: compact(input.detail, 280),
    evidence: unique(input.evidence, 5),
    nextAction: compact(input.nextAction, 220)
  };
}

function statusFromInputs({
  slateThinking,
  evidenceGraph,
  adversarialPanel,
  openAiLiveReviewReceipt
}: {
  slateThinking: DecisionSlateThinking;
  evidenceGraph: DecisionEvidenceGraph;
  adversarialPanel: DecisionAdversarialPanel;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
}): DecisionAgentThoughtBoardStatus {
  if (!adversarialPanel.topCase && !slateThinking.nextThought) return "no-candidates";
  if (adversarialPanel.status === "blocked" || evidenceGraph.status === "blocked" || slateThinking.status === "blocked") return "blocked";
  if (openAiLiveReviewReceipt.status === "quota-or-billing-blocked" || openAiLiveReviewReceipt.status === "rate-or-quota-limited") return "quota-waiting";
  if (adversarialPanel.status === "contested" || evidenceGraph.status === "contested" || slateThinking.status === "watching") return "needs-evidence";
  return "ready-shadow";
}

function summaryFor(status: DecisionAgentThoughtBoardStatus, match: string | null): string {
  if (status === "ready-shadow") return `Agent thought board clears ${match ?? "the focus"} for shadow review only; public actions remain locked.`;
  if (status === "quota-waiting") return `Agent thought board is waiting on OpenAI quota/billing before live AI review can complete for ${match ?? "the focus"}.`;
  if (status === "blocked") return `Agent thought board blocks ${match ?? "the focus"} because hard evidence or safety gates failed.`;
  if (status === "no-candidates") return "Agent thought board has no candidate to review.";
  return `Agent thought board needs more evidence before trust can rise for ${match ?? "the focus"}.`;
}

export function buildDecisionAgentThoughtBoard({
  date,
  sport,
  modelEnsemble,
  slateThinking,
  evidenceGraph,
  adversarialPanel,
  openAiLiveReviewReceipt,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  modelEnsemble: DecisionModelEnsemble;
  slateThinking: DecisionSlateThinking;
  evidenceGraph: DecisionEvidenceGraph;
  adversarialPanel: DecisionAdversarialPanel;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  now?: Date;
}): DecisionAgentThoughtBoard {
  const topCase = adversarialPanel.topCase;
  const nextThought = slateThinking.nextThought;
  const topCandidate = topCase ? modelEnsemble.candidates.find((candidate) => candidate.matchId === topCase.matchId) : modelEnsemble.topCandidate;
  const focusMatch = topCase?.match ?? nextThought?.match ?? topCandidate?.match ?? null;
  const focusMatchId = topCase?.matchId ?? nextThought?.matchId ?? topCandidate?.matchId ?? null;
  const focusSelection = topCase?.selection ?? nextThought?.selection ?? topCandidate?.selection ?? null;
  const focusAction = topCase?.panelAction ?? nextThought?.baselineAction ?? topCandidate?.ensembleAction ?? "hold";
  const focusConfidence = topCase?.confidenceScore ?? nextThought?.confidenceScore ?? topCandidate?.weightedScore ?? 0;
  const blockingNodes = evidenceGraph.nodes.filter((node) => node.status === "blocking");
  const watchNodes = evidenceGraph.nodes.filter((node) => node.status === "watch");
  const status = statusFromInputs({ slateThinking, evidenceGraph, adversarialPanel, openAiLiveReviewReceipt });

  const roles = [
    role({
      id: "quant",
      label: "Quant model",
      status: topCandidate?.ensembleAction === "consider" && topCandidate.weightedScore >= 70 ? "support" : topCandidate ? "watch" : "block",
      stance: topCandidate ? `${topCandidate.ensembleAction} at score ${topCandidate.weightedScore}` : "No model candidate",
      detail: topCandidate
        ? `Model ensemble says ${topCandidate.ensembleAction}; base ${topCandidate.baseAction}; consensus ${topCandidate.consensus}; agreement ${topCandidate.agreementScore}%.`
        : "No model-ensemble candidate is available for the agent board.",
      evidence: [topCandidate?.nextCheck, topCandidate ? `Model ${topCandidate.modelProbability}; posterior ${topCandidate.posteriorProbability}.` : null],
      nextAction: topCandidate?.nextCheck ?? "Build model ensemble before agent review."
    }),
    role({
      id: "market",
      label: "Market value",
      status: topCase && (topCase.edge ?? 0) > 0 && (topCase.expectedValue ?? 0) > 0 ? "support" : topCase ? "watch" : "block",
      stance: topCase ? `edge ${topCase.edge ?? "n/a"}, EV ${topCase.expectedValue ?? "n/a"}` : "No priced panel case",
      detail: topCase
        ? `Panel market view is ${topCase.status}; model ${topCase.modelProbability ?? "n/a"}, market ${topCase.marketProbability ?? "n/a"}, posterior ${topCase.posteriorProbability ?? "n/a"}.`
        : "No adversarial market case is available.",
      evidence: [topCase?.avoidReason, ...(topCase?.saferAlternatives ?? [])],
      nextAction: topCase?.nextCheck ?? "Create an adversarial panel case before market review."
    }),
    role({
      id: "data",
      label: "Data auditor",
      status: blockingNodes.length ? "block" : watchNodes.length ? "watch" : "support",
      stance: `${evidenceGraph.totals.supporting} support, ${evidenceGraph.totals.watch} watch, ${evidenceGraph.totals.blocking} block`,
      detail: evidenceGraph.summary,
      evidence: [
        ...blockingNodes.slice(0, 3).map((node) => `${node.label}: ${node.detail}`),
        ...watchNodes.slice(0, 3).map((node) => `${node.label}: ${node.detail}`)
      ],
      nextAction: evidenceGraph.nextObservation.reason
    }),
    role({
      id: "risk",
      label: "Risk manager",
      status: topCase?.block ? "block" : topCase?.watch || adversarialPanel.status === "contested" ? "watch" : topCase ? "support" : "block",
      stance: topCase ? `${topCase.block} block, ${topCase.watch} watch, ${topCase.oppose} oppose` : "No risk case",
      detail: topCase
        ? `${topCase.risks.length} risk(s), ${topCase.blockingEvidence.length} blocking evidence item(s), ${topCase.saferAlternatives.length} safer alternative(s).`
        : adversarialPanel.summary,
      evidence: [...(topCase?.risks ?? []), ...(topCase?.blockingEvidence ?? [])],
      nextAction: topCase?.avoidReason ?? topCase?.nextCheck ?? "Run adversarial review before risk approval."
    }),
    role({
      id: "ai-review",
      label: "AI live reviewer",
      status:
        openAiLiveReviewReceipt.status === "reviewed"
          ? "support"
          : openAiLiveReviewReceipt.status === "missing-key" ||
              openAiLiveReviewReceipt.status === "auth-failed" ||
              openAiLiveReviewReceipt.status === "quota-or-billing-blocked" ||
              openAiLiveReviewReceipt.status === "rate-or-quota-limited"
            ? "block"
            : "watch",
      stance: openAiLiveReviewReceipt.status.replaceAll("-", " "),
      detail: openAiLiveReviewReceipt.summary,
      evidence: [openAiLiveReviewReceipt.latestRun.reason, openAiLiveReviewReceipt.latestRun.reviewHash],
      nextAction: openAiLiveReviewReceipt.nextAction
    })
  ];
  const support = roles.filter((item) => item.status === "support").length;
  const watch = roles.filter((item) => item.status === "watch").length;
  const block = roles.filter((item) => item.status === "block").length;
  const finalAction: DecisionAction | "hold" = block ? "avoid" : watch ? "monitor" : focusAction === "hold" ? "monitor" : focusAction;
  const publicLabel =
    finalAction === "consider"
      ? "Shadow consider"
      : finalAction === "monitor"
        ? "Monitor only"
        : finalAction === "avoid"
          ? "Avoid"
          : "Hold";
  const arbiter = role({
    id: "arbiter",
    label: "Final arbiter",
    status: block ? "block" : watch ? "watch" : "support",
    stance: publicLabel,
    detail:
      block > 0
        ? `Final arbiter blocks upgrade because ${block} role(s) still block the board.`
        : watch > 0
          ? `Final arbiter keeps monitor-only because ${watch} role(s) still need evidence.`
          : "Final arbiter clears shadow review only; publishing, staking, training, and persistence remain locked.",
    evidence: roles.map((item) => `${item.label}: ${item.stance}`),
    nextAction:
      roles.find((item) => item.status === "block")?.nextAction ??
      roles.find((item) => item.status === "watch")?.nextAction ??
      "Run read-only proof again after provider, training, and OpenAI gates are green."
  });
  const allRoles = [...roles, arbiter];
  const boardHash = stableHash({
    date,
    sport,
    status,
    focusMatchId,
    roles: allRoles.map((item) => [item.id, item.status, item.stance]),
    finalAction
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "agent-thought-board",
    status,
    boardHash,
    summary: summaryFor(status, focusMatch),
    focus: {
      matchId: focusMatchId,
      match: focusMatch,
      selection: focusSelection,
      action: finalAction,
      confidenceScore: Math.round(focusConfidence)
    },
    counts: {
      roles: allRoles.length,
      support: allRoles.filter((item) => item.status === "support").length,
      watch: allRoles.filter((item) => item.status === "watch").length,
      block: allRoles.filter((item) => item.status === "block").length,
      evidenceNodes: evidenceGraph.totals.nodes,
      adversarialCases: adversarialPanel.totals.cases
    },
    roles: allRoles,
    decision: {
      finalAction,
      publicLabel,
      rationale: compact(arbiter.detail, 260),
      nextEvidenceAction: arbiter.nextAction,
      proofCommand: evidenceGraph.nextObservation.command ?? nextThought?.safeCommand ?? null,
      verifyUrl: evidenceGraph.nextObservation.verifyUrl ?? nextThought?.verifyUrl ?? null
    },
    controls: {
      canInspectReadOnly: true,
      canRequestOpenAIReview: openAiLiveReviewReceipt.controls.canRequestLiveReview,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canRaiseTrust: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(
      [
        "/api/sports/decision/agent-thought-board",
        "/api/sports/decision/slate-thinking",
        "/api/sports/decision/evidence-graph",
        "/api/sports/decision/adversarial-panel",
        "/api/sports/decision/openai-live-review-receipt",
        evidenceGraph.nextObservation.verifyUrl
      ],
      12
    ),
    locks: [
      "Agent thought board is public reasoning only; hidden chain-of-thought stays disabled.",
      "The board cannot persist, publish, train, stake, raise trust, or override deterministic safety gates.",
      "OpenAI live review remains a separate guarded run=1 proof and cannot upgrade public action by itself."
    ]
  };
}
