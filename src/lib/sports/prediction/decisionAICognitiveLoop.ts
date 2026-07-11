import type { DecisionAIReasoningGateway, DecisionAIReasoningReview } from "@/lib/sports/prediction/decisionAIReasoningGateway";
import type { DecisionOperatorEpisode } from "@/lib/sports/prediction/decisionOperatorEpisode";
import type { Sport } from "@/lib/sports/types";

export type DecisionAICognitiveLoopStatus = "needs-config" | "thinking" | "needs-evidence" | "repair" | "ready-shadow" | "blocked";
export type DecisionAICognitiveLoopStageStatus = "pass" | "watch" | "block";
export type DecisionAICognitiveLoopStageId = "sense" | "interpret" | "deliberate" | "arbitrate" | "act" | "verify" | "learn";

export type DecisionAICognitiveLoopStage = {
  id: DecisionAICognitiveLoopStageId;
  label: string;
  status: DecisionAICognitiveLoopStageStatus;
  thought: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAICognitiveLoop = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-cognitive-loop";
  status: DecisionAICognitiveLoopStatus;
  loopHash: string;
  summary: string;
  activeReviewSource: "openai-review" | "deterministic-fallback";
  activeReviewHash: string;
  operatorAction: DecisionAIReasoningReview["operatorAction"];
  confidencePatch: DecisionAIReasoningReview["confidencePatch"];
  trustPatch: DecisionAIReasoningReview["trustPatch"];
  cycle: DecisionAICognitiveLoopStage[];
  nextOperation: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
    expectedEvidence: string;
    fallbackAction: string;
  };
  memoryDraft: {
    label: string;
    content: string;
    evidenceHash: string;
    canPersist: false;
  };
  permissions: {
    canRunReadOnly: boolean;
    canSubmitToOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
  };
  locks: string[];
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function isSafeReadOnlyCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return lower.includes("curl.exe") && !lower.includes("-x post") && !lower.includes("persist=1") && !lower.includes("persist=true") && !lower.includes("dryrun=0");
}

function activeReview(gateway: DecisionAIReasoningGateway): { review: DecisionAIReasoningReview; source: DecisionAICognitiveLoop["activeReviewSource"] } {
  return gateway.review &&
    gateway.latestRun.provider === "openai" &&
    gateway.latestRun.status === "reviewed" &&
    gateway.reviewAudit.decision.canUseReview &&
    !gateway.reviewAudit.decision.mustUseFallback
    ? { review: gateway.review, source: "openai-review" }
    : { review: gateway.deterministicFallback, source: "deterministic-fallback" };
}

function statusFor({
  gateway,
  review,
  episode,
  safeToRun
}: {
  gateway: DecisionAIReasoningGateway;
  review: DecisionAIReasoningReview;
  episode: DecisionOperatorEpisode;
  safeToRun: boolean;
}): DecisionAICognitiveLoopStatus {
  if (episode.status === "blocked" || review.operatorAction === "block") return "blocked";
  if (review.operatorAction === "repair") return "repair";
  if (!gateway.openAiConfigured && !gateway.latestRun.requested) return "needs-config";
  if (review.operatorAction === "advance-read-only" && safeToRun) return "ready-shadow";
  if (gateway.status === "ready-to-submit") return "thinking";
  return "needs-evidence";
}

function summaryFor(status: DecisionAICognitiveLoopStatus): string {
  if (status === "ready-shadow") return "AI cognitive loop can advance only as a read-only shadow proof turn.";
  if (status === "thinking") return "AI cognitive loop is ready for a model review before state advances.";
  if (status === "needs-config") return "AI cognitive loop is wired but waiting for OpenAI configuration; deterministic fallback remains active.";
  if (status === "repair") return "AI cognitive loop routes the next move to proof repair.";
  if (status === "blocked") return "AI cognitive loop blocks this path until unsafe proof or action pressure is resolved.";
  return "AI cognitive loop needs stronger evidence before trust can move.";
}

function stage(input: DecisionAICognitiveLoopStage): DecisionAICognitiveLoopStage {
  return {
    ...input,
    thought: compact(input.thought, 340),
    evidence: unique(input.evidence, 8),
    nextAction: compact(input.nextAction, 240)
  };
}

