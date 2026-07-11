import type { DecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import type { DecisionMvpActivationQueue } from "@/lib/sports/prediction/decisionMvpActivationQueue";
import type { DecisionMvpProgressSnapshot, DecisionMvpProgressSnapshotLane } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { DecisionProviderEnvDiagnostic } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import type { DecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpBriefCoverageSnapshotStatus = "real" | "shadow" | "blocked";
export type DecisionMvpBriefCoverageSnapshotGroupId =
  | "data-layer"
  | "prediction-engine"
  | "odds-intelligence"
  | "ai-explanation"
  | "training-corpus"
  | "deployment-storage"
  | "epl-2026"
  | "safety-controls";

export type DecisionMvpBriefCoverageSnapshotGroup = {
  id: DecisionMvpBriefCoverageSnapshotGroupId;
  label: string;
  status: DecisionMvpBriefCoverageSnapshotStatus;
  coverage: number;
  evidence: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionMvpBriefCoverageSnapshot = {
  mode: "decision-mvp-brief-coverage-snapshot";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpBriefCoverageSnapshotStatus;
  snapshotHash: string;
  summary: string;
  authoritativeCoverageUrl: string;
  selectedGap: DecisionMvpBriefCoverageSnapshotGroup | null;
  groups: DecisionMvpBriefCoverageSnapshotGroup[];
  counts: Record<DecisionMvpBriefCoverageSnapshotStatus, number>;
  controls: {
    canInspectReadOnly: true;
    canRunSafeProof: boolean;
    canRunOriginalBriefCoverage: true;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function lane(snapshot: DecisionMvpProgressSnapshot, id: DecisionMvpProgressSnapshotLane["id"]): DecisionMvpProgressSnapshotLane | null {
  return snapshot.lanes.find((candidate) => candidate.id === id) ?? null;
}

function statusFromLane(candidate: DecisionMvpProgressSnapshotLane | null): DecisionMvpBriefCoverageSnapshotStatus {
  if (!candidate) return "blocked";
  if (candidate.status === "done") return "real";
  if (candidate.status === "current") return "shadow";
  return "blocked";
}

function statusFromGroups(groups: DecisionMvpBriefCoverageSnapshotGroup[]): DecisionMvpBriefCoverageSnapshotStatus {
  if (groups.some((group) => group.status === "blocked")) return "blocked";
  if (groups.some((group) => group.status === "shadow")) return "shadow";
  return "real";
}

function group(input: DecisionMvpBriefCoverageSnapshotGroup): DecisionMvpBriefCoverageSnapshotGroup {
  return {
    ...input,
    coverage: Math.max(0, Math.min(100, Math.round(input.coverage)))
  };
}

function countsFor(groups: DecisionMvpBriefCoverageSnapshotGroup[]): Record<DecisionMvpBriefCoverageSnapshotStatus, number> {
  return {
    real: groups.filter((groupItem) => groupItem.status === "real").length,
    shadow: groups.filter((groupItem) => groupItem.status === "shadow").length,
    blocked: groups.filter((groupItem) => groupItem.status === "blocked").length
  };
}

function summaryFor(counts: Record<DecisionMvpBriefCoverageSnapshotStatus, number>, selectedGap: DecisionMvpBriefCoverageSnapshotGroup | null): string {
  const base = `Original brief MVP map: ${counts.real} real, ${counts.shadow} shadow, ${counts.blocked} blocked.`;
  if (!selectedGap) return `${base} Every fast-lane group is currently mapped to proof.`;
  return `${base} Next gap is ${selectedGap.label}.`;
}

export function buildDecisionMvpBriefCoverageSnapshot({
  date,
  sport,
  providerEnvDiagnostic,
  mvpProgressSnapshot,
  liveProviderProbeLedger,
  slateThinking,
  mvpActivationQueue,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerEnvDiagnostic: DecisionProviderEnvDiagnostic;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
  liveProviderProbeLedger: DecisionLiveProviderProbeLedger;
  slateThinking: DecisionSlateThinking;
  mvpActivationQueue: DecisionMvpActivationQueue;
  now?: Date;
}): DecisionMvpBriefCoverageSnapshot {
  const modelLane = lane(mvpProgressSnapshot, "models");
  const oddsLane = lane(mvpProgressSnapshot, "odds");
  const providerLane = lane(mvpProgressSnapshot, "provider-data");
  const openAiLane = lane(mvpProgressSnapshot, "openai-review");
  const storageLane = lane(mvpProgressSnapshot, "supabase-storage");
  const trainingLane = lane(mvpProgressSnapshot, "training-corpus");
  const eplLane = lane(mvpProgressSnapshot, "epl-2026");
  const oddsProbeLane = liveProviderProbeLedger.lanes.find((candidate) => candidate.id === "football-odds") ?? null;
  const controlsLocked =
    !mvpActivationQueue.controls.canWriteProviderRows &&
    !mvpActivationQueue.controls.canPersistDecisions &&
    !mvpActivationQueue.controls.canTrainModels &&
    !mvpActivationQueue.controls.canPublishPicks &&
    !mvpActivationQueue.controls.canStake &&
    !mvpActivationQueue.controls.canUpgradePublicAction;

  const groups = [
    group({
      id: "data-layer",
      label: "Data layer",
      status: statusFromLane(providerLane),
      coverage: providerLane?.percent ?? 0,
      evidence: providerLane?.evidence ?? providerEnvDiagnostic.summary,
      nextAction: providerLane?.nextAction ?? providerEnvDiagnostic.footballMvpMinimum.nextAction,
      proofUrl: providerLane?.proofUrl ?? "/api/sports/decision/provider-env-diagnostic"
    }),
    group({
      id: "prediction-engine",
      label: "Prediction models",
      status: statusFromLane(modelLane),
      coverage: modelLane?.percent ?? 0,
      evidence: modelLane?.evidence ?? "Football, basketball, and tennis model readiness is not available in the fast snapshot.",
      nextAction: modelLane?.nextAction ?? "Restore prediction rows before proving model readiness.",
      proofUrl: modelLane?.proofUrl ?? "/api/sports/predictions"
    }),
    group({
      id: "odds-intelligence",
      label: "Odds intelligence",
      status: oddsLane?.status === "done" && oddsProbeLane?.configured ? "real" : oddsLane?.status === "done" || oddsLane?.status === "current" ? "shadow" : "blocked",
      coverage: oddsLane?.percent ?? 0,
      evidence: `${oddsLane?.evidence ?? "Odds lane unavailable."} Odds provider ${oddsProbeLane?.configured ? "configured" : "not configured"}.`,
      nextAction: oddsProbeLane?.configured
        ? oddsLane?.nextAction ?? "Run the odds-intelligence proof before operator action."
        : "Configure THE_ODDS_API_KEY or ODDS_API_KEY before treating value-edge rankings as live.",
      proofUrl: "/api/sports/decision/odds-intelligence-proof"
    }),
    group({
      id: "ai-explanation",
      label: "AI explanations",
      status: slateThinking.totalThoughts > 0 && openAiLane?.status === "done" ? "real" : slateThinking.totalThoughts > 0 ? "shadow" : "blocked",
      coverage: Math.max(openAiLane?.percent ?? 0, slateThinking.totalThoughts > 0 ? 48 : 0),
      evidence: `${slateThinking.summary} Live review lane: ${openAiLane?.evidence ?? "unavailable"}`,
      nextAction: openAiLane?.status === "done" ? "Run bounded live review only after provider evidence is present." : openAiLane?.nextAction ?? "Build slate thinking before AI review.",
      proofUrl: "/api/sports/decision/slate-thinking"
    }),
    group({
      id: "training-corpus",
      label: "10-year training corpus",
      status: statusFromLane(trainingLane),
      coverage: trainingLane?.percent ?? 0,
      evidence: trainingLane?.evidence ?? "Training corpus lane unavailable.",
      nextAction: trainingLane?.nextAction ?? "Backfill the 10-year corpus before learned weights can promote.",
      proofUrl: trainingLane?.proofUrl ?? "/api/sports/decision/training/ten-year-corpus-execution"
    }),
    group({
      id: "deployment-storage",
      label: "Supabase and Netlify",
      status: statusFromLane(storageLane),
      coverage: storageLane?.percent ?? 0,
      evidence: storageLane?.evidence ?? "Supabase storage lane unavailable.",
      nextAction: storageLane?.nextAction ?? "Verify OddsPadi Supabase schema/storage proof before writes.",
      proofUrl: storageLane?.proofUrl ?? "/api/sports/decision/storage-activation-checklist"
    }),
    group({
      id: "epl-2026",
      label: "EPL 2026/27 launch lane",
      status: statusFromLane(eplLane),
      coverage: eplLane?.percent ?? 0,
      evidence: eplLane?.evidence ?? `${mvpProgressSnapshot.epl2026.openingWindowFixtures} EPL opener fixture(s) tracked.`,
      nextAction: eplLane?.nextAction ?? mvpProgressSnapshot.epl2026.nextAction,
      proofUrl: eplLane?.proofUrl ?? "/api/sports/decision/epl-pre-kickoff-rehearsal"
    }),
    group({
      id: "safety-controls",
      label: "Safety controls",
      status: controlsLocked ? "real" : "blocked",
      coverage: controlsLocked ? 100 : 0,
      evidence: `write=${mvpActivationQueue.controls.canWriteProviderRows}, persist=${mvpActivationQueue.controls.canPersistDecisions}, train=${mvpActivationQueue.controls.canTrainModels}, publish=${mvpActivationQueue.controls.canPublishPicks}, stake=${mvpActivationQueue.controls.canStake}.`,
      nextAction: controlsLocked ? "Keep proof lanes read-only until provider, storage, AI, corpus, and responsible controls pass." : "Close unsafe controls before continuing MVP activation.",
      proofUrl: "/api/sports/decision/mvp-activation-queue"
    })
  ];
  const counts = countsFor(groups);
  const selectedGap = groups.find((candidate) => candidate.status === "blocked") ?? groups.find((candidate) => candidate.status === "shadow") ?? null;
  const status = statusFromGroups(groups);

  return {
    mode: "decision-mvp-brief-coverage-snapshot",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    snapshotHash: stableHash({
      date,
      sport,
      status,
      groups: groups.map((coverageGroup) => [coverageGroup.id, coverageGroup.status, coverageGroup.coverage]),
      activationQueue: mvpActivationQueue.queueHash,
      progress: mvpProgressSnapshot.status,
      provider: [providerEnvDiagnostic.status, providerEnvDiagnostic.totals, providerEnvDiagnostic.footballMvpMinimum.status],
      liveProvider: liveProviderProbeLedger.ledgerHash,
      slate: slateThinking.thinkingHash
    }),
    summary: summaryFor(counts, selectedGap),
    authoritativeCoverageUrl: "/api/sports/decision/original-brief-coverage",
    selectedGap,
    groups,
    counts,
    controls: {
      canInspectReadOnly: true,
      canRunSafeProof: mvpActivationQueue.controls.canRunSafeProof,
      canRunOriginalBriefCoverage: true,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-brief-coverage-snapshot",
      "/api/sports/decision/original-brief-coverage",
      ...groups.map((coverageGroup) => coverageGroup.proofUrl),
      ...mvpActivationQueue.proofUrls,
      ...mvpProgressSnapshot.proofUrls,
      ...liveProviderProbeLedger.proofUrls
    ]),
    locks: [
      "Fast coverage is read-only and cannot write provider rows, persist decisions, train models, publish picks, stake, or upgrade public action.",
      "The authoritative original-brief coverage route remains the full proof trail for every data, model, odds, AI, corpus, storage, and safety requirement.",
      "Shadow means the MVP path exists but still needs live provider, OpenAI, Supabase, corpus, or market proof."
    ]
  };
}
