import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionModelCards } from "@/lib/sports/prediction/decisionModelCards";
import type { DecisionWorldModelCritic } from "@/lib/sports/prediction/decisionWorldModelCritic";
import type { TrainingDataBlueprint } from "@/lib/sports/training/trainingDataBlueprint";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionRequirementPulseStatus = "ready" | "watch" | "blocked";
export type DecisionRequirementPulseGroupId =
  | "data-layer"
  | "prediction-engine"
  | "odds-intelligence"
  | "ai-review"
  | "training-data"
  | "responsible-controls";

export type DecisionRequirementPulseGroup = {
  id: DecisionRequirementPulseGroupId;
  label: string;
  status: DecisionRequirementPulseStatus;
  score: number;
  evidence: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionRequirementPulse = {
  mode: "decision-requirement-pulse";
  generatedAt: string;
  date: string;
  sportScope: "multi-sport";
  status: DecisionRequirementPulseStatus;
  pulseHash: string;
  summary: string;
  counts: Record<DecisionRequirementPulseStatus, number>;
  groups: DecisionRequirementPulseGroup[];
  topGap: DecisionRequirementPulseGroup | null;
  controls: {
    canInspectReadOnly: true;
    canRunLiveAIReview: boolean;
    canRunProviderDryRun: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
  };
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

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function countByStatus(groups: DecisionRequirementPulseGroup[]): Record<DecisionRequirementPulseStatus, number> {
  return {
    ready: groups.filter((item) => item.status === "ready").length,
    watch: groups.filter((item) => item.status === "watch").length,
    blocked: groups.filter((item) => item.status === "blocked").length
  };
}

function statusFromGroups(groups: DecisionRequirementPulseGroup[]): DecisionRequirementPulseStatus {
  if (groups.some((item) => item.status === "blocked")) return "blocked";
  if (groups.some((item) => item.status === "watch")) return "watch";
  return "ready";
}

function valueCandidateCount(rows: DecisionRow[]): number {
  return rows.reduce((sum, row) => sum + row.prediction.decision.oddsIntelligence.actionableSelections, 0);
}

function totalMarketCount(rows: DecisionRow[]): number {
  return rows.reduce((sum, row) => sum + row.prediction.decision.oddsIntelligence.totalMarkets, 0);
}

function avoidReasonCount(rows: DecisionRow[]): number {
  return rows.reduce((sum, row) => sum + row.prediction.decision.avoidReasons.length + row.prediction.decision.risks.length, 0);
}

function sportsCovered(modelCards: DecisionModelCards): Sport[] {
  return modelCards.cards.map((card) => card.sport);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildDecisionRequirementPulse({
  date,
  rows,
  dataAuthority,
  modelCards,
  trainingBlueprint,
  worldModelCritic,
  aiReviewReadiness,
  now = new Date()
}: {
  date: string;
  rows: DecisionRow[];
  dataAuthority: DecisionDataAuthority;
  modelCards: DecisionModelCards;
  trainingBlueprint: TrainingDataBlueprint;
  worldModelCritic: DecisionWorldModelCritic;
  aiReviewReadiness: DecisionAIReviewReadiness;
  now?: Date;
}): DecisionRequirementPulse {
  const coveredSports = sportsCovered(modelCards);
  const missingModelSports = ["football", "basketball", "tennis"].filter((sport) => !coveredSports.includes(sport as Sport));
  const valueCandidates = valueCandidateCount(rows);
  const marketCount = totalMarketCount(rows);
  const riskNotes = avoidReasonCount(rows);
  const trainingReadySports = trainingBlueprint.sports.filter((sport) => sport.gates.every((gate) => gate.status !== "block")).length;

  const groups: DecisionRequirementPulseGroup[] = [
    {
      id: "data-layer",
      label: "Data layer",
      status: dataAuthority.status === "blocked" ? "blocked" : dataAuthority.status === "dry-run-ready" || dataAuthority.status === "live-authorized" ? "ready" : "watch",
      score: dataAuthority.trustScore,
      evidence: `${dataAuthority.totals.families} feed families; ${dataAuthority.totals.dryRunReady} dry-run ready, ${dataAuthority.totals.computedShadow} computed-shadow, ${dataAuthority.totals.needsProviderEnv + dataAuthority.totals.needsSupabaseProof + dataAuthority.totals.trainingBlocked + dataAuthority.totals.blocked} blocked or waiting.`,
      nextAction: dataAuthority.nextCommand.label,
      proofUrl: "/api/sports/decision/data-authority"
    },
    {
      id: "prediction-engine",
      label: "Prediction engine",
      status: modelCards.totals.cards === 0 ? "blocked" : missingModelSports.length || modelCards.status !== "ready" ? "watch" : "ready",
      score: clamp((modelCards.totals.cards / 3) * 55 + modelCards.totals.averageTrustScore * 0.45),
      evidence: `${coveredSports.length}/3 sport model card(s): ${coveredSports.join(", ") || "none"}. Missing: ${missingModelSports.join(", ") || "none"}.`,
      nextAction: missingModelSports.length ? "Build compact model-card inputs for every MVP sport." : modelCards.cards[0]?.upgradePath[0] ?? "Keep model cards attached to every slate.",
      proofUrl: "/api/sports/decision/model-cards?sport=all"
    },
    {
      id: "odds-intelligence",
      label: "Odds intelligence",
      status: marketCount > 0 && riskNotes > 0 ? "ready" : marketCount > 0 ? "watch" : "blocked",
      score: clamp((marketCount > 0 ? 45 : 0) + Math.min(valueCandidates, 5) * 7 + Math.min(riskNotes, 20)),
      evidence: `${marketCount} market audit(s), ${valueCandidates} actionable value candidate(s), ${riskNotes} risk or avoid note(s).`,
      nextAction: valueCandidates ? "Refresh odds before any operator action and keep safer alternatives visible." : "Keep watch/avoid posture until positive EV survives no-vig and risk checks.",
      proofUrl: "/api/sports/decision/odds-board"
    },
    {
      id: "ai-review",
      label: "AI review",
      status: aiReviewReadiness.status === "ready-to-run" ? "ready" : aiReviewReadiness.status === "needs-key" ? "watch" : "blocked",
      score: clamp((aiReviewReadiness.totals.deterministicFallbacks / Math.max(1, aiReviewReadiness.totals.lanes)) * 45 + (aiReviewReadiness.openAiConfigured ? 55 : 0)),
      evidence: `${aiReviewReadiness.totals.lanes} OpenAI review contract(s), ${aiReviewReadiness.totals.deterministicFallbacks} deterministic fallback(s), cognitive proof, evidence graph, and thinking introspection linked, missing env ${aiReviewReadiness.missingEnv.join(", ") || "none"}.`,
      nextAction: aiReviewReadiness.openAiConfigured ? aiReviewReadiness.nextSafeCommand.label : "Inspect cognitive proof, evidence graph, and thinking introspection, then set OPENAI_API_KEY before any guarded live review.",
      proofUrl: "/api/sports/decision/ai-review-readiness"
    },
    {
      id: "training-data",
      label: "Training data",
      status: trainingBlueprint.status === "ready-dry-run" ? "ready" : trainingBlueprint.status === "blocked" ? "blocked" : "watch",
      score: clamp((trainingReadySports / Math.max(1, trainingBlueprint.sports.length)) * 40 + (trainingBlueprint.controls.canRunDryRun ? 35 : 0) + Math.min(trainingBlueprint.storageTables.length, 15)),
      evidence: `${trainingBlueprint.sports.length} sport corpus plan(s), ${trainingBlueprint.storageTables.length} storage table(s), ${trainingBlueprint.corpusTargets.totalEstimatedHistoricalMatches} estimated historical matches.`,
      nextAction: trainingBlueprint.nextSafeCommand.label,
      proofUrl: "/api/sports/decision/training/data-blueprint"
    },
    {
      id: "responsible-controls",
      label: "Responsible controls",
      status: worldModelCritic.controls.canPersist || worldModelCritic.controls.canPublish || worldModelCritic.controls.canTrain ? "blocked" : "ready",
      score: worldModelCritic.controls.canPersist || worldModelCritic.controls.canPublish || worldModelCritic.controls.canTrain ? 0 : 100,
      evidence: `World critic public action ${worldModelCritic.verdict.publicAction}; persist=${worldModelCritic.controls.canPersist}, publish=${worldModelCritic.controls.canPublish}, train=${worldModelCritic.controls.canTrain}.`,
      nextAction: worldModelCritic.verdict.reason,
      proofUrl: "/api/sports/decision/world-model-critic"
    }
  ];
  const counts = countByStatus(groups);
  const status = statusFromGroups(groups);
  const topGap = groups.find((item) => item.status === "blocked") ?? groups.find((item) => item.status === "watch") ?? null;
  const proofUrls = unique([
    "/api/sports/decision/requirement-pulse",
    "/api/sports/decision/mvp-audit",
    ...groups.map((item) => item.proofUrl),
    ...aiReviewReadiness.proofUrls
  ]);

  return {
    mode: "decision-requirement-pulse",
    generatedAt: now.toISOString(),
    date,
    sportScope: "multi-sport",
    status,
    pulseHash: stableHash({
      date,
      status,
      groups: groups.map((item) => [item.id, item.status, item.score]),
      ai: aiReviewReadiness.readinessHash,
      data: dataAuthority.authorityHash,
      training: trainingBlueprint.blueprintHash
    }),
    summary:
      status === "ready"
        ? `Original MVP requirements are ready across ${counts.ready} group(s).`
        : `Original MVP requirements: ${counts.ready} ready, ${counts.watch} watch, ${counts.blocked} blocked.`,
    counts,
    groups,
    topGap,
    controls: {
      canInspectReadOnly: true,
      canRunLiveAIReview: aiReviewReadiness.controls.canRunLiveReview,
      canRunProviderDryRun: dataAuthority.controls.canRunProviderDryRun || trainingBlueprint.controls.canRunDryRun,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    proofUrls
  };
}