function buildCycle({
  episode,
  gateway,
  review,
  status,
  safeToRun
}: {
  episode: DecisionOperatorEpisode;
  gateway: DecisionAIReasoningGateway;
  review: DecisionAIReasoningReview;
  status: DecisionAICognitiveLoopStatus;
  safeToRun: boolean;
}): DecisionAICognitiveLoopStage[] {
  const blockedGate = review.safetyGates.find((gate) => gate.status === "block");
  const watchGate = review.safetyGates.find((gate) => gate.status === "watch");
  const primaryRisk = review.riskFlags[0] ?? episode.operatorNarrative.risk;
  const primaryGap = review.dataGaps[0] ?? "No new data gap was reported by the active review.";
  const primaryTrace = (phase: string) => review.publicReasoningTrace.find((item) => item.phase === phase);

  return [
    stage({
      id: "sense",
      label: "Sense evidence",
      status: episode.chain.proofHash ? "pass" : "watch",
      thought: primaryTrace("observe")?.finding ?? episode.operatorNarrative.observed,
      evidence: unique([episode.chain.proofHash, "episode-proof-hash", ...gateway.evidence.ids.slice(0, 4)]),
      nextAction: episode.chain.proofHash ? "Use the observed proof receipt in the next state decision." : "Observe the proof receipt before raising trust."
    }),
    stage({
      id: "interpret",
      label: "Interpret state",
      status: episode.status === "advance-shadow" ? "pass" : episode.status === "blocked" ? "block" : "watch",
      thought: primaryTrace("frame")?.finding ?? episode.operatorNarrative.decision,
      evidence: ["episode-status", "episode-final-patch", episode.episodeHash],
      nextAction: `Keep operator action at ${review.operatorAction}.`
    }),
    stage({
      id: "deliberate",
      label: "Deliberate risks",
      status: blockedGate ? "block" : watchGate || review.riskFlags.length || review.dataGaps.length ? "watch" : "pass",
      thought: primaryTrace("challenge")?.finding ?? primaryRisk,
      evidence: unique([blockedGate?.id, watchGate?.id, ...review.falsifiers.slice(0, 4)]),
      nextAction: blockedGate?.reason ?? watchGate?.reason ?? primaryGap
    }),
    stage({
      id: "arbitrate",
      label: "Arbitrate action",
      status: review.operatorAction === "block" || review.operatorAction === "repair" ? "block" : review.operatorAction === "hold" ? "watch" : "pass",
      thought: primaryTrace("decide")?.finding ?? review.summary,
      evidence: ["no-upgrade", "no-publish", "no-persistence", review.reviewVerdict],
      nextAction: `Apply ${review.confidencePatch}/${review.trustPatch}; do not upgrade public action.`
    }),
    stage({
      id: "act",
      label: "Choose next bounded move",
      status: safeToRun && status !== "blocked" ? "pass" : "block",
      thought: safeToRun ? `Next command is read-only: ${review.nextSafeCommand}` : "No safe read-only command is available from the active review.",
      evidence: ["nextSafeCommand", ...episode.replay.urls],
      nextAction: safeToRun ? "Run or inspect only the selected read-only proof command." : "Rebuild operator turn and proof target before acting."
    }),
    stage({
      id: "verify",
      label: "Verify result",
      status: safeToRun ? "pass" : "watch",
      thought: primaryTrace("verify")?.finding ?? "Verification must return a local API receipt with a stable hash and clear status label.",
      evidence: unique([episode.chain.proofHash, ...episode.proofUrls.slice(0, 5)]),
      nextAction: "Compare the next receipt hash, status, and gate counts before changing trust."
    }),
    stage({
      id: "learn",
      label: "Draft learning",
      status: "watch",
      thought: primaryTrace("learn")?.finding ?? review.memoryCandidate.content,
      evidence: unique([episode.memoryDraft.evidenceHash, gateway.latestRun.reviewHash, review.memoryCandidate.label]),
      nextAction: "Keep memory draft-only until Supabase write gates and operator approval are available."
    })
  ];
}

function verifyUrlFromCommand(command: string | null): string | null {
  if (!command) return null;
  const match = command.match(/"http:\/\/127\.0\.0\.1:3013([^"]+)"/);
  return match?.[1] ?? null;
}

export function buildDecisionAICognitiveLoop({
  episode,
  gateway,
  now = new Date()
}: {
  episode: DecisionOperatorEpisode;
  gateway: DecisionAIReasoningGateway;
  now?: Date;
}): DecisionAICognitiveLoop {
  const selected = activeReview(gateway);
  const review = selected.review;
  const safeToRun = isSafeReadOnlyCommand(review.nextSafeCommand);
  const status = statusFor({ gateway, review, episode, safeToRun });
  const cycle = buildCycle({ episode, gateway, review, status, safeToRun });
  const activeReviewHash = stableHash(review);
  const memoryEvidenceHash = stableHash({
    episode: episode.episodeHash,
    gateway: gateway.gatewayHash,
    review: activeReviewHash,
    action: review.operatorAction
  });
  const loopHash = stableHash({
    date: episode.date,
    sport: episode.sport,
    episode: episode.episodeHash,
    gateway: gateway.gatewayHash,
    review: activeReviewHash,
    status,
    cycle: cycle.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: episode.date,
    sport: episode.sport,
    mode: "ai-cognitive-loop",
    status,
    loopHash,
    summary: summaryFor(status),
    activeReviewSource: selected.source,
    activeReviewHash,
    operatorAction: review.operatorAction,
    confidencePatch: review.confidencePatch,
    trustPatch: review.trustPatch,
    cycle,
    nextOperation: {
      label:
        review.operatorAction === "advance-read-only"
          ? "Advance read-only shadow proof"
          : review.operatorAction === "repair"
            ? "Repair proof path"
            : review.operatorAction === "block"
              ? "Block unsafe path"
              : "Hold for stronger evidence",
      command: safeToRun ? review.nextSafeCommand : null,
      verifyUrl: safeToRun ? verifyUrlFromCommand(review.nextSafeCommand) : null,
      safeToRun: safeToRun && status !== "blocked",
      expectedEvidence: "A local JSON proof response with success/status signals, stable hash, and no write side effects.",
      fallbackAction:
        status === "blocked"
          ? "Stop this operator path and inspect locks."
          : status === "repair"
            ? "Run the repair proof route or rebuild the operator turn."
            : "Keep trust capped until a stronger receipt is observed."
    },
    memoryDraft: {
      label: review.memoryCandidate.label,
      content: review.memoryCandidate.content,
      evidenceHash: memoryEvidenceHash,
      canPersist: false
    },
    permissions: {
      canRunReadOnly: safeToRun && status !== "blocked",
      canSubmitToOpenAI: gateway.permissions.canSubmitToOpenAI,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    locks: unique(
      [
        ...gateway.locks,
        "AI cognitive loop cannot persist memory.",
        "AI cognitive loop cannot publish picks.",
        "AI cognitive loop cannot train models.",
        "AI cognitive loop cannot upgrade public action from model text."
      ],
      24
    ),
    proofUrls: unique(["/api/sports/decision/ai-cognitive-loop", ...gateway.proofUrls, ...episode.proofUrls], 20)
  };
}
