import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { DecisionAIThoughtEpisode, DecisionAIThoughtStep } from "@/lib/sports/prediction/decisionAIThoughtEpisode";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIThoughtMemoryStatus = "ready" | "no-memory" | "not-configured" | "failed";
export type DecisionAIThoughtMemoryInfluence = "none" | "audit-only" | "reduce-trust";
export type DecisionAIThoughtMemoryAction = "capture-current-trace" | "replay-similar-proof" | "hold-public-action";

export type DecisionAIStoredThoughtEpisode = {
  id: string;
  date: string;
  sport: Sport;
  thoughtHash: string;
  controlHash: string;
  operatorEpisodeHash: string;
  status: "recordable" | "held" | "blocked" | "stored";
  activeMatchId: string | null;
  activeMatch: string | null;
  publicAction: DecisionAIThoughtEpisode["identity"]["publicAction"];
  publicPosture: string;
  nextMoveLabel: string;
  nextMoveRunMode: DecisionAIThoughtEpisode["chain"]["nextMove"]["runMode"];
  canRunCommand: boolean;
  canPublish: boolean;
  canTrain: boolean;
  stageBlocks: number;
  replayCommands: number;
  blockers: string[];
  createdAt: string;
  payloadHash?: string | null;
};

export type DecisionAIThoughtMemoryMatch = DecisionAIStoredThoughtEpisode & {
  similarity: number;
  matchReasons: string[];
  caution: string;
};

export type DecisionAIThoughtMemory = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-thought-memory";
  status: DecisionAIThoughtMemoryStatus;
  memoryHash: string;
  summary: string;
  read: {
    configured: boolean;
    projectRef: string | null;
    table: "op_ai_thought_episodes";
    inspected: number;
    reason?: string;
  };
  current: {
    thoughtHash: string;
    controlHash: string;
    activeMatchId: string | null;
    activeMatch: string | null;
    publicAction: DecisionAIThoughtEpisode["identity"]["publicAction"];
    publicPosture: string;
    nextMoveLabel: string;
    nextMoveRunMode: DecisionAIThoughtEpisode["chain"]["nextMove"]["runMode"];
    stageBlocks: number;
    replayCommands: number;
  };
  similarEpisodes: DecisionAIThoughtMemoryMatch[];
  recall: {
    strongestSimilarity: number;
    similarCount: number;
    recurringBlockers: string[];
    lessons: string[];
    recommendation: {
      action: DecisionAIThoughtMemoryAction;
      influence: DecisionAIThoughtMemoryInfluence;
      reason: string;
      nextCheck: string;
    };
  };
  controls: {
    canUseForAudit: boolean;
    canRaiseTrust: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
};

