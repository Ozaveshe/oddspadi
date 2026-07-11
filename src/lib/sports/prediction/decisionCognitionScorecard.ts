import type { DecisionCognitiveKernel, DecisionCognitiveKernelPhaseStatus } from "@/lib/sports/prediction/decisionCognitiveKernel";
import type { Sport } from "@/lib/sports/types";

export type DecisionCognitionScorecardStatus = "ready-shadow" | "needs-evidence" | "blocked";
export type DecisionCognitionScorecardGrade = "A" | "B" | "C" | "D";
export type DecisionCognitionScorecardMetricId = "evidence" | "uncertainty" | "model-market" | "counterargument" | "action-safety" | "learning";
export type DecisionCognitionScorecardMetricStatus = "pass" | "watch" | "block";

export type DecisionCognitionScorecardMetric = {
  id: DecisionCognitionScorecardMetricId;
  label: string;
  score: number;
  status: DecisionCognitionScorecardMetricStatus;
  evidence: string[];
  nextAction: string;
};

export type DecisionCognitionScorecard = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-cognition-scorecard";
  status: DecisionCognitionScorecardStatus;
  grade: DecisionCognitionScorecardGrade;
  scorecardHash: string;
  summary: string;
  source: {
    cognitiveKernelHash: string;
    kernelStatus: DecisionCognitiveKernel["status"];
    focusMatchId: string | null;
    focusMatch: string | null;
    directiveAction: DecisionCognitiveKernel["finalDirective"]["action"];
    publicStance: DecisionCognitiveKernel["finalDirective"]["publicStance"];
  };
  score: {
    total: number;
    evidence: number;
    uncertainty: number;
    modelMarket: number;
    counterargument: number;
    actionSafety: number;
    learning: number;
  };
  metrics: DecisionCognitionScorecardMetric[];
  diagnosis: {
    strongestSignal: string;
    biggestDoubt: string;
    changeMindIf: string;
    nextSafeAction: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyCommand: boolean;
    canAskOpenAI: boolean;
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

function compact(value: string | null | undefined, maxLength = 240): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => compact(value)).filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
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

function metricStatus(score: number): DecisionCognitionScorecardMetricStatus {
  if (score >= 72) return "pass";
  if (score >= 45) return "watch";
  return "block";
}

function metric(input: Omit<DecisionCognitionScorecardMetric, "score" | "status" | "evidence" | "nextAction"> & { score: number; evidence: Array<string | null | undefined>; nextAction: string | null | undefined }): DecisionCognitionScorecardMetric {
  const score = clamp(input.score);
  return {
    ...input,
    score,
    status: metricStatus(score),
    evidence: unique(input.evidence, 5),
    nextAction: compact(input.nextAction, 220)
  };
}

function phaseScore(status: DecisionCognitiveKernelPhaseStatus | undefined): number {
  if (status === "pass") return 86;
  if (status === "watch") return 58;
  return 26;
}

function grade(total: number): DecisionCognitionScorecardGrade {
  if (total >= 85) return "A";
  if (total >= 70) return "B";
  if (total >= 55) return "C";
  return "D";
}

function learningScore(state: DecisionCognitiveKernel["state"]): number {
  const provider = state.providerLearningState;
  const corpus = state.corpusMemoryState;
  let score = 35;
  if (provider === "historical-proof-ready") score += 22;
  else if (provider !== "not-attached") score += 10;
  if (corpus === "ready-shadow-backtest") score += 30;
  else if (corpus === "ready-live-monitor") score += 24;
  else if (corpus === "partial-corpus") score += 18;
  else if (corpus !== "not-attached") score += 8;
  return clamp(score);
}

function scorecardStatus(total: number, kernel: DecisionCognitiveKernel, actionSafety: number): DecisionCognitionScorecardStatus {
  if (actionSafety < 70 || kernel.status === "blocked" || total < 45) return "blocked";
  if (kernel.status !== "ready-shadow" || total < 72) return "needs-evidence";
  return "ready-shadow";
}

