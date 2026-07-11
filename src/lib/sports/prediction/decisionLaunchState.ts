import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionLaunchCommander } from "@/lib/sports/prediction/decisionLaunchCommander";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionOriginalBriefCoverage, DecisionOriginalBriefCoverageSectionId } from "@/lib/sports/prediction/decisionOriginalBriefCoverage";
import type { DecisionRequirementPulse, DecisionRequirementPulseGroupId } from "@/lib/sports/prediction/decisionRequirementPulse";
import type { DecisionSupabaseProofBinder } from "@/lib/sports/prediction/decisionSupabaseProofBinder";
import type { Sport } from "@/lib/sports/types";
import type { TrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";

export type DecisionLaunchStateStatus = "live-review-ready" | "shadow-operational" | "proof-ready" | "blocked";
export type DecisionLaunchStateLaneStatus = "live" | "shadow" | "ready-proof" | "locked" | "blocked";
export type DecisionLaunchStateLaneId = "deterministic-engine" | "data-layer" | "odds-intelligence" | "ai-review" | "supabase-storage" | "training-corpus" | "public-action";

export type DecisionLaunchStateLane = {
  id: DecisionLaunchStateLaneId;
  label: string;
  status: DecisionLaunchStateLaneStatus;
  score: number;
  evidence: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionLaunchState = {
  mode: "decision-launch-state";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionLaunchStateStatus;
  stateHash: string;
  summary: string;
  posture: {
    engineMode: "deterministic-shadow" | "live-ai-review-ready" | "proof-first" | "blocked";
    publicAction: "no-public-picks" | "monitor-only";
    primaryBlocker: string | null;
    nextProof: string | null;
    nextCommand: string | null;
  };
  lanes: DecisionLaunchStateLane[];
  totals: Record<DecisionLaunchStateLaneStatus, number>;
  controls: {
    canInspectReadOnly: true;
    canRunNextProof: boolean;
    canRunOpenAIReview: boolean;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function pulseGroup(pulse: DecisionRequirementPulse, id: DecisionRequirementPulseGroupId) {
  return pulse.groups.find((group) => group.id === id) ?? null;
}

function coverageSection(coverage: DecisionOriginalBriefCoverage, id: DecisionOriginalBriefCoverageSectionId) {
  return coverage.sections.find((section) => section.id === id) ?? null;
}

function lane(input: DecisionLaunchStateLane): DecisionLaunchStateLane {
  return {
    ...input,
    score: clamp(input.score)
  };
}

function totalsFor(lanes: DecisionLaunchStateLane[]): DecisionLaunchState["totals"] {
  return {
    live: lanes.filter((item) => item.status === "live").length,
    shadow: lanes.filter((item) => item.status === "shadow").length,
    "ready-proof": lanes.filter((item) => item.status === "ready-proof").length,
    locked: lanes.filter((item) => item.status === "locked").length,
    blocked: lanes.filter((item) => item.status === "blocked").length
  };
}

function stateStatus({
  lanes,
  launchCommander,
  openAiKeyDiagnostic
}: {
  lanes: DecisionLaunchStateLane[];
  launchCommander: DecisionLaunchCommander;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
}): DecisionLaunchStateStatus {
  const criticalBlocked = lanes.some((item) => item.status === "blocked" && item.id !== "ai-review");
  if (criticalBlocked) return "blocked";
  if (openAiKeyDiagnostic.status === "ready-to-request" && launchCommander.controls.canRunOpenAIReview) return "live-review-ready";
  if (launchCommander.controls.canRunNextCommand || lanes.some((item) => item.status === "ready-proof")) return "proof-ready";
  return "shadow-operational";
}

function summaryFor(status: DecisionLaunchStateStatus, primaryBlocker: string | null): string {
  if (status === "live-review-ready") return "Decision engine is ready for guarded live AI review, while publish, persist, train, and upgrade controls remain locked.";
  if (status === "proof-ready") return `Decision engine is operational in shadow mode and has a safe proof ready${primaryBlocker ? `: ${primaryBlocker}` : "."}`;
  if (status === "blocked") return `Decision engine has a launch blocker before live use${primaryBlocker ? `: ${primaryBlocker}` : "."}`;
  return "Decision engine is operational in deterministic shadow mode; OpenAI review, persistence, training, and public picks are still locked.";
}

export function buildDecisionLaunchState({
  date,
  sport,
  launchCommander,
  requirementPulse,
  openAiKeyDiagnostic,
  originalBriefCoverage,
  dataAuthority,
  supabaseProofBinder,
  trainingCorpusProof,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  launchCommander: DecisionLaunchCommander;
  requirementPulse: DecisionRequirementPulse;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  originalBriefCoverage: DecisionOriginalBriefCoverage;
  dataAuthority: DecisionDataAuthority;
  supabaseProofBinder: DecisionSupabaseProofBinder;
  trainingCorpusProof: TrainingCorpusProof;
  now?: Date;
}): DecisionLaunchState {
  const predictionGroup = pulseGroup(requirementPulse, "prediction-engine");
  const dataGroup = pulseGroup(requirementPulse, "data-layer");
  const oddsGroup = pulseGroup(requirementPulse, "odds-intelligence");
  const aiGroup = pulseGroup(requirementPulse, "ai-review");
  const trainingGroup = pulseGroup(requirementPulse, "training-data");
  const dataSection = coverageSection(originalBriefCoverage, "data-layer");
  const oddsSection = coverageSection(originalBriefCoverage, "odds-intelligence");
  const aiSection = coverageSection(originalBriefCoverage, "ai-explanation");

  const lanes = [
    lane({
      id: "deterministic-engine",
      label: "Deterministic thinking engine",
      status: predictionGroup?.status === "blocked" ? "blocked" : "live",
      score: predictionGroup?.score ?? 0,
      evidence: predictionGroup?.evidence ?? "Prediction-engine requirement pulse is missing.",
      nextAction: predictionGroup?.nextAction ?? "Restore model-card and prediction-engine proofs.",
      proofUrl: predictionGroup?.proofUrl ?? "/api/sports/decision/model-cards?sport=all"
    }),
    lane({
      id: "data-layer",
      label: "Data layer",
      status: dataAuthority.status === "live-authorized" ? "live" : dataAuthority.status === "dry-run-ready" ? "ready-proof" : dataGroup?.status === "blocked" ? "blocked" : "shadow",
      score: dataGroup?.score ?? dataAuthority.trustScore,
      evidence: dataSection ? `${dataSection.counts.real} real, ${dataSection.counts.shadow} shadow, ${dataSection.counts.blocked} blocked requirement item(s).` : dataAuthority.summary,
      nextAction: dataAuthority.nextCommand.label,
      proofUrl: "/api/sports/decision/data-authority"
    }),
    lane({
      id: "odds-intelligence",
      label: "Odds intelligence",
      status: oddsGroup?.status === "ready" ? "live" : oddsGroup?.status === "blocked" ? "blocked" : "shadow",
      score: oddsGroup?.score ?? 0,
      evidence: oddsSection ? `${oddsSection.counts.real} real, ${oddsSection.counts.shadow} shadow, ${oddsSection.counts.blocked} blocked odds requirement item(s).` : oddsGroup?.evidence ?? "Odds proof is missing.",
      nextAction: oddsGroup?.nextAction ?? "Refresh odds-intelligence proof.",
      proofUrl: oddsGroup?.proofUrl ?? "/api/sports/decision/odds-intelligence-proof"
    }),
    lane({
      id: "ai-review",
      label: "OpenAI review",
      status: openAiKeyDiagnostic.status === "ready-to-request" ? "ready-proof" : openAiKeyDiagnostic.status === "missing-key" ? "locked" : aiGroup?.status === "blocked" ? "blocked" : "shadow",
      score: aiGroup?.score ?? 0,
      evidence: aiSection ? `${aiSection.counts.real} real, ${aiSection.counts.shadow} shadow, ${aiSection.counts.blocked} blocked AI explanation item(s). ${openAiKeyDiagnostic.summary}` : openAiKeyDiagnostic.summary,
      nextAction: openAiKeyDiagnostic.nextStep.label,
      proofUrl: "/api/sports/decision/openai-key-diagnostic"
    }),
    lane({
      id: "supabase-storage",
      label: "Supabase storage",
      status: supabaseProofBinder.status === "ready-proof" ? "ready-proof" : supabaseProofBinder.status.startsWith("blocked") ? "blocked" : "locked",
      score: supabaseProofBinder.status === "ready-proof" ? 85 : supabaseProofBinder.status.startsWith("blocked") ? 0 : 35,
      evidence: supabaseProofBinder.summary,
      nextAction: supabaseProofBinder.nextProof.label,
      proofUrl: supabaseProofBinder.nextProof.verifyUrl
    }),
    lane({
      id: "training-corpus",
      label: "10-year corpus and training",
      status: trainingCorpusProof.status === "shadow-ready" ? "ready-proof" : trainingCorpusProof.status === "blocked-supabase" ? "blocked" : trainingCorpusProof.status === "ready-dry-run" ? "ready-proof" : "locked",
      score: trainingGroup?.score ?? 0,
      evidence: trainingGroup?.evidence ?? trainingCorpusProof.summary,
      nextAction: trainingCorpusProof.nextProof.label,
      proofUrl: trainingCorpusProof.nextProof.verifyUrl ?? "/api/sports/decision/training/corpus-proof"
    }),
    lane({
      id: "public-action",
      label: "Public picks and automation",
      status: "locked",
      score: 100,
      evidence: "Publishing, persistence, training, provider writes, staking, and public-action upgrades are locked by policy.",
      nextAction: "Keep output in inspect/watch mode until every proof gate passes and an operator explicitly enables write/publish controls.",
      proofUrl: "/api/sports/decision/launch-commander"
    })
  ];

  const topBlockedLane = lanes.find((item) => item.status === "blocked") ?? null;
  const topLockedLane = lanes.find((item) => item.status === "locked" && item.id !== "public-action") ?? null;
  const primaryBlocker = launchCommander.topItem?.label ?? topBlockedLane?.label ?? topLockedLane?.label ?? originalBriefCoverage.topGap?.label ?? null;
  const status = stateStatus({ lanes, launchCommander, openAiKeyDiagnostic });
  const nextProof = launchCommander.topItem?.label ?? topBlockedLane?.nextAction ?? topLockedLane?.nextAction ?? null;
  const nextCommand = launchCommander.topItem?.command ?? null;

  return {
    mode: "decision-launch-state",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    stateHash: stableHash({
      date,
      sport,
      status,
      lanes: lanes.map((item) => [item.id, item.status, item.score]),
      launch: launchCommander.commanderHash,
      requirements: requirementPulse.pulseHash,
      openai: openAiKeyDiagnostic.diagnosticHash,
      coverage: originalBriefCoverage.coverageHash
    }),
    summary: summaryFor(status, primaryBlocker),
    posture: {
      engineMode: status === "live-review-ready" ? "live-ai-review-ready" : status === "proof-ready" ? "proof-first" : status === "blocked" ? "blocked" : "deterministic-shadow",
      publicAction: "no-public-picks",
      primaryBlocker,
      nextProof,
      nextCommand
    },
    lanes,
    totals: totalsFor(lanes),
    controls: {
      canInspectReadOnly: true,
      canRunNextProof: launchCommander.controls.canRunNextCommand,
      canRunOpenAIReview: openAiKeyDiagnostic.runtime.canRunLiveReview && launchCommander.controls.canRunOpenAIReview,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/launch-state",
      "/api/sports/decision/launch-commander",
      "/api/sports/decision/requirement-pulse",
      ...launchCommander.proofUrls,
      ...requirementPulse.proofUrls,
      ...openAiKeyDiagnostic.proofUrls,
      ...originalBriefCoverage.proofUrls,
      ...supabaseProofBinder.proofUrls,
      ...trainingCorpusProof.proofUrls
    ]),
    locks: unique([
      "Launch state is read-only and cannot create keys, write env files, persist decisions, train models, publish picks, or upgrade public action.",
      ...launchCommander.locks,
      ...openAiKeyDiagnostic.locks,
      ...trainingCorpusProof.blockers,
      ...supabaseProofBinder.locks
    ])
  };
}