type DbAIThoughtEpisodeRow = {
  id?: string;
  episode_date?: string;
  sport?: string;
  thought_hash?: string;
  control_hash?: string;
  operator_episode_hash?: string;
  status?: string;
  active_match_id?: string | null;
  active_match?: string | null;
  public_action?: string;
  public_posture?: string;
  next_move_label?: string;
  next_move_run_mode?: string;
  can_run_command?: boolean;
  can_publish?: boolean;
  can_train?: boolean;
  stage_counts?: unknown;
  thought_chain?: unknown;
  replay_commands?: unknown;
  payload?: unknown;
  created_at?: string;
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

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function publicActionValue(value: unknown): DecisionAIStoredThoughtEpisode["publicAction"] {
  return value === "consider" || value === "monitor" || value === "avoid" ? value : "avoid";
}

function statusValue(value: unknown): DecisionAIStoredThoughtEpisode["status"] {
  return value === "recordable" || value === "held" || value === "blocked" || value === "stored" ? value : "held";
}

function runModeValue(value: unknown): DecisionAIStoredThoughtEpisode["nextMoveRunMode"] {
  return value === "read-only" || value === "dry-run" || value === "manual-only" ? value : "manual-only";
}

function sportValue(value: unknown): Sport {
  return value === "football" || value === "basketball" || value === "tennis" || value === "cricket" || value === "rugby" || value === "handball"
    ? value
    : "football";
}

function stageBlocksFromCounts(value: unknown): number {
  if (!isRecord(value)) return 0;
  return numberValue(value.stageBlocks ?? value.blocks);
}

function replayCommandCount(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function payloadHash(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const hash = value.payloadHash ?? value.hash;
  return typeof hash === "string" ? hash : stableHash(value);
}

function blockersFromThoughtChain(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .filter((item) => item.status === "watch" || item.status === "block")
    .map((item) => {
      const label = stringValue(item.label, "Stored thought step");
      const nextAction = stringValue(item.nextAction, "Replay proof before changing trust.");
      return `${label}: ${nextAction}`;
    })
    .slice(0, 6);
}

function currentAsStored(thought: DecisionAIThoughtEpisode): DecisionAIStoredThoughtEpisode {
  return {
    id: "current-thought",
    date: thought.date,
    sport: thought.sport,
    thoughtHash: thought.thoughtHash,
    controlHash: thought.identity.controlHash,
    operatorEpisodeHash: thought.identity.operatorEpisodeHash,
    status: thought.status,
    activeMatchId: thought.identity.activeMatchId,
    activeMatch: thought.identity.activeMatch,
    publicAction: thought.identity.publicAction,
    publicPosture: thought.identity.publicPosture,
    nextMoveLabel: thought.chain.nextMove.label,
    nextMoveRunMode: thought.chain.nextMove.runMode,
    canRunCommand: thought.controls.canRunCommand,
    canPublish: thought.controls.canPublish,
    canTrain: thought.controls.canTrain,
    stageBlocks: thought.scorecard.stageBlocks,
    replayCommands: thought.scorecard.replayCommands,
    blockers: thought.thoughtChain.filter((item) => item.status !== "pass").map((item) => `${item.label}: ${item.nextAction}`),
    createdAt: thought.generatedAt,
    payloadHash: thought.memoryDraft.payloadHash
  };
}

export function decisionAIStoredThoughtFromRow(row: DbAIThoughtEpisodeRow): DecisionAIStoredThoughtEpisode {
  return {
    id: stringValue(row.id, stringValue(row.thought_hash, "stored-thought")),
    date: stringValue(row.episode_date, ""),
    sport: sportValue(row.sport),
    thoughtHash: stringValue(row.thought_hash, "unknown-thought"),
    controlHash: stringValue(row.control_hash, "unknown-control"),
    operatorEpisodeHash: stringValue(row.operator_episode_hash, "unknown-operator"),
    status: statusValue(row.status),
    activeMatchId: typeof row.active_match_id === "string" ? row.active_match_id : null,
    activeMatch: typeof row.active_match === "string" ? row.active_match : null,
    publicAction: publicActionValue(row.public_action),
    publicPosture: stringValue(row.public_posture, "private audit only"),
    nextMoveLabel: stringValue(row.next_move_label, "Stored next move"),
    nextMoveRunMode: runModeValue(row.next_move_run_mode),
    canRunCommand: booleanValue(row.can_run_command),
    canPublish: booleanValue(row.can_publish),
    canTrain: booleanValue(row.can_train),
    stageBlocks: stageBlocksFromCounts(row.stage_counts),
    replayCommands: replayCommandCount(row.replay_commands),
    blockers: blockersFromThoughtChain(row.thought_chain),
    createdAt: stringValue(row.created_at, ""),
    payloadHash: payloadHash(row.payload)
  };
}

function similarityReasons(current: DecisionAIStoredThoughtEpisode, stored: DecisionAIStoredThoughtEpisode): string[] {
  return unique(
    [
      current.thoughtHash === stored.thoughtHash ? "same thought hash" : null,
      current.controlHash === stored.controlHash ? "same control hash" : null,
      current.operatorEpisodeHash === stored.operatorEpisodeHash ? "same operator episode" : null,
      current.activeMatchId && current.activeMatchId === stored.activeMatchId ? "same active match" : null,
      current.publicAction === stored.publicAction ? `same public action ${current.publicAction}` : null,
      current.nextMoveRunMode === stored.nextMoveRunMode ? `same run mode ${current.nextMoveRunMode}` : null,
      Math.abs(current.stageBlocks - stored.stageBlocks) <= 1 ? "similar stage-block pressure" : null,
      current.canPublish === false && stored.canPublish === false && current.canTrain === false && stored.canTrain === false ? "publish and train both locked" : null
    ],
    8
  );
}

function similarity(current: DecisionAIStoredThoughtEpisode, stored: DecisionAIStoredThoughtEpisode): number {
  let score = 0;
  if (current.thoughtHash === stored.thoughtHash) score += 0.2;
  if (current.controlHash === stored.controlHash) score += 0.18;
  if (current.operatorEpisodeHash === stored.operatorEpisodeHash) score += 0.12;
  if (current.activeMatchId && current.activeMatchId === stored.activeMatchId) score += 0.18;
  if (current.publicAction === stored.publicAction) score += 0.1;
  if (current.publicPosture === stored.publicPosture) score += 0.06;
  if (current.nextMoveRunMode === stored.nextMoveRunMode) score += 0.1;
  score += Math.max(0, 1 - Math.abs(current.stageBlocks - stored.stageBlocks) / 6) * 0.12;
  score += Math.max(0, 1 - Math.abs(current.replayCommands - stored.replayCommands) / 6) * 0.06;
  if (!current.canPublish && !stored.canPublish && !current.canTrain && !stored.canTrain) score += 0.08;
  return Math.round(Math.min(1, score) * 100) / 100;
}

function toMemoryMatch(current: DecisionAIStoredThoughtEpisode, stored: DecisionAIStoredThoughtEpisode): DecisionAIThoughtMemoryMatch {
  const score = similarity(current, stored);
  return {
    ...stored,
    similarity: score,
    matchReasons: similarityReasons(current, stored),
    caution:
      stored.canPublish || stored.canTrain
        ? "Stored episode had a write-like flag; keep this memory as audit-only until reviewed."
        : "Stored episode kept publish/train locked; use it only to choose proof, not to raise trust."
  };
}

function recurringBlockers(matches: DecisionAIThoughtMemoryMatch[]): string[] {
  return unique(matches.flatMap((item) => item.blockers), 6);
}

function lessonsFor(matches: DecisionAIThoughtMemoryMatch[]): string[] {
  if (!matches.length) {
    return ["No stored private thought episodes were available; capture this trace before trusting memory recall."];
  }
  const top = matches[0];
  return unique(
    [
      top.activeMatchId ? `Similar private memory exists for ${top.activeMatch ?? top.activeMatchId}; replay proof before changing trust.` : null,
      matches.some((item) => item.publicAction === "avoid") ? "At least one similar episode kept the public action at avoid." : null,
      matches.some((item) => item.stageBlocks > 0) ? "Recurring stage blocks mean memory can only guide the next proof check." : null,
      matches.every((item) => !item.canPublish && !item.canTrain) ? "Similar episodes kept publish/train locked, so recall stays audit-only." : null,
      top.nextMoveRunMode === "read-only" ? "The strongest memory points to a read-only replay path." : null
    ],
    6
  );
}

function recommendation({
  status,
  matches,
  reason
}: {
  status: DecisionAIThoughtMemoryStatus;
  matches: DecisionAIThoughtMemoryMatch[];
  reason?: string;
}): DecisionAIThoughtMemory["recall"]["recommendation"] {
  if (status === "not-configured" || status === "failed") {
    return {
      action: "capture-current-trace",
      influence: "none",
      reason: reason ?? "Private thought memory is unavailable.",
      nextCheck: "Prove OddsPadi Supabase writes and the op_ai_thought_episodes table before relying on recall."
    };
  }
  if (!matches.length) {
    return {
      action: "capture-current-trace",
      influence: "none",
      reason: "No similar private thought episodes were found.",
      nextCheck: "Store the current private thought episode after admin and Supabase gates pass."
    };
  }
  if (matches.some((item) => item.publicAction === "avoid" || item.stageBlocks > 0)) {
    return {
      action: "hold-public-action",
      influence: "reduce-trust",
      reason: "Similar memory contains avoid actions or blocked stages, so it can only lower trust or keep the stance cautious.",
      nextCheck: matches[0].blockers[0] ?? "Replay the strongest similar proof path before any trust change."
    };
  }
  return {
    action: "replay-similar-proof",
    influence: "audit-only",
    reason: "Similar private thought episodes can guide which proof to replay, but cannot publish or train.",
    nextCheck: "Replay the highest-similarity proof command and compare receipt hashes."
  };
}

export function buildDecisionAIThoughtMemory({
  thought,
  storedEpisodes,
  readStatus,
  configured = true,
  projectRef = null,
  reason,
  now = new Date()
}: {
  thought: DecisionAIThoughtEpisode;
  storedEpisodes: DecisionAIStoredThoughtEpisode[];
  readStatus?: DecisionAIThoughtMemoryStatus;
  configured?: boolean;
  projectRef?: string | null;
  reason?: string;
  now?: Date;
}): DecisionAIThoughtMemory {
  const current = currentAsStored(thought);
  const matches = storedEpisodes
    .filter((item) => item.thoughtHash !== thought.thoughtHash || item.createdAt !== thought.generatedAt)
    .map((item) => toMemoryMatch(current, item))
    .filter((item) => item.similarity >= 0.35)
    .sort((a, b) => b.similarity - a.similarity || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 6);
  const status =
    readStatus ??
    (storedEpisodes.length ? (matches.length ? "ready" : "no-memory") : "no-memory");
  const blockers = recurringBlockers(matches);
  const lessons = lessonsFor(matches);
  const recallRecommendation = recommendation({ status, matches, reason });
  const memoryHash = stableHash({
    thought: thought.thoughtHash,
    status,
    matches: matches.map((item) => [item.thoughtHash, item.similarity]),
    recommendation: recallRecommendation.action
  });

  return {
    generatedAt: now.toISOString(),
    date: thought.date,
    sport: thought.sport,
    mode: "ai-thought-memory",
    status,
    memoryHash,
    summary:
      status === "ready"
        ? `Thought memory found ${matches.length} similar private episode${matches.length === 1 ? "" : "s"}; recall remains audit-only.`
        : status === "no-memory"
          ? "Thought memory has no similar private episodes yet; capture the current trace before trusting recall."
          : status === "not-configured"
            ? "Thought memory is not configured because private Supabase reads are not ready."
            : "Thought memory failed to read private trace storage.",
    read: {
      configured,
      projectRef,
      table: "op_ai_thought_episodes",
      inspected: storedEpisodes.length,
      reason
    },
    current: {
      thoughtHash: thought.thoughtHash,
      controlHash: thought.identity.controlHash,
      activeMatchId: thought.identity.activeMatchId,
      activeMatch: thought.identity.activeMatch,
      publicAction: thought.identity.publicAction,
      publicPosture: thought.identity.publicPosture,
      nextMoveLabel: thought.chain.nextMove.label,
      nextMoveRunMode: thought.chain.nextMove.runMode,
      stageBlocks: thought.scorecard.stageBlocks,
      replayCommands: thought.scorecard.replayCommands
    },
    similarEpisodes: matches,
    recall: {
      strongestSimilarity: matches[0]?.similarity ?? 0,
      similarCount: matches.length,
      recurringBlockers: blockers,
      lessons,
      recommendation: recallRecommendation
    },
    controls: {
      canUseForAudit: status === "ready" && matches.length > 0,
      canRaiseTrust: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(
      [
        "/api/sports/decision/ai-thought-memory",
        "/api/sports/decision/ai-thought-episode",
        "/api/sports/decision/ai-control",
        ...thought.proofUrls
      ],
      24
    )
  };
}

export async function getDecisionAIThoughtMemory({
  thought,
  limit = 24
}: {
  thought: DecisionAIThoughtEpisode;
  limit?: number;
}): Promise<DecisionAIThoughtMemory> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    const reason = `Supabase private thought reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`;
    return buildDecisionAIThoughtMemory({
      thought,
      storedEpisodes: [],
      readStatus: "not-configured",
      configured: false,
      projectRef: runtime.projectRef,
      reason
    });
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return buildDecisionAIThoughtMemory({
      thought,
      storedEpisodes: [],
      readStatus: "failed",
      configured: true,
      projectRef: runtime.projectRef,
      reason: "Supabase client could not be created."
    });
  }

  const result = await client
    .from("op_ai_thought_episodes")
    .select(
      "id, episode_date, sport, thought_hash, control_hash, operator_episode_hash, status, active_match_id, active_match, public_action, public_posture, next_move_label, next_move_run_mode, can_run_command, can_publish, can_train, stage_counts, thought_chain, replay_commands, payload, created_at"
    )
    .eq("sport", thought.sport)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));

  if (result.error) {
    return buildDecisionAIThoughtMemory({
      thought,
      storedEpisodes: [],
      readStatus: "failed",
      configured: true,
      projectRef: runtime.projectRef,
      reason: result.error.message
    });
  }

  const storedEpisodes = ((result.data ?? []) as DbAIThoughtEpisodeRow[]).map(decisionAIStoredThoughtFromRow);
  return buildDecisionAIThoughtMemory({
    thought,
    storedEpisodes,
    configured: true,
    projectRef: runtime.projectRef,
    reason: storedEpisodes.length ? undefined : "No private thought episodes are stored yet."
  });
}
