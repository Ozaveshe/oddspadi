import type { DecisionLearningPromotionGate } from "@/lib/sports/prediction/decisionLearningPromotionGate";
import type { DecisionOutcomeReplay } from "@/lib/sports/prediction/decisionOutcomeReplay";
import type { DecisionResolutionReceipt } from "@/lib/sports/prediction/decisionResolutionReceipt";
import type { DecisionSettlementImpact } from "@/lib/sports/prediction/decisionSettlementImpact";
import type { DecisionShadowLearningAgenda, DecisionShadowLearningAgendaItem } from "@/lib/sports/prediction/decisionShadowLearningAgenda";
import type { DecisionSupervisedAgentRun } from "@/lib/sports/prediction/decisionSupervisedAgentRun";
import type { Sport } from "@/lib/sports/types";

export type DecisionShadowMemoryReplayStatus = "ready-replay" | "waiting-proof" | "blocked";
export type DecisionShadowMemoryReplayEpisodeStatus = "recordable-shadow" | "waiting-proof" | "blocked";

export type DecisionShadowMemoryReplayEpisode = {
  id: string;
  sourceAgendaItem: string;
  status: DecisionShadowMemoryReplayEpisodeStatus;
  label: string;
  replayHash: string;
  objective: string;
  observation: string;
  expectedUse: string;
  decisionTrace: {
    runHash: string;
    agendaHash: string;
    receiptHash: string;
    replayHash: string;
    settlementHash: string;
    promotionHash: string;
  };
  blockers: string[];
  proofUrls: string[];
  canPersist: false;
  canTrain: false;
  canAdjustProbabilities: false;
  canPublish: false;
};

export type DecisionShadowMemoryReplay = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-shadow-memory-replay";
  status: DecisionShadowMemoryReplayStatus;
  replayBankHash: string;
  summary: string;
  selectedEpisode: DecisionShadowMemoryReplayEpisode | null;
  episodes: DecisionShadowMemoryReplayEpisode[];
  totals: {
    episodes: number;
    recordableShadow: number;
    waitingProof: number;
    blocked: number;
    uniqueProofRoutes: number;
  };
  memoryDraft: {
    table: "op_shadow_memory_replay";
    canPersist: false;
    payloadHash: string;
    summary: string;
    payloadPreview: {
      sport: Sport;
      runHash: string;
      agendaHash: string;
      selectedEpisode: string | null;
      episodeCount: number;
    };
  };
  controls: {
    canInspectReadOnly: true;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, max = 300): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function episodeStatus(item: DecisionShadowLearningAgendaItem, run: DecisionSupervisedAgentRun): DecisionShadowMemoryReplayEpisodeStatus {
  if (item.status === "blocked") return "blocked";
  if (run.status === "blocked") return "waiting-proof";
  if (item.status === "ready-shadow") return "recordable-shadow";
  return "waiting-proof";
}

function episodeFromAgendaItem({
  item,
  run,
  agenda,
  resolutionReceipt,
  outcomeReplay,
  settlementImpact,
  learningPromotionGate
}: {
  item: DecisionShadowLearningAgendaItem;
  run: DecisionSupervisedAgentRun;
  agenda: DecisionShadowLearningAgenda;
  resolutionReceipt: DecisionResolutionReceipt;
  outcomeReplay: DecisionOutcomeReplay;
  settlementImpact: DecisionSettlementImpact;
  learningPromotionGate: DecisionLearningPromotionGate;
}): DecisionShadowMemoryReplayEpisode {
  const status = episodeStatus(item, run);
  const blockers = unique([
    ...item.blockedBy,
    run.status === "blocked" ? run.summary : null,
    status === "waiting-proof" ? "Agenda item still needs proof before it can become a replayable shadow memory." : null
  ], 8);
  const proofUrls = unique([item.proofUrl, ...agenda.proofUrls.slice(0, 10), ...run.proofUrls.slice(0, 8)], 18);
  const decisionTrace = {
    runHash: run.runHash,
    agendaHash: agenda.agendaHash,
    receiptHash: resolutionReceipt.receiptHash,
    replayHash: outcomeReplay.replayHash,
    settlementHash: settlementImpact.impactHash,
    promotionHash: learningPromotionGate.promotionHash
  };
  const replayHash = stableHash({
    item: item.id,
    status,
    trace: decisionTrace,
    proofUrls,
    blockers
  });

  return {
    id: `${item.id}:shadow-memory-replay`,
    sourceAgendaItem: item.id,
    status,
    label: item.label,
    replayHash,
    objective: compact(item.hypothesis),
    observation: compact(`${run.summary} Evidence path: ${item.evidenceNeeded.join(" | ")}`),
    expectedUse: compact(item.expectedLearning),
    decisionTrace,
    blockers,
    proofUrls,
    canPersist: false,
    canTrain: false,
    canAdjustProbabilities: false,
    canPublish: false
  };
}

