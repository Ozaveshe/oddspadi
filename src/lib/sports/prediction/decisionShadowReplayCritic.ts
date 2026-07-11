import type { DecisionLearningPromotionGate } from "@/lib/sports/prediction/decisionLearningPromotionGate";
import type { DecisionShadowMemoryReplay, DecisionShadowMemoryReplayEpisode } from "@/lib/sports/prediction/decisionShadowMemoryReplay";
import type { Sport } from "@/lib/sports/types";

export type DecisionShadowReplayCriticStatus = "ready-review" | "needs-proof" | "blocked";
export type DecisionShadowReplayCriticVerdict = "useful-shadow" | "needs-proof" | "reject";
export type DecisionShadowReplayCriticCheckId = "proof-density" | "memory-safety" | "learning-permission" | "replay-quality" | "public-action-lock";
export type DecisionShadowReplayCriticCheckStatus = "pass" | "watch" | "block";

export type DecisionShadowReplayCriticCheck = {
  id: DecisionShadowReplayCriticCheckId;
  status: DecisionShadowReplayCriticCheckStatus;
  label: string;
  detail: string;
  evidence: string[];
  requiredAction: string | null;
};

export type DecisionShadowReplayCriticEpisodeReview = {
  episodeId: string;
  replayHash: string;
  verdict: DecisionShadowReplayCriticVerdict;
  usefulnessScore: number;
  riskScore: number;
  reason: string;
  nextProof: string;
  canUseAsShadowMemory: boolean;
  canPersist: false;
  canTrain: false;
  canAdjustProbabilities: false;
  canPublish: false;
};