export function buildDecisionCognitionScorecard({
  cognitiveKernel,
  now = new Date()
}: {
  cognitiveKernel: DecisionCognitiveKernel;
  now?: Date;
}): DecisionCognitionScorecard {
  const observe = cognitiveKernel.phases.find((phase) => phase.id === "observe");
  const model = cognitiveKernel.phases.find((phase) => phase.id === "model");
  const market = cognitiveKernel.phases.find((phase) => phase.id === "market");
  const challenge = cognitiveKernel.phases.find((phase) => phase.id === "challenge");
  const act = cognitiveKernel.phases.find((phase) => phase.id === "act");
  const learn = cognitiveKernel.phases.find((phase) => phase.id === "learn");
  const valueThesis = cognitiveKernel.hypotheses.find((item) => item.id === "value-thesis");
  const dataTrust = cognitiveKernel.hypotheses.find((item) => item.id === "data-trust-thesis");

  const evidenceScore = clamp(100 - cognitiveKernel.state.evidenceDebt - cognitiveKernel.state.contradictionCount * 5 + phaseScore(observe?.status) * 0.2);
  const uncertaintyScore = clamp(100 - cognitiveKernel.state.evidenceDebt - cognitiveKernel.state.contradictionCount * 12 + cognitiveKernel.state.consensusScore * 0.16);
  const modelMarketScore = clamp((phaseScore(model?.status) + phaseScore(market?.status) + (valueThesis?.score ?? 35)) / 3);
  const counterargumentScore = clamp((phaseScore(challenge?.status) + (dataTrust?.score ?? 45)) / 2 - cognitiveKernel.state.contradictionCount * 4);
  const actionSafetyScore = clamp(
    100 -
      (cognitiveKernel.finalDirective.canShowAsPick ? 35 : 0) -
      (cognitiveKernel.finalDirective.canPersist ? 25 : 0) -
      (cognitiveKernel.finalDirective.canPublish ? 25 : 0) -
      (cognitiveKernel.finalDirective.canTrain ? 20 : 0) -
      (cognitiveKernel.controls.canStake ? 30 : 0) -
      (cognitiveKernel.controls.canUseHiddenChainOfThought ? 30 : 0)
  );
  const learning = learningScore(cognitiveKernel.state);

  const metrics = [
    metric({
      id: "evidence",
      label: "Evidence coverage",
      score: evidenceScore,
      evidence: [observe?.signal, `${cognitiveKernel.state.evidenceDebt}/100 evidence debt`, dataTrust?.thesis],
      nextAction: observe?.nextAction ?? cognitiveKernel.finalDirective.expectedEvidence
    }),
    metric({
      id: "uncertainty",
      label: "Uncertainty discipline",
      score: uncertaintyScore,
      evidence: [
        `${cognitiveKernel.state.contradictionCount} contradiction(s)`,
        `${cognitiveKernel.state.consensusScore}/100 consensus`,
        cognitiveKernel.state.strongestObjection
      ],
      nextAction: cognitiveKernel.state.strongestObjection
    }),
    metric({
      id: "model-market",
      label: "Model versus market",
      score: modelMarketScore,
      evidence: [model?.signal, market?.signal, valueThesis?.supports[0], valueThesis?.challenges[0]],
      nextAction: market?.nextAction ?? valueThesis?.falsifier
    }),
    metric({
      id: "counterargument",
      label: "Counterargument quality",
      score: counterargumentScore,
      evidence: [challenge?.signal, cognitiveKernel.state.strongestObjection, valueThesis?.falsifier],
      nextAction: challenge?.nextAction ?? "Keep the strongest objection attached before action."
    }),
    metric({
      id: "action-safety",
      label: "Action safety",
      score: actionSafetyScore,
      evidence: [
        `public stance ${cognitiveKernel.finalDirective.publicStance}`,
        `directive ${cognitiveKernel.finalDirective.action}`,
        act?.signal,
        "Publish, persist, train, stake, and public-pick upgrade controls are locked."
      ],
      nextAction: cognitiveKernel.finalDirective.expectedEvidence
    }),
    metric({
      id: "learning",
      label: "Learning readiness",
      score: learning,
      evidence: [
        learn?.signal,
        `provider learning ${cognitiveKernel.state.providerLearningState}`,
        `corpus memory ${cognitiveKernel.state.corpusMemoryState}`
      ],
      nextAction: learn?.nextAction ?? "Backfill labeled corpus and backtests before learned-weight promotion."
    })
  ];

  const total = clamp(
    evidenceScore * 0.22 +
      uncertaintyScore * 0.16 +
      modelMarketScore * 0.18 +
      counterargumentScore * 0.16 +
      actionSafetyScore * 0.18 +
      learning * 0.1
  );
  const status = scorecardStatus(total, cognitiveKernel, actionSafetyScore);
  const scorecardHash = stableHash({
    kernelHash: cognitiveKernel.kernelHash,
    status,
    total,
    metrics: metrics.map((item) => [item.id, item.score, item.status, item.nextAction])
  });

  return {
    generatedAt: now.toISOString(),
    date: cognitiveKernel.date,
    sport: cognitiveKernel.sport,
    mode: "decision-cognition-scorecard",
    status,
    grade: grade(total),
    scorecardHash,
    summary:
      status === "ready-shadow"
        ? "Cognition scorecard says the agent can inspect a shadow decision with public-safe evidence, uncertainty, challenge, and safety controls attached."
        : status === "blocked"
          ? `Cognition scorecard blocks promotion: ${compact(cognitiveKernel.state.strongestObjection, 150)}`
          : "Cognition scorecard needs more evidence before trust can rise above monitor-only.",
    source: {
      cognitiveKernelHash: cognitiveKernel.kernelHash,
      kernelStatus: cognitiveKernel.status,
      focusMatchId: cognitiveKernel.focus.matchId,
      focusMatch: cognitiveKernel.focus.match,
      directiveAction: cognitiveKernel.finalDirective.action,
      publicStance: cognitiveKernel.finalDirective.publicStance
    },
    score: {
      total,
      evidence: evidenceScore,
      uncertainty: uncertaintyScore,
      modelMarket: modelMarketScore,
      counterargument: counterargumentScore,
      actionSafety: actionSafetyScore,
      learning
    },
    metrics,
    diagnosis: {
      strongestSignal: unique([
        metrics
          .filter((item) => item.status === "pass")
          .sort((a, b) => b.score - a.score)[0]?.label,
        cognitiveKernel.state.workingHypothesis
      ])[0],
      biggestDoubt: cognitiveKernel.state.strongestObjection,
      changeMindIf: valueThesis?.falsifier ?? "Fresh provider or market evidence changes the active thesis.",
      nextSafeAction: cognitiveKernel.finalDirective.verifyUrl
        ? `${cognitiveKernel.finalDirective.action}: ${cognitiveKernel.finalDirective.verifyUrl}`
        : cognitiveKernel.finalDirective.expectedEvidence
    },
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyCommand: cognitiveKernel.controls.canRunReadOnlyCommand,
      canAskOpenAI: cognitiveKernel.controls.canAskOpenAI,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(["/api/sports/decision/cognition-scorecard", "/api/sports/decision/cognitive-kernel", ...cognitiveKernel.proofUrls]),
    locks: unique([
      "Cognition scorecard is public-safe summary reasoning only; hidden chain-of-thought stays disabled.",
      "Cognition scorecard cannot publish picks, persist decisions, train models, stake, or upgrade monitor-only posture.",
      ...cognitiveKernel.locks
    ])
  };
}
