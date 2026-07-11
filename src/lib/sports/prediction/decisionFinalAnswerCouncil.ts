import type { DecisionChangeMindLedger } from "@/lib/sports/prediction/decisionChangeMindLedger";
import type { DecisionFinalAnswerAIReview } from "@/lib/sports/prediction/decisionFinalAnswerAIReview";
import type { DecisionFinalAnswerContract, DecisionFinalAnswerPublicAction } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import type { Sport } from "@/lib/sports/types";

export type DecisionFinalAnswerCouncilStatus = "blocked" | "watching" | "monitor-ready";
export type DecisionFinalAnswerCouncilRoleId = "quant" | "market" | "data" | "risk" | "portfolio" | "ai-review";
export type DecisionFinalAnswerCouncilVote = "avoid" | "monitor";

export type DecisionFinalAnswerCouncilRole = {
  id: DecisionFinalAnswerCouncilRoleId;
  label: string;
  vote: DecisionFinalAnswerCouncilVote;
  confidence: "low" | "medium" | "high";
  rationale: string;
  evidence: string[];
};

export type DecisionFinalAnswerCouncil = {
  mode: "decision-final-answer-council";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionFinalAnswerCouncilStatus;
  councilHash: string;
  summary: string;
  target: DecisionFinalAnswerContract["target"];
  finalPublicAction: DecisionFinalAnswerPublicAction;
  voteCounts: Record<DecisionFinalAnswerCouncilVote, number>;
  roles: DecisionFinalAnswerCouncilRole[];
  dissent: string[];
  nextQuestion: string;
  requiredBeforeMonitor: string[];
  controls: {
    canInspectReadOnly: true;
    canDisplayMonitor: true;
    canDisplayAsPick: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
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
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 10): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function voteRank(vote: DecisionFinalAnswerCouncilVote): number {
  return vote === "monitor" ? 2 : 1;
}

function safestVote(votes: DecisionFinalAnswerCouncilVote[]): DecisionFinalAnswerCouncilVote {
  return votes.reduce((lowest, vote) => (voteRank(vote) < voteRank(lowest) ? vote : lowest), "monitor" as DecisionFinalAnswerCouncilVote);
}

function role(input: DecisionFinalAnswerCouncilRole): DecisionFinalAnswerCouncilRole {
  return {
    ...input,
    rationale: compact(input.rationale, 320),
    evidence: unique(input.evidence, 5)
  };
}

function statusFor(votes: DecisionFinalAnswerCouncilVote[], changeMindLedger: DecisionChangeMindLedger): DecisionFinalAnswerCouncilStatus {
  if (votes.includes("avoid") || changeMindLedger.status === "blocked") return "blocked";
  if (changeMindLedger.status === "watching") return "watching";
  return "monitor-ready";
}

export function buildDecisionFinalAnswerCouncil({
  date,
  sport,
  finalAnswer,
  changeMindLedger,
  finalAnswerAIReview,
  trustFirewall,
  portfolioRisk,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  finalAnswer: DecisionFinalAnswerContract;
  changeMindLedger: DecisionChangeMindLedger;
  finalAnswerAIReview: DecisionFinalAnswerAIReview;
  trustFirewall: DecisionTrustFirewall;
  portfolioRisk: DecisionPortfolioRisk;
  now?: Date;
}): DecisionFinalAnswerCouncil {
  const portfolioFailures = portfolioRisk.stressTests.filter((scenario) => scenario.status === "fails").length;
  const blockingConditions = changeMindLedger.flipConditions.filter((condition) => condition.status === "blocking");
  const expectedValue = finalAnswer.modelView.expectedValue ?? 0;
  const edge = finalAnswer.modelView.edge ?? 0;
  const trustBlocked = trustFirewall.status === "blocked" || trustFirewall.totals.criticalBlocks > 0;
  const aiBlock = finalAnswerAIReview.appliedReview.verdict === "block" || finalAnswerAIReview.appliedReview.publicAction === "avoid";

  const roles: DecisionFinalAnswerCouncilRole[] = [
    role({
      id: "quant",
      label: "Quant model",
      vote: expectedValue > 0 && edge > 0 ? "monitor" : "avoid",
      confidence: expectedValue > 0.1 && edge > 0.05 ? "medium" : "low",
      rationale: finalAnswer.modelView.whyModelFavorsIt,
      evidence: [`ev:${expectedValue}`, `edge:${edge}`, `selection:${finalAnswer.target.selection ?? "none"}`]
    }),
    role({
      id: "market",
      label: "Market price",
      vote: edge > 0 && finalAnswer.modelView.noVigProbability !== null ? "monitor" : "avoid",
      confidence: edge > 0.08 ? "medium" : "low",
      rationale: edge > 0 ? "No-vig comparison is positive, but price movement can erase value before kickoff." : "Market edge is not strong enough for monitor posture.",
      evidence: [`noVig:${finalAnswer.modelView.noVigProbability ?? "n/a"}`, `fairOdds:${finalAnswer.modelView.fairOdds ?? "n/a"}`]
    }),
    role({
      id: "data",
      label: "Data evidence",
      vote: blockingConditions.some((condition) => condition.id === "storage-proof" || condition.id === "provider-evidence") ? "avoid" : "monitor",
      confidence: blockingConditions.length ? "high" : "medium",
      rationale: changeMindLedger.flipConditions.find((condition) => condition.id === "provider-evidence" || condition.id === "storage-proof")?.currentEvidence ?? changeMindLedger.summary,
      evidence: changeMindLedger.flipConditions.slice(0, 4).map((condition) => `${condition.id}:${condition.status}`)
    }),
    role({
      id: "risk",
      label: "Risk officer",
      vote: trustBlocked ? "avoid" : "monitor",
      confidence: trustBlocked ? "high" : "medium",
      rationale: trustFirewall.summary,
      evidence: [`criticalBlocks:${trustFirewall.totals.criticalBlocks}`, `trust:${trustFirewall.actionContract.trustScore}`]
    }),
    role({
      id: "portfolio",
      label: "Portfolio stress",
      vote: portfolioFailures > 0 ? "avoid" : "monitor",
      confidence: portfolioFailures > 0 ? "high" : "medium",
      rationale: portfolioRisk.summary,
      evidence: [`stressFailures:${portfolioFailures}`, `paperUnits:${portfolioRisk.budget.suggestedPaperUnits}`, portfolioRisk.portfolioHash]
    }),
    role({
      id: "ai-review",
      label: "AI adjudicator",
      vote: aiBlock ? "avoid" : "monitor",
      confidence: finalAnswerAIReview.status === "reviewed" ? "medium" : "low",
      rationale: finalAnswerAIReview.appliedReview.summary,
      evidence: [finalAnswerAIReview.status, finalAnswerAIReview.provider, ...finalAnswerAIReview.appliedReview.citedEvidenceIds]
    })
  ];
  const finalPublicAction = safestVote(roles.map((item) => item.vote));
  const status = statusFor(roles.map((item) => item.vote), changeMindLedger);
  const voteCounts = roles.reduce(
    (acc, item) => {
      acc[item.vote] += 1;
      return acc;
    },
    { avoid: 0, monitor: 0 } as Record<DecisionFinalAnswerCouncilVote, number>
  );
  const dissent = unique(
    roles
      .filter((item) => item.vote !== finalPublicAction)
      .map((item) => `${item.label} voted ${item.vote}: ${item.rationale}`),
    6
  );
  const requiredBeforeMonitor = unique(
    [
      changeMindLedger.nextFlip?.requiredProof,
      ...changeMindLedger.flipConditions.filter((condition) => condition.status === "blocking").map((condition) => condition.requiredProof),
      ...finalAnswerAIReview.appliedReview.requiredEvidence,
      ...finalAnswer.riskReview.requiredBeforeUpgrade
    ],
    8
  );

  return {
    mode: "decision-final-answer-council",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    councilHash: stableHash({
      date,
      sport,
      finalAnswer: finalAnswer.answerHash,
      changeMind: changeMindLedger.ledgerHash,
      aiReview: finalAnswerAIReview.reviewHash,
      votes: roles.map((item) => [item.id, item.vote, item.evidence])
    }),
    summary:
      status === "monitor-ready"
        ? `Final-answer council permits monitor-only posture for ${finalAnswer.target.match ?? "the target"}; public picks remain locked.`
        : status === "watching"
          ? `Final-answer council is watching unresolved evidence before confidence can rise; votes are ${voteCounts.monitor} monitor and ${voteCounts.avoid} avoid.`
          : `Final-answer council blocks public action; votes are ${voteCounts.monitor} monitor and ${voteCounts.avoid} avoid, with ${blockingConditions.length} change-mind blocker(s).`,
    target: finalAnswer.target,
    finalPublicAction,
    voteCounts,
    roles,
    dissent,
    nextQuestion: requiredBeforeMonitor[0] ?? "Which fresh provider-backed evidence would change the public posture?",
    requiredBeforeMonitor,
    controls: {
      canInspectReadOnly: true,
      canDisplayMonitor: true,
      canDisplayAsPick: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/final-answer-council",
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/final-answer-ai-review",
      "/api/sports/decision/change-mind-ledger",
      "/api/sports/decision/trust-firewall",
      "/api/sports/decision/portfolio-risk"
    ]),
    locks: [
      "Council synthesis is public, structured reasoning only; it does not expose hidden chain-of-thought.",
      "Any avoid vote keeps public action at avoid.",
      "Council output cannot publish, stake, persist, train, or upgrade the public action.",
      "OpenAI review remains advisory and same-or-safer than deterministic controls."
    ]
  };
}