export type DecisionShadowReplayCritic = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-shadow-replay-critic";
  status: DecisionShadowReplayCriticStatus;
  criticHash: string;
  summary: string;
  selectedReview: DecisionShadowReplayCriticEpisodeReview | null;
  checks: DecisionShadowReplayCriticCheck[];
  reviews: DecisionShadowReplayCriticEpisodeReview[];
  totals: {
    reviews: number;
    usefulShadow: number;
    needsProof: number;
    rejected: number;
    averageUsefulness: number;
    maxRisk: number;
  };
  memoryDraft: {
    canPersist: false;
    payloadHash: string;
    acceptedEpisodeIds: string[];
    rejectedEpisodeIds: string[];
    summary: string;
  };
  controls: {
    canInspectReadOnly: true;
    canUseForShadowComparison: boolean;
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

function round(value: number, digits = 4): number {
  if (!Number.isFinite(value)) return 0;
  return Number(value.toFixed(digits));
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function check(input: DecisionShadowReplayCriticCheck): DecisionShadowReplayCriticCheck {
  return {
    ...input,
    detail: compact(input.detail),
    evidence: unique(input.evidence, 8)
  };
}

function buildChecks({
  replay,
  promotionGate
}: {
  replay: DecisionShadowMemoryReplay;
  promotionGate: DecisionLearningPromotionGate;
}): DecisionShadowReplayCriticCheck[] {
  return [
    check({
      id: "proof-density",
      label: "Proof density",
      status: replay.totals.uniqueProofRoutes >= 6 ? "pass" : replay.totals.uniqueProofRoutes >= 3 ? "watch" : "block",
      detail: `${replay.totals.uniqueProofRoutes} unique proof route(s) support ${replay.totals.episodes} replay episode(s).`,
      evidence: [replay.replayBankHash, String(replay.totals.uniqueProofRoutes), String(replay.totals.episodes)],
      requiredAction: replay.totals.uniqueProofRoutes >= 6 ? null : "Attach more proof routes before treating replay episodes as reusable shadow memory."
    }),
    check({
      id: "memory-safety",
      label: "Memory safety",
      status:
        !replay.controls.canPersistMemory &&
        !replay.controls.canUseHiddenChainOfThought &&
        replay.episodes.every((episode) => !episode.canPersist && !episode.canPublish)
          ? "pass"
          : "block",
      detail: "Replay episodes must remain public-evidence summaries with memory writes and hidden reasoning locked.",
      evidence: [
        `persist:${replay.controls.canPersistMemory}`,
        `hidden:${replay.controls.canUseHiddenChainOfThought}`,
        `episodes:${replay.episodes.length}`
      ],
      requiredAction: null
    }),
    check({
      id: "learning-permission",
      label: "Learning permission",
      status: promotionGate.influencePlan.allowedScope === "shadow-memory" ? "watch" : promotionGate.status === "blocked" ? "block" : "watch",
      detail: promotionGate.summary,
      evidence: [promotionGate.promotionHash, promotionGate.status, promotionGate.influencePlan.allowedScope],
      requiredAction:
        promotionGate.influencePlan.allowedScope === "shadow-memory"
          ? "Keep influence shadow-only; public probabilities remain unchanged."
          : promotionGate.selectedCheck?.requiredAction ?? promotionGate.summary
    }),
    check({
      id: "replay-quality",
      label: "Replay quality",
      status: replay.totals.recordableShadow > 0 ? "pass" : replay.totals.waitingProof > 0 ? "watch" : "block",
      detail: `${replay.totals.recordableShadow} recordable, ${replay.totals.waitingProof} waiting, ${replay.totals.blocked} blocked replay episode(s).`,
      evidence: [String(replay.totals.recordableShadow), String(replay.totals.waitingProof), String(replay.totals.blocked)],
      requiredAction: replay.totals.recordableShadow > 0 ? null : "Verify the selected proof routes before accepting replay episodes as useful shadow memory."
    }),
    check({
      id: "public-action-lock",
      label: "Public action lock",
      status:
        !replay.controls.canAdjustProbabilities &&
        !replay.controls.canPublishPicks &&
        !replay.controls.canStake &&
        !promotionGate.controls.canPublishPicks &&
        !promotionGate.controls.canStake
          ? "pass"
          : "block",
      detail: "Replay criticism cannot change public picks, probabilities, stakes, or learned weights.",
      evidence: [
        `replayAdjust:${replay.controls.canAdjustProbabilities}`,
        `replayPublish:${replay.controls.canPublishPicks}`,
        `promotionPublish:${promotionGate.controls.canPublishPicks}`
      ],
      requiredAction: null
    })
  ];
}

function reviewEpisode(episode: DecisionShadowMemoryReplayEpisode, checks: DecisionShadowReplayCriticCheck[]): DecisionShadowReplayCriticEpisodeReview {
  const proofScore = clamp(episode.proofUrls.length * 5, 0, 35);
  const statusScore = episode.status === "recordable-shadow" ? 35 : episode.status === "waiting-proof" ? 18 : 0;
  const blockerPenalty = Math.min(28, episode.blockers.length * 7);
  const safetyPenalty = checks.some((item) => item.id === "memory-safety" && item.status === "block") ? 40 : 0;
  const usefulnessScore = round(clamp(proofScore + statusScore + (episode.expectedUse.length > 80 ? 18 : 8) - blockerPenalty));
  const riskScore = round(clamp(blockerPenalty + safetyPenalty + (episode.status === "blocked" ? 35 : episode.status === "waiting-proof" ? 18 : 6)));
  const verdict: DecisionShadowReplayCriticVerdict =
    episode.status === "blocked" || riskScore >= 70 ? "reject" : episode.status === "recordable-shadow" && usefulnessScore >= 55 ? "useful-shadow" : "needs-proof";

  return {
    episodeId: episode.id,
    replayHash: episode.replayHash,
    verdict,
    usefulnessScore,
    riskScore,
    reason: compact(
      verdict === "useful-shadow"
        ? `${episode.label} has enough proof density and safety locks to be useful as shadow memory.`
        : verdict === "reject"
          ? `${episode.label} is rejected for now because blockers or risk are too high.`
          : `${episode.label} needs more proof before it can safely inform shadow memory.`
    ),
    nextProof: episode.blockers[0] ?? episode.proofUrls[0] ?? "Inspect the shadow memory replay route.",
    canUseAsShadowMemory: verdict === "useful-shadow",
    canPersist: false,
    canTrain: false,
    canAdjustProbabilities: false,
    canPublish: false
  };
}

function statusFor(checks: DecisionShadowReplayCriticCheck[], reviews: DecisionShadowReplayCriticEpisodeReview[]): DecisionShadowReplayCriticStatus {
  if (!reviews.length || checks.some((item) => item.status === "block" && item.id !== "learning-permission") || reviews.every((item) => item.verdict === "reject")) {
    return "blocked";
  }
  if (checks.some((item) => item.status !== "pass") || reviews.some((item) => item.verdict === "needs-proof")) return "needs-proof";
  return "ready-review";
}

function summaryFor(status: DecisionShadowReplayCriticStatus, totals: DecisionShadowReplayCritic["totals"]): string {
  if (status === "ready-review") return `Shadow replay critic accepted ${totals.usefulShadow} episode(s) for shadow-memory review only.`;
  if (status === "blocked") return "Shadow replay critic blocked replay influence; no episode can affect memory or model behavior.";
  return `Shadow replay critic found ${totals.needsProof} episode(s) that need more proof before they can be useful shadow memory.`;
}

export function buildDecisionShadowReplayCritic({
  date,
  sport,
  shadowMemoryReplay,
  learningPromotionGate,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  shadowMemoryReplay: DecisionShadowMemoryReplay;
  learningPromotionGate: DecisionLearningPromotionGate;
  now?: Date;
}): DecisionShadowReplayCritic {
  const checks = buildChecks({ replay: shadowMemoryReplay, promotionGate: learningPromotionGate });
  const reviews = shadowMemoryReplay.episodes.map((episode) => reviewEpisode(episode, checks));
  const useful = reviews.filter((review) => review.verdict === "useful-shadow");
  const rejected = reviews.filter((review) => review.verdict === "reject");
  const totals = {
    reviews: reviews.length,
    usefulShadow: useful.length,
    needsProof: reviews.filter((review) => review.verdict === "needs-proof").length,
    rejected: rejected.length,
    averageUsefulness: round(reviews.reduce((sum, review) => sum + review.usefulnessScore, 0) / Math.max(1, reviews.length)),
    maxRisk: round(Math.max(0, ...reviews.map((review) => review.riskScore)))
  };
  const status = statusFor(checks, reviews);
  const selectedReview =
    reviews
      .slice()
      .sort((a, b) => {
        const verdictRank = { reject: 3, "needs-proof": 2, "useful-shadow": 1 };
        return verdictRank[b.verdict] - verdictRank[a.verdict] || b.riskScore - a.riskScore || b.usefulnessScore - a.usefulnessScore;
      })[0] ?? null;
  const criticHash = stableHash({
    date,
    sport,
    replay: shadowMemoryReplay.replayBankHash,
    promotion: learningPromotionGate.promotionHash,
    checks: checks.map((item) => [item.id, item.status]),
    reviews: reviews.map((item) => [item.episodeId, item.verdict, item.usefulnessScore, item.riskScore])
  });
  const acceptedEpisodeIds = useful.map((review) => review.episodeId);
  const rejectedEpisodeIds = rejected.map((review) => review.episodeId);

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-shadow-replay-critic",
    status,
    criticHash,
    summary: summaryFor(status, totals),
    selectedReview,
    checks,
    reviews,
    totals,
    memoryDraft: {
      canPersist: false,
      payloadHash: stableHash({ criticHash, acceptedEpisodeIds, rejectedEpisodeIds }),
      acceptedEpisodeIds,
      rejectedEpisodeIds,
      summary: compact(
        `${acceptedEpisodeIds.length} episode(s) are useful for shadow review; ${totals.needsProof} need proof and ${rejectedEpisodeIds.length} are rejected for now.`
      )
    },
    controls: {
      canInspectReadOnly: true,
      canUseForShadowComparison: acceptedEpisodeIds.length > 0 && status !== "blocked",
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
      "/api/sports/decision/shadow-replay-critic",
      "/api/sports/decision/shadow-memory-replay",
      "/api/sports/decision/learning-promotion-gate",
      ...shadowMemoryReplay.proofUrls,
      ...learningPromotionGate.proofUrls
    ], 42),
    locks: unique([
      "Shadow replay critic reviews memory usefulness only; it cannot persist memory, outcomes, calibration, training rows, or model weights.",
      "Useful-shadow verdicts can guide operator review but cannot adjust probabilities, public picks, stakes, or confidence.",
      "Critic reviews are based on public summaries and hashes only; hidden chain-of-thought is not stored or exposed.",
      ...shadowMemoryReplay.locks,
      ...learningPromotionGate.locks
    ], 36)
  };
}
