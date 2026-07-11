import type { DecisionBayesianBeliefLedger } from "@/lib/sports/prediction/decisionBayesianBeliefLedger";
import type {
  DecisionEvidenceAcquisitionCandidate,
  DecisionEvidenceAcquisitionPlanner
} from "@/lib/sports/prediction/decisionEvidenceAcquisitionPlanner";
import type { DecisionBrainReviewRunner } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import type { DecisionBrainState, DecisionBrainStateTrustCeiling } from "@/lib/sports/prediction/decisionBrainState";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionInterventionPlannerStatus = "ready-readonly" | "needs-evidence" | "waiting-openai" | "blocked";
export type DecisionInterventionKind = "evidence-supports" | "evidence-challenges" | "evidence-missing" | "market-drift" | "ai-review";
export type DecisionInterventionOutcome = "strengthen-shadow" | "hold-monitor" | "downgrade" | "block";

export type DecisionInterventionScenario = {
  id: string;
  kind: DecisionInterventionKind;
  sourceId: string;
  label: string;
  status: "pass" | "watch" | "block";
  informationGainScore: number;
  baseline: {
    action: DecisionAction | "hold";
    trustCeiling: DecisionBrainStateTrustCeiling;
    posteriorProbability: number | null;
    expectedValue: number | null;
  };
  projected: {
    action: DecisionAction | "hold";
    trustCeiling: DecisionBrainStateTrustCeiling;
    posteriorProbability: number | null;
    expectedValue: number | null;
    probabilityDelta: number | null;
    expectedValueDelta: number | null;
  };
  outcome: DecisionInterventionOutcome;
  thesisChange: string;
  evidenceNeeded: string;
  ifObserved: string;
  ifMissing: string;
  safeNextCommand: string | null;
  verifyUrl: string | null;
  locks: string[];
};

