import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { DecisionAIControlMove, DecisionAIControlPacket } from "@/lib/sports/prediction/decisionAIControlPacket";
import type { DecisionOperatorEpisode } from "@/lib/sports/prediction/decisionOperatorEpisode";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIThoughtEpisodeStatus = "recordable" | "held" | "blocked" | "stored";
export type DecisionAIThoughtStepStatus = "pass" | "watch" | "block";
export type DecisionAIThoughtStepId = "observe" | "challenge" | "decide" | "authorize" | "replay" | "store";
export type DecisionAIThoughtPersistenceStatus = "not-requested" | "unauthorized" | "skipped" | "stored" | "failed";

export type DecisionAIThoughtStep = {
  id: DecisionAIThoughtStepId;
  label: string;
  status: DecisionAIThoughtStepStatus;
  evidence: string[];
  detail: string;
  nextAction: string;
};

export type DecisionAIThoughtPersistenceResult = {
  requested: boolean;
  status: DecisionAIThoughtPersistenceStatus;
  configured: boolean;
  table: "op_ai_thought_episodes";
  id?: string;
  reason?: string;
};

export type DecisionAIThoughtEpisode = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-thought-episode";
  status: DecisionAIThoughtEpisodeStatus;
  thoughtHash: string;
  summary: string;
  identity: {
    controlHash: string;
    operatorEpisodeHash: string;
    activeMatchId: string | null;
    activeMatch: string | null;
    publicAction: DecisionAIControlPacket["activeDecision"]["action"];
    publicPosture: DecisionAIControlPacket["activeDecision"]["publicPosture"];
    trustCeiling: DecisionAIControlPacket["activeDecision"]["trustCeiling"];
  };
  chain: {
    controlStatus: DecisionAIControlPacket["status"];
    operatorStatus: DecisionOperatorEpisode["status"];
    nextMove: DecisionAIControlMove;
    proofHash: string | null;
  };
  scorecard: {
    stagePasses: number;
    stageWatches: number;
    stageBlocks: number;
    replayCommands: number;
    lockedCapabilities: number;
    learningReadinessScore: number;
  };
  thoughtChain: DecisionAIThoughtStep[];
  memoryDraft: {
    table: "op_ai_thought_episodes";
    payloadHash: string;
    canPersistWithAdmin: boolean;
    storageGate: string;
    payload: Record<string, unknown>;
  };
  replay: {
    commands: Array<{
      id: string;
      label: string;
      command: string;
      safeToRun: boolean;
    }>;
    urls: string[];
  };
  persistence: DecisionAIThoughtPersistenceResult;
  controls: {
    canRunCommand: boolean;
    canPersistPrivateTrace: boolean;
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

function compact(value: string, maxLength = 320): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function defaultPersistence(): DecisionAIThoughtPersistenceResult {
  return {
    requested: false,
    status: "not-requested",
    configured: false,
    table: "op_ai_thought_episodes",
    reason: "Use POST with ODDSPADI_ADMIN_TOKEN to store this private thought episode."
  };
}

function statusFor({
  control,
  episode,
  persistence
}: {
  control: DecisionAIControlPacket;
  episode: DecisionOperatorEpisode;
  persistence: DecisionAIThoughtPersistenceResult;
}): DecisionAIThoughtEpisodeStatus {
  if (persistence.status === "stored") return "stored";
  if (control.status === "blocked" || episode.status === "blocked") return "blocked";
  if (control.nextMove.canRunNow && episode.status !== "needs-repair") return "recordable";
  if (control.status === "ready-ai-review" || episode.status === "observed" || episode.status === "advance-shadow") return "recordable";
  return "held";
}

function step(input: DecisionAIThoughtStep): DecisionAIThoughtStep {
  return {
    ...input,
    evidence: unique(input.evidence, 6),
    detail: compact(input.detail, 340),
    nextAction: compact(input.nextAction, 260)
  };
}

function buildThoughtChain({
  control,
  episode,
  canPersistWithAdmin
}: {
  control: DecisionAIControlPacket;
  episode: DecisionOperatorEpisode;
  canPersistWithAdmin: boolean;
}): DecisionAIThoughtStep[] {
  const blockedStages = control.stages.filter((item) => item.status === "block");
  const watchedStages = control.stages.filter((item) => item.status === "watch");
  const blockedEpisodeSteps = episode.timeline.filter((item) => item.status === "block");

  return [
    step({
      id: "observe",
      label: "Observe control state",
      status: control.status === "blocked" ? "block" : control.status === "manual-proof" ? "watch" : "pass",
      evidence: [control.controlHash, control.status, `blocks:${control.scorecard.stageBlocks}`],
      detail: control.summary,
      nextAction: control.nextMove.expectedEvidence
    }),
    step({
      id: "challenge",
      label: "Challenge weak evidence",
      status: blockedStages.length ? "block" : watchedStages.length ? "watch" : "pass",
      evidence: [blockedStages[0]?.label, watchedStages[0]?.label, control.forbiddenActions[0]],
      detail:
        blockedStages.length || watchedStages.length
          ? `The thought episode keeps pressure on ${blockedStages[0]?.label ?? watchedStages[0]?.label}.`
          : "No control stage reported a block or watch state.",
      nextAction: blockedStages[0]?.nextCheck ?? watchedStages[0]?.nextCheck ?? "Keep the proof chain current."
    }),
    step({
      id: "decide",
      label: "Reduce public stance",
      status: control.activeDecision.action === "avoid" ? "watch" : "pass",
      evidence: [control.activeDecision.action, control.activeDecision.trustCeiling, control.activeDecision.publicPosture],
      detail: `Public action remains ${control.activeDecision.action}; trust is capped at ${control.activeDecision.trustCeiling}.`,
      nextAction: "Do not upgrade public action from a private thought episode."
    }),
    step({
      id: "authorize",
      label: "Authorize safe operation",
      status: control.nextMove.canRunNow ? "pass" : control.nextMove.runMode === "manual-only" ? "block" : "watch",
      evidence: [control.nextMove.runMode, control.nextMove.source, control.nextMove.verifyUrl ?? "manual"],
      detail: `${control.nextMove.label} is classified as ${control.nextMove.runMode}.`,
      nextAction: control.nextMove.missingEnv.length ? `Configure ${control.nextMove.missingEnv.join(", ")}.` : control.nextMove.expectedEvidence
    }),
    step({
      id: "replay",
      label: "Replay proof path",
      status: blockedEpisodeSteps.length ? "block" : episode.replay.commands.some((item) => item.safeToRun) ? "pass" : "watch",
      evidence: [episode.episodeHash, episode.chain.proofHash ?? "pending-proof", `commands:${episode.replay.commands.length}`],
      detail: episode.operatorNarrative.next,
      nextAction: blockedEpisodeSteps[0]?.nextAction ?? "Replay only safe read-only proof commands."
    }),
    step({
      id: "store",
      label: "Store private memory",
      status: canPersistWithAdmin ? "pass" : "watch",
      evidence: ["op_ai_thought_episodes", canPersistWithAdmin ? "admin-write-ready" : "admin-write-held"],
      detail: "Storage is private trace capture only; it cannot publish, train, stake, or change the public pick.",
      nextAction: "Use the guarded POST route only after Supabase write readiness and admin token are configured."
    })
  ];
}

function compactStage(stage: DecisionAIControlPacket["stages"][number]) {
  return {
    id: stage.id,
    label: stage.label,
    status: stage.status,
    state: compact(stage.state, 180),
    nextCheck: compact(stage.nextCheck, 180)
  };
}

function compactTimeline(stepItem: DecisionOperatorEpisode["timeline"][number]) {
  return {
    id: stepItem.id,
    label: stepItem.label,
    status: stepItem.status,
    detail: compact(stepItem.detail, 180),
    nextAction: compact(stepItem.nextAction, 180)
  };
}

function buildPayload({
  control,
  episode,
  thoughtChain
}: {
  control: DecisionAIControlPacket;
  episode: DecisionOperatorEpisode;
  thoughtChain: DecisionAIThoughtStep[];
}): Record<string, unknown> {
  return {
    version: "2026-06-30.ai-thought-episode.v1",
    activeDecision: control.activeDecision,
    control: {
      hash: control.controlHash,
      status: control.status,
      summary: control.summary,
      nextMove: control.nextMove,
      scorecard: control.scorecard,
      stages: control.stages.map(compactStage)
    },
    operatorEpisode: {
      hash: episode.episodeHash,
      status: episode.status,
      summary: episode.summary,
      finalPatch: episode.finalPatch,
      timeline: episode.timeline.map(compactTimeline),
      narrative: episode.operatorNarrative
    },
    thoughtChain,
    forbiddenActions: control.forbiddenActions.slice(0, 12),
    proofUrls: unique([...control.proofUrls, ...episode.proofUrls], 26)
  };
}

export function buildDecisionAIThoughtEpisode({
  control,
  episode,
  persistence = defaultPersistence(),
  now = new Date()
}: {
  control: DecisionAIControlPacket;
  episode: DecisionOperatorEpisode;
  persistence?: DecisionAIThoughtPersistenceResult;
  now?: Date;
}): DecisionAIThoughtEpisode {
  const canPersistWithAdmin = control.status !== "blocked" && episode.status !== "blocked";
  const thoughtChain = buildThoughtChain({ control, episode, canPersistWithAdmin });
  const payload = buildPayload({ control, episode, thoughtChain });
  const payloadHash = stableHash(payload);
  const status = statusFor({ control, episode, persistence });
  const replayCommands = unique(
    [
      control.nextMove.command,
      ...episode.replay.commands.filter((item) => item.safeToRun).map((item) => item.command)
    ],
    8
  ).map((command, index) => ({
    id: index === 0 ? "control-next-move" : `operator-replay-${index}`,
    label: index === 0 ? control.nextMove.label : episode.replay.commands.find((item) => item.command === command)?.label ?? "Replay proof",
    command,
    safeToRun: index === 0 ? control.nextMove.canRunNow : Boolean(episode.replay.commands.find((item) => item.command === command)?.safeToRun)
  }));
  const proofUrls = unique(
    [
      "/api/sports/decision/ai-thought-episode",
      "/api/sports/decision/ai-control",
      "/api/sports/decision/operator-episode",
      ...control.proofUrls,
      ...episode.proofUrls
    ],
    28
  );
  const thoughtHash = stableHash({
    date: control.date,
    sport: control.sport,
    control: control.controlHash,
    episode: episode.episodeHash,
    payload: payloadHash
  });

  return {
    generatedAt: now.toISOString(),
    date: control.date,
    sport: control.sport,
    mode: "ai-thought-episode",
    status,
    thoughtHash,
    summary:
      status === "stored"
        ? "Private AI thought episode was stored for audit and replay; public action, publishing, and training remain locked."
        : status === "recordable"
          ? "Private AI thought episode is recordable as an audit trace; it cannot publish, train, or upgrade public action."
          : status === "held"
            ? "Private AI thought episode is drafted but waiting for stronger proof or write readiness."
            : "Private AI thought episode is blocked by the current control or operator state.",
    identity: {
      controlHash: control.controlHash,
      operatorEpisodeHash: episode.episodeHash,
      activeMatchId: control.activeDecision.matchId,
      activeMatch: control.activeDecision.match,
      publicAction: control.activeDecision.action,
      publicPosture: control.activeDecision.publicPosture,
      trustCeiling: control.activeDecision.trustCeiling
    },
    chain: {
      controlStatus: control.status,
      operatorStatus: episode.status,
      nextMove: control.nextMove,
      proofHash: episode.chain.proofHash
    },
    scorecard: {
      stagePasses: control.scorecard.stagePasses,
      stageWatches: control.scorecard.stageWatches,
      stageBlocks: control.scorecard.stageBlocks,
      replayCommands: replayCommands.length,
      lockedCapabilities: control.scorecard.lockedCapabilities,
      learningReadinessScore: control.scorecard.learningReadinessScore
    },
    thoughtChain,
    memoryDraft: {
      table: "op_ai_thought_episodes",
      payloadHash,
      canPersistWithAdmin,
      storageGate: "POST /api/sports/decision/ai-thought-episode with x-oddspadi-admin-token and valid OddsPadi Supabase service role.",
      payload
    },
    replay: {
      commands: replayCommands,
      urls: unique([control.nextMove.verifyUrl, ...episode.replay.urls], 12)
    },
    persistence,
    controls: {
      canRunCommand: control.controls.canRunCommand,
      canPersistPrivateTrace: canPersistWithAdmin,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    proofUrls
  };
}

function buildThoughtEpisodeRow(thought: DecisionAIThoughtEpisode) {
  return {
    episode_date: thought.date,
    sport: thought.sport,
    thought_hash: thought.thoughtHash,
    control_hash: thought.identity.controlHash,
    operator_episode_hash: thought.identity.operatorEpisodeHash,
    status: thought.status === "stored" ? "recordable" : thought.status,
    active_match_id: thought.identity.activeMatchId,
    active_match: thought.identity.activeMatch,
    public_action: thought.identity.publicAction,
    public_posture: thought.identity.publicPosture,
    next_move_label: thought.chain.nextMove.label,
    next_move_run_mode: thought.chain.nextMove.runMode,
    can_run_command: thought.controls.canRunCommand,
    can_publish: thought.controls.canPublish,
    can_train: thought.controls.canTrain,
    stage_counts: thought.scorecard,
    thought_chain: thought.thoughtChain,
    replay_commands: thought.replay.commands,
    proof_urls: thought.proofUrls,
    payload: thought.memoryDraft.payload
  };
}

export async function persistDecisionAIThoughtEpisode(thought: DecisionAIThoughtEpisode): Promise<DecisionAIThoughtPersistenceResult> {
  if (!thought.memoryDraft.canPersistWithAdmin) {
    return {
      requested: true,
      status: "skipped",
      configured: false,
      table: "op_ai_thought_episodes",
      reason: "Thought episode is not eligible for private trace persistence from the current control state."
    };
  }

  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      requested: true,
      status: "skipped",
      configured: false,
      table: "op_ai_thought_episodes",
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      requested: true,
      status: "failed",
      configured: true,
      table: "op_ai_thought_episodes",
      reason: "Supabase client could not be created."
    };
  }

  const { data, error } = await client
    .from("op_ai_thought_episodes")
    .upsert(buildThoughtEpisodeRow(thought), { onConflict: "thought_hash" })
    .select("id")
    .single();

  if (error) {
    return {
      requested: true,
      status: "failed",
      configured: true,
      table: "op_ai_thought_episodes",
      reason: error.message
    };
  }

  return {
    requested: true,
    status: "stored",
    configured: true,
    table: "op_ai_thought_episodes",
    id: typeof data?.id === "string" ? data.id : undefined
  };
}