function statusFor(episodes: DecisionShadowMemoryReplayEpisode[]): DecisionShadowMemoryReplayStatus {
  if (!episodes.length || episodes.every((episode) => episode.status === "blocked")) return "blocked";
  if (episodes.some((episode) => episode.status !== "recordable-shadow")) return "waiting-proof";
  return "ready-replay";
}

function selectedEpisode(episodes: DecisionShadowMemoryReplayEpisode[]): DecisionShadowMemoryReplayEpisode | null {
  const rank = { blocked: 3, "waiting-proof": 2, "recordable-shadow": 1 };
  return episodes.slice().sort((a, b) => rank[b.status] - rank[a.status] || a.label.localeCompare(b.label))[0] ?? null;
}

function summaryFor(status: DecisionShadowMemoryReplayStatus, totals: DecisionShadowMemoryReplay["totals"]): string {
  if (status === "ready-replay") return `Shadow memory replay has ${totals.recordableShadow} recordable episode(s), all still write-locked.`;
  if (status === "blocked") return "Shadow memory replay is blocked; no episode has enough proof to become a replayable memory draft.";
  return `Shadow memory replay prepared ${totals.episodes} episode(s); ${totals.waitingProof} still need proof before replay can be trusted.`;
}

export function buildDecisionShadowMemoryReplay({
  date,
  sport,
  shadowLearningAgenda,
  supervisedAgentRun,
  resolutionReceipt,
  outcomeReplay,
  settlementImpact,
  learningPromotionGate,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  shadowLearningAgenda: DecisionShadowLearningAgenda;
  supervisedAgentRun: DecisionSupervisedAgentRun;
  resolutionReceipt: DecisionResolutionReceipt;
  outcomeReplay: DecisionOutcomeReplay;
  settlementImpact: DecisionSettlementImpact;
  learningPromotionGate: DecisionLearningPromotionGate;
  now?: Date;
}): DecisionShadowMemoryReplay {
  const episodes = shadowLearningAgenda.items.map((item) =>
    episodeFromAgendaItem({
      item,
      run: supervisedAgentRun,
      agenda: shadowLearningAgenda,
      resolutionReceipt,
      outcomeReplay,
      settlementImpact,
      learningPromotionGate
    })
  );
  const active = selectedEpisode(episodes);
  const allProofUrls = unique(episodes.flatMap((episode) => episode.proofUrls), 36);
  const totals = {
    episodes: episodes.length,
    recordableShadow: episodes.filter((episode) => episode.status === "recordable-shadow").length,
    waitingProof: episodes.filter((episode) => episode.status === "waiting-proof").length,
    blocked: episodes.filter((episode) => episode.status === "blocked").length,
    uniqueProofRoutes: allProofUrls.length
  };
  const status = statusFor(episodes);
  const replayBankHash = stableHash({
    date,
    sport,
    agenda: shadowLearningAgenda.agendaHash,
    run: supervisedAgentRun.runHash,
    episodes: episodes.map((episode) => [episode.id, episode.status, episode.replayHash])
  });
  const payloadHash = stableHash({
    replayBankHash,
    active: active?.id ?? null,
    evidence: shadowLearningAgenda.memoryDraft.evidenceIds,
    trace: active?.decisionTrace ?? null
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-shadow-memory-replay",
    status,
    replayBankHash,
    summary: summaryFor(status, totals),
    selectedEpisode: active,
    episodes,
    totals,
    memoryDraft: {
      table: "op_shadow_memory_replay",
      canPersist: false,
      payloadHash,
      summary: compact(
        `${active?.label ?? "No active episode"} can be replayed for future audit only after proof gates pass; memory persistence and training are locked.`
      ),
      payloadPreview: {
        sport,
        runHash: supervisedAgentRun.runHash,
        agendaHash: shadowLearningAgenda.agendaHash,
        selectedEpisode: active?.id ?? null,
        episodeCount: episodes.length
      }
    },
    controls: {
      canInspectReadOnly: true,
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
      "/api/sports/decision/shadow-memory-replay",
      "/api/sports/decision/shadow-learning-agenda",
      "/api/sports/decision/supervised-agent-run",
      "/api/sports/decision/resolution-receipt",
      "/api/sports/decision/outcome-replay",
      "/api/sports/decision/settlement-impact",
      "/api/sports/decision/learning-promotion-gate",
      ...allProofUrls
    ], 40),
    locks: unique([
      "Shadow memory replay is inspect-only and cannot write memory rows, outcomes, calibration, training rows, or model weights.",
      "Replay episodes use public evidence hashes and summaries only; hidden chain-of-thought is not persisted or exposed.",
      "Recordable-shadow means ready for operator review, not authorized persistence or training.",
      "No replay episode can adjust probabilities, publish picks, stake, raise confidence, or apply learned weights.",
      ...shadowLearningAgenda.locks,
      ...supervisedAgentRun.locks
    ], 36)
  };
}