export type DecisionInterventionPlanner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-intervention-planner";
  status: DecisionInterventionPlannerStatus;
  plannerHash: string;
  summary: string;
  activeScenario: DecisionInterventionScenario | null;
  scenarios: DecisionInterventionScenario[];
  totals: {
    scenarios: number;
    strengthenShadow: number;
    holdMonitor: number;
    downgrade: number;
    block: number;
    averageInformationGain: number;
    maxProjectedProbabilityDelta: number | null;
  };
  interventionPolicy: {
    question: string;
    rule: string;
    canRunSafeCommand: boolean;
    canApplyProjection: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextSafeCommand: boolean;
    canAskOpenAI: boolean;
    canApplyProjection: false;
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

function compact(value: string, maxLength = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round(value: number | null | undefined, digits = 4): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

function add(value: number | null, delta: number, min = 0, max = 1): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return round(Math.max(min, Math.min(max, value + delta)));
}

function actionRank(action: DecisionAction | "hold"): number {
  if (action === "consider") return 3;
  if (action === "monitor") return 2;
  if (action === "avoid") return 1;
  return 0;
}

function ceilingRank(ceiling: DecisionBrainStateTrustCeiling): number {
  if (ceiling === "candidate") return 3;
  if (ceiling === "monitor") return 2;
  if (ceiling === "shadow") return 1;
  return 0;
}

function ceilingFromRank(rank: number): DecisionBrainStateTrustCeiling {
  if (rank >= 3) return "candidate";
  if (rank === 2) return "monitor";
  if (rank === 1) return "shadow";
  return "none";
}

function actionFromRank(rank: number): DecisionAction | "hold" {
  if (rank >= 3) return "consider";
  if (rank === 2) return "monitor";
  if (rank === 1) return "avoid";
  return "hold";
}

function outcomeFor({
  baselineAction,
  projectedAction,
  projectedCeiling
}: {
  baselineAction: DecisionAction | "hold";
  projectedAction: DecisionAction | "hold";
  projectedCeiling: DecisionBrainStateTrustCeiling;
}): DecisionInterventionOutcome {
  if (projectedCeiling === "none" || projectedAction === "avoid" || projectedAction === "hold") return "block";
  if (actionRank(projectedAction) < actionRank(baselineAction)) return "downgrade";
  if (projectedAction === "monitor" || projectedCeiling === "monitor" || projectedCeiling === "shadow") return "hold-monitor";
  return "strengthen-shadow";
}

function scenarioStatus(outcome: DecisionInterventionOutcome): DecisionInterventionScenario["status"] {
  if (outcome === "strengthen-shadow") return "pass";
  if (outcome === "hold-monitor") return "watch";
  return "block";
}

function safeCommand(candidate: DecisionEvidenceAcquisitionCandidate | null): string | null {
  return candidate?.safeToRun ? candidate.command : null;
}

function scenarioFromCandidate({
  candidate,
  brainState,
  kind,
  probabilityDelta,
  expectedValueDelta,
  actionDelta,
  ceilingDelta
}: {
  candidate: DecisionEvidenceAcquisitionCandidate;
  brainState: DecisionBrainState;
  kind: DecisionInterventionKind;
  probabilityDelta: number;
  expectedValueDelta: number;
  actionDelta: number;
  ceilingDelta: number;
}): DecisionInterventionScenario {
  const baseline = brainState.activeThesis;
  const projectedAction = actionFromRank(Math.max(0, Math.min(3, actionRank(baseline.baselineAction) + actionDelta)));
  const projectedCeiling = ceilingFromRank(Math.max(0, Math.min(3, ceilingRank(baseline.confidenceCeiling) + ceilingDelta)));
  const outcome = outcomeFor({
    baselineAction: baseline.baselineAction,
    projectedAction,
    projectedCeiling
  });

  return {
    id: `intervention-${kind}-${candidate.id}`,
    kind,
    sourceId: candidate.id,
    label: candidate.label,
    status: scenarioStatus(outcome),
    informationGainScore: candidate.informationGainScore,
    baseline: {
      action: baseline.baselineAction,
      trustCeiling: baseline.confidenceCeiling,
      posteriorProbability: baseline.posteriorProbability,
      expectedValue: baseline.expectedValue
    },
    projected: {
      action: projectedAction,
      trustCeiling: projectedCeiling,
      posteriorProbability: add(baseline.posteriorProbability, probabilityDelta),
      expectedValue: add(baseline.expectedValue, expectedValueDelta, -1, 1),
      probabilityDelta: round(probabilityDelta),
      expectedValueDelta: round(expectedValueDelta)
    },
    outcome,
    thesisChange:
      outcome === "strengthen-shadow"
        ? compact(`${candidate.label} would support the active thesis, but still only as a shadow candidate until the full gate clears.`)
        : outcome === "hold-monitor"
          ? compact(`${candidate.label} would keep the brain in monitor mode while remaining uncertainty is resolved.`)
          : compact(`${candidate.label} would weaken or block the active thesis and force the engine away from promotion.`),
    evidenceNeeded: candidate.expectedEvidence,
    ifObserved: compact(candidate.expectedBeliefChange),
    ifMissing: compact(candidate.ifMissing),
    safeNextCommand: safeCommand(candidate),
    verifyUrl: candidate.verifyUrl,
    locks: unique([
      candidate.safeToRun ? null : "Candidate command is not safe to run automatically.",
      ...candidate.missingEnv,
      ...candidate.blockers,
      "Projection is advisory only and cannot persist, publish, train, stake, or upgrade public action."
    ])
  };
}

function aiReviewScenario({
  brainState,
  brainReviewRunner
}: {
  brainState: DecisionBrainState;
  brainReviewRunner: DecisionBrainReviewRunner;
}): DecisionInterventionScenario {
  const baseline = brainState.activeThesis;
  const ready = brainReviewRunner.controls.canRequestOpenAI;
  const actionDelta = ready ? 0 : -1;
  const ceilingDelta = brainReviewRunner.status === "reviewed" ? 1 : ready ? 0 : -1;
  const projectedAction = actionFromRank(Math.max(0, Math.min(3, actionRank(baseline.baselineAction) + actionDelta)));
  const projectedCeiling = ceilingFromRank(Math.max(0, Math.min(3, ceilingRank(baseline.confidenceCeiling) + ceilingDelta)));
  const outcome = outcomeFor({ baselineAction: baseline.baselineAction, projectedAction, projectedCeiling });

  return {
    id: "intervention-ai-review-brain-runner",
    kind: "ai-review",
    sourceId: brainReviewRunner.runnerHash,
    label: "Guarded OpenAI brain review",
    status: scenarioStatus(outcome),
    informationGainScore: ready ? 82 : brainReviewRunner.status === "reviewed" ? 48 : 34,
    baseline: {
      action: baseline.baselineAction,
      trustCeiling: baseline.confidenceCeiling,
      posteriorProbability: baseline.posteriorProbability,
      expectedValue: baseline.expectedValue
    },
    projected: {
      action: projectedAction,
      trustCeiling: projectedCeiling,
      posteriorProbability: add(baseline.posteriorProbability, brainReviewRunner.status === "reviewed" ? 0.015 : 0),
      expectedValue: baseline.expectedValue,
      probabilityDelta: brainReviewRunner.status === "reviewed" ? 0.015 : 0,
      expectedValueDelta: 0
    },
    outcome,
    thesisChange:
      brainReviewRunner.status === "reviewed"
        ? "A valid same-or-safer AI review can reduce uncertainty, but cannot upgrade the public action by itself."
        : "The AI review route is still a blocker or waiting condition, so the brain must rely on deterministic fallback.",
    evidenceNeeded: "Valid same-or-safer OpenAI JSON review with no persistence, publishing, training, staking, or trust upgrade.",
    ifObserved: brainReviewRunner.appliedReview.summary,
    ifMissing: brainReviewRunner.latestRun.reason ?? brainReviewRunner.summary,
    safeNextCommand: ready ? null : null,
    verifyUrl: "/api/sports/decision/brain-review-runner?run=1",
    locks: unique([
      brainReviewRunner.latestRun.reason,
      "AI review is advisory only and same-or-safer than deterministic fallback.",
      ...brainReviewRunner.locks
    ])
  };
}

function sortScenarios(items: DecisionInterventionScenario[]): DecisionInterventionScenario[] {
  return items.slice().sort((a, b) => {
    const statusDelta = (b.status === "block" ? 3 : b.status === "watch" ? 2 : 1) - (a.status === "block" ? 3 : a.status === "watch" ? 2 : 1);
    if (statusDelta !== 0) return statusDelta;
    return b.informationGainScore - a.informationGainScore;
  });
}

function statusFor({
  brainState,
  brainReviewRunner,
  scenarios
}: {
  brainState: DecisionBrainState;
  brainReviewRunner: DecisionBrainReviewRunner;
  scenarios: DecisionInterventionScenario[];
}): DecisionInterventionPlannerStatus {
  if (brainState.status === "blocked" || scenarios.some((item) => item.outcome === "block")) return "blocked";
  if (brainReviewRunner.status === "quota-or-billing-blocked" || brainReviewRunner.status === "not-configured") return "waiting-openai";
  if (scenarios.some((item) => item.status === "watch")) return "needs-evidence";
  return "ready-readonly";
}

export function buildDecisionInterventionPlanner({
  date,
  sport,
  brainState,
  beliefLedger,
  evidenceAcquisitionPlanner,
  brainReviewRunner,
  now = new Date(),
  limit = 8
}: {
  date: string;
  sport: Sport;
  brainState: DecisionBrainState;
  beliefLedger: DecisionBayesianBeliefLedger;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  brainReviewRunner: DecisionBrainReviewRunner;
  now?: Date;
  limit?: number;
}): DecisionInterventionPlanner {
  const candidates = evidenceAcquisitionPlanner.candidates.slice(0, Math.max(1, limit - 1));
  const scenarios = sortScenarios([
    ...candidates.flatMap((candidate) => [
      scenarioFromCandidate({
        candidate,
        brainState,
        kind: "evidence-supports",
        probabilityDelta: Math.min(0.06, candidate.informationGainScore / 1600),
        expectedValueDelta: Math.min(0.05, candidate.informationGainScore / 2200),
        actionDelta: candidate.priority === "critical" ? 0 : 1,
        ceilingDelta: candidate.status === "ready" ? 1 : 0
      }),
      scenarioFromCandidate({
        candidate,
        brainState,
        kind: candidate.category === "odds" ? "market-drift" : "evidence-challenges",
        probabilityDelta: -Math.min(0.08, candidate.informationGainScore / 1300),
        expectedValueDelta: -Math.min(0.08, candidate.informationGainScore / 1400),
        actionDelta: -1,
        ceilingDelta: -1
      }),
      scenarioFromCandidate({
        candidate,
        brainState,
        kind: "evidence-missing",
        probabilityDelta: -Math.min(0.04, candidate.informationGainScore / 2500),
        expectedValueDelta: -Math.min(0.04, candidate.informationGainScore / 2600),
        actionDelta: 0,
        ceilingDelta: -1
      })
    ]),
    aiReviewScenario({ brainState, brainReviewRunner })
  ]).slice(0, limit);

  const activeScenario = scenarios[0] ?? null;
  const status = statusFor({ brainState, brainReviewRunner, scenarios });
  const probabilityDeltas = scenarios
    .map((item) => Math.abs(item.projected.probabilityDelta ?? 0))
    .filter((value) => Number.isFinite(value));
  const maxProjectedProbabilityDelta = probabilityDeltas.length ? round(Math.max(...probabilityDeltas)) : null;
  const nextSafeCommand = scenarios.find((item) => item.safeNextCommand)?.safeNextCommand ?? evidenceAcquisitionPlanner.nextCandidate?.command ?? null;

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-intervention-planner",
    status,
    plannerHash: stableHash({
      date,
      sport,
      brain: brainState.brainHash,
      belief: beliefLedger.ledgerHash,
      acquisition: evidenceAcquisitionPlanner.plannerHash,
      runner: brainReviewRunner.runnerHash,
      scenarios: scenarios.map((item) => [item.id, item.outcome, item.projected.action, item.projected.trustCeiling])
    }),
    summary:
      status === "blocked"
        ? "Intervention planner found a scenario that blocks or downgrades the active thesis; keep the brain away from promotion."
        : status === "waiting-openai"
          ? "Intervention planner is ready, but the AI review intervention is waiting on OpenAI configuration or quota."
          : status === "needs-evidence"
            ? "Intervention planner has watch scenarios that need provider-backed evidence before trust can rise."
            : "Intervention planner can inspect how the active thesis changes under the next evidence interventions.",
    activeScenario,
    scenarios,
    totals: {
      scenarios: scenarios.length,
      strengthenShadow: scenarios.filter((item) => item.outcome === "strengthen-shadow").length,
      holdMonitor: scenarios.filter((item) => item.outcome === "hold-monitor").length,
      downgrade: scenarios.filter((item) => item.outcome === "downgrade").length,
      block: scenarios.filter((item) => item.outcome === "block").length,
      averageInformationGain: average(scenarios.map((item) => item.informationGainScore)),
      maxProjectedProbabilityDelta
    },
    interventionPolicy: {
      question: "Which next evidence observation would most change the active decision, and what happens if it supports, challenges, or stays missing?",
      rule: "Simulate belief/action/trust changes before acting; projections are advisory and cannot apply themselves.",
      canRunSafeCommand: Boolean(nextSafeCommand),
      canApplyProjection: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false
    },
    controls: {
      canInspectReadOnly: true,
      canRunNextSafeCommand: Boolean(nextSafeCommand),
      canAskOpenAI: brainReviewRunner.controls.canRequestOpenAI,
      canApplyProjection: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/intervention-planner",
      "/api/sports/decision/brain-state",
      "/api/sports/decision/evidence-acquisition-planner",
      "/api/sports/decision/brain-review-runner",
      ...brainState.proofUrls,
      ...evidenceAcquisitionPlanner.proofUrls,
      ...brainReviewRunner.proofUrls
    ], 24),
    locks: unique([
      "Intervention projections are read-only and cannot apply themselves.",
      "Planner cannot persist decisions, publish picks, train models, stake, or upgrade public action.",
      "A support scenario only strengthens a shadow thesis after source evidence is actually observed.",
      ...brainState.locks,
      ...brainReviewRunner.locks
    ], 24)
  };
}
