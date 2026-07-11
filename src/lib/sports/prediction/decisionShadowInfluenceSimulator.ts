import type { DecisionBayesianBeliefLedger } from "@/lib/sports/prediction/decisionBayesianBeliefLedger";
import type { DecisionShadowReplayCritic, DecisionShadowReplayCriticEpisodeReview } from "@/lib/sports/prediction/decisionShadowReplayCritic";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import type { Sport } from "@/lib/sports/types";

export type DecisionShadowInfluenceSimulatorStatus = "ready-shadow" | "needs-proof" | "blocked";
export type DecisionShadowInfluenceAction = "observe-more" | "discount-pattern" | "hold-shadow" | "reject-memory";

export type DecisionShadowInfluenceSimulation = {
  id: string;
  episodeId: string;
  action: DecisionShadowInfluenceAction;
  status: "simulated" | "needs-proof" | "blocked";
  usefulnessScore: number;
  riskScore: number;
  expectedEffect: string;
  evidenceFocusDelta: number;
  riskEmphasisDelta: number;
  probabilityDelta: 0;
  publicActionDelta: 0;
  confidenceDelta: 0;
  canApply: false;
  proofUrl: string;
  blockers: string[];
};

export type DecisionShadowInfluenceSimulator = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-shadow-influence-simulator";
  status: DecisionShadowInfluenceSimulatorStatus;
  simulatorHash: string;
  summary: string;
  selectedSimulation: DecisionShadowInfluenceSimulation | null;
  simulations: DecisionShadowInfluenceSimulation[];
  totals: {
    simulations: number;
    simulated: number;
    needsProof: number;
    blocked: number;
    averageEvidenceFocusDelta: number;
    maxRiskEmphasisDelta: number;
  };
  influencePolicy: {
    allowedScope: "shadow-only";
    maxProbabilityDelta: 0;
    maxPublicActionDelta: 0;
    maxConfidenceDelta: 0;
    canInfluenceEvidencePriority: boolean;
    canInfluenceRiskNarrative: boolean;
    canInfluencePublicPick: false;
  };
  controls: {
    canInspectReadOnly: true;
    canUseForShadowPlanning: boolean;
    canPersistMemory: false;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
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

function compact(value: string, max = 280): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function actionFor(review: DecisionShadowReplayCriticEpisodeReview): DecisionShadowInfluenceAction {
  if (review.verdict === "reject") return "reject-memory";
  if (review.verdict === "useful-shadow" && review.riskScore >= 40) return "discount-pattern";
  if (review.verdict === "useful-shadow") return "hold-shadow";
  return "observe-more";
}

function statusForReview(review: DecisionShadowReplayCriticEpisodeReview): DecisionShadowInfluenceSimulation["status"] {
  if (review.verdict === "reject") return "blocked";
  if (review.verdict === "needs-proof") return "needs-proof";
  return "simulated";
}

function expectedEffectFor({
  action,
  review,
  trustFirewall,
  beliefLedger
}: {
  action: DecisionShadowInfluenceAction;
  review: DecisionShadowReplayCriticEpisodeReview;
  trustFirewall: DecisionTrustFirewall;
  beliefLedger: DecisionBayesianBeliefLedger;
}): string {
  if (action === "reject-memory") return `${review.episodeId} is excluded from future shadow planning until blockers clear.`;
  if (action === "observe-more") return `${review.episodeId} should push the next cycle toward proof collection: ${review.nextProof}`;
  if (action === "discount-pattern") {
    return `${review.episodeId} can warn future cycles to discount similar patterns while ${trustFirewall.actionContract.maximumPublicAction} remains the public cap.`;
  }
  return `${review.episodeId} can be held as shadow context for ${beliefLedger.activeBelief?.match ?? "the active slate"} without changing public probability or action.`;
}

function simulationFromReview({
  review,
  trustFirewall,
  beliefLedger
}: {
  review: DecisionShadowReplayCriticEpisodeReview;
  trustFirewall: DecisionTrustFirewall;
  beliefLedger: DecisionBayesianBeliefLedger;
}): DecisionShadowInfluenceSimulation {
  const action = actionFor(review);
  const status = statusForReview(review);
  const evidenceFocusDelta = round(clamp(review.usefulnessScore * 0.45 + review.riskScore * 0.25));
  const riskEmphasisDelta = round(clamp(review.riskScore * 0.7 + (trustFirewall.status === "blocked" ? 18 : 6)));

  return {
    id: `${review.episodeId}:shadow-influence`,
    episodeId: review.episodeId,
    action,
    status,
    usefulnessScore: review.usefulnessScore,
    riskScore: review.riskScore,
    expectedEffect: compact(expectedEffectFor({ action, review, trustFirewall, beliefLedger })),
    evidenceFocusDelta,
    riskEmphasisDelta,
    probabilityDelta: 0,
    publicActionDelta: 0,
    confidenceDelta: 0,
    canApply: false,
    proofUrl: "/api/sports/decision/shadow-replay-critic",
    blockers: unique([
      review.verdict === "needs-proof" ? review.nextProof : null,
      review.verdict === "reject" ? review.reason : null,
      trustFirewall.status === "blocked" ? trustFirewall.actionContract.reason : null
    ], 8)
  };
}

function statusFromSimulations(simulations: DecisionShadowInfluenceSimulation[], critic: DecisionShadowReplayCritic): DecisionShadowInfluenceSimulatorStatus {
  if (!simulations.length || critic.status === "blocked" || simulations.every((simulation) => simulation.status === "blocked")) return "blocked";
  if (critic.status === "needs-proof" || simulations.some((simulation) => simulation.status === "needs-proof")) return "needs-proof";
  return "ready-shadow";
}

function summaryFor(status: DecisionShadowInfluenceSimulatorStatus, totals: DecisionShadowInfluenceSimulator["totals"]): string {
  if (status === "ready-shadow") return `Shadow influence simulator has ${totals.simulated} memory influence(s) ready for read-only planning.`;
  if (status === "blocked") return "Shadow influence simulator blocked memory influence; no simulation can affect public action.";
  return `Shadow influence simulator prepared ${totals.simulations} influence(s), with ${totals.needsProof} still waiting for proof.`;
}

export function buildDecisionShadowInfluenceSimulator({
  date,
  sport,
  shadowReplayCritic,
  trustFirewall,
  beliefLedger,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  shadowReplayCritic: DecisionShadowReplayCritic;
  trustFirewall: DecisionTrustFirewall;
  beliefLedger: DecisionBayesianBeliefLedger;
  now?: Date;
}): DecisionShadowInfluenceSimulator {
  const simulations = shadowReplayCritic.reviews.map((review) => simulationFromReview({ review, trustFirewall, beliefLedger }));
  const selectedSimulation =
    simulations
      .slice()
      .sort((a, b) => {
        const statusRank = { blocked: 3, "needs-proof": 2, simulated: 1 };
        return statusRank[b.status] - statusRank[a.status] || b.riskEmphasisDelta - a.riskEmphasisDelta || b.evidenceFocusDelta - a.evidenceFocusDelta;
      })[0] ?? null;
  const totals = {
    simulations: simulations.length,
    simulated: simulations.filter((simulation) => simulation.status === "simulated").length,
    needsProof: simulations.filter((simulation) => simulation.status === "needs-proof").length,
    blocked: simulations.filter((simulation) => simulation.status === "blocked").length,
    averageEvidenceFocusDelta: round(simulations.reduce((sum, simulation) => sum + simulation.evidenceFocusDelta, 0) / Math.max(1, simulations.length)),
    maxRiskEmphasisDelta: round(Math.max(0, ...simulations.map((simulation) => simulation.riskEmphasisDelta)))
  };
  const status = statusFromSimulations(simulations, shadowReplayCritic);
  const simulatorHash = stableHash({
    date,
    sport,
    critic: shadowReplayCritic.criticHash,
    firewall: trustFirewall.firewallHash,
    belief: beliefLedger.ledgerHash,
    simulations: simulations.map((simulation) => [simulation.id, simulation.action, simulation.status, simulation.evidenceFocusDelta, simulation.riskEmphasisDelta])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-shadow-influence-simulator",
    status,
    simulatorHash,
    summary: summaryFor(status, totals),
    selectedSimulation,
    simulations,
    totals,
    influencePolicy: {
      allowedScope: "shadow-only",
      maxProbabilityDelta: 0,
      maxPublicActionDelta: 0,
      maxConfidenceDelta: 0,
      canInfluenceEvidencePriority: status !== "blocked",
      canInfluenceRiskNarrative: status !== "blocked",
      canInfluencePublicPick: false
    },
    controls: {
      canInspectReadOnly: true,
      canUseForShadowPlanning: status !== "blocked",
      canPersistMemory: false,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/shadow-influence-simulator",
      "/api/sports/decision/shadow-replay-critic",
      "/api/sports/decision/trust-firewall",
      "/api/sports/decision/bayesian-belief-ledger",
      ...shadowReplayCritic.proofUrls,
      ...trustFirewall.proofUrls,
      ...beliefLedger.proofUrls
    ], 42),
    locks: unique([
      "Shadow influence simulator can change only read-only planning language; it cannot change probabilities, confidence, public action, or stakes.",
      "Memory influence remains shadow-only until proof, outcome, calibration, Supabase, and promotion gates pass.",
      "The simulator does not persist memory, write training rows, apply learned weights, or expose hidden chain-of-thought.",
      ...shadowReplayCritic.locks,
      ...trustFirewall.locks,
      ...beliefLedger.locks
    ], 38)
  };
}
