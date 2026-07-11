import type { DecisionAIControlMove, DecisionAIControlPacket, DecisionAIControlRunMode } from "@/lib/sports/prediction/decisionAIControlPacket";
import type { DecisionAIThoughtEpisode } from "@/lib/sports/prediction/decisionAIThoughtEpisode";
import type { DecisionAIThoughtMemory } from "@/lib/sports/prediction/decisionAIThoughtMemory";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIExperimentPlannerStatus = "ready-readonly" | "needs-memory" | "manual-proof" | "blocked";
export type DecisionAIExperimentRisk = "low" | "medium" | "high";
export type DecisionAIExperimentControlInput = Pick<DecisionAIControlPacket, "controlHash" | "status" | "nextMove" | "proofUrls">;

export type DecisionAIExperimentCandidate = {
  id: string;
  label: string;
  objective: string;
  hypothesis: string;
  falsifier: string;
  command: string | null;
  verifyUrl: string;
  runMode: DecisionAIControlRunMode;
  missingEnv: string[];
  canRunNow: boolean;
  expectedEvidence: string;
  source: string;
  risk: DecisionAIExperimentRisk;
  blockers: string[];
  evidenceInputs: string[];
};

export type DecisionAIExperimentPlanner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-experiment-planner";
  status: DecisionAIExperimentPlannerStatus;
  plannerHash: string;
  summary: string;
  memoryDecision: {
    status: DecisionAIThoughtMemory["status"];
    action: DecisionAIThoughtMemory["recall"]["recommendation"]["action"];
    influence: DecisionAIThoughtMemory["recall"]["recommendation"]["influence"];
    reason: string;
    nextCheck: string;
    usableSimilarEpisodes: number;
  };
  selectedExperiment: DecisionAIExperimentCandidate | null;
  candidates: DecisionAIExperimentCandidate[];
  selection: {
    rationale: string;
    whyThis: string[];
    rejected: string[];
  };
  controls: {
    canRunReadOnly: boolean;
    canRunCommand: boolean;
    canAskOpenAI: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
  };
  forbiddenActions: string[];
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

function unique<T>(values: T[], limit = values.length): T[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function commandRunMode(command: string | null): DecisionAIControlRunMode {
  if (!command) return "manual-only";
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return "manual-only";
  if (lower.includes("persist=1") || lower.includes("persist=true") || lower.includes("publish=1")) return "manual-only";
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return "manual-only";
  if (lower.includes("-x post") || lower.includes("-xpost")) return lower.includes("dryrun=1") || lower.includes("dryrun=true") ? "dry-run" : "manual-only";
  return "read-only";
}

function missingEnvFromCommand(command: string | null): string[] {
  if (!command) return [];
  return unique(Array.from(command.matchAll(/<([A-Z0-9_]+)>/g)).map((match) => match[1]), 8);
}

function localUrl(path: string): string {
  return decisionApiUrl(path);
}

function withQuery(path: string, date: string, sport: Sport, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ date, sport, ...extra });
  return `${path}?${params.toString()}`;
}

function routeCandidate({
  id,
  label,
  objective,
  hypothesis,
  falsifier,
  verifyUrl,
  expectedEvidence,
  source,
  risk = "low",
  blockers = [],
  evidenceInputs = []
}: {
  id: string;
  label: string;
  objective: string;
  hypothesis: string;
  falsifier: string;
  verifyUrl: string;
  expectedEvidence: string;
  source: string;
  risk?: DecisionAIExperimentRisk;
  blockers?: string[];
  evidenceInputs?: string[];
}): DecisionAIExperimentCandidate {
  const command = `curl.exe -sS "${localUrl(verifyUrl)}"`;
  return {
    id,
    label,
    objective,
    hypothesis,
    falsifier,
    command,
    verifyUrl,
    runMode: "read-only",
    missingEnv: [],
    canRunNow: blockers.length === 0,
    expectedEvidence,
    source,
    risk,
    blockers,
    evidenceInputs
  };
}

function commandCandidate({
  id,
  label,
  objective,
  hypothesis,
  falsifier,
  command,
  verifyUrl,
  expectedEvidence,
  source,
  risk = "medium",
  blockers = [],
  evidenceInputs = [],
  controlMove
}: {
  id: string;
  label: string;
  objective: string;
  hypothesis: string;
  falsifier: string;
  command: string | null;
  verifyUrl: string;
  expectedEvidence: string;
  source: string;
  risk?: DecisionAIExperimentRisk;
  blockers?: string[];
  evidenceInputs?: string[];
  controlMove?: DecisionAIControlMove;
}): DecisionAIExperimentCandidate {
  const runMode = controlMove?.runMode ?? commandRunMode(command);
  const missingEnv = unique([...(controlMove?.missingEnv ?? []), ...missingEnvFromCommand(command)], 8);
  return {
    id,
    label,
    objective,
    hypothesis,
    falsifier,
    command,
    verifyUrl,
    runMode,
    missingEnv,
    canRunNow: Boolean(command && runMode !== "manual-only" && missingEnv.length === 0 && blockers.length === 0),
    expectedEvidence,
    source,
    risk,
    blockers,
    evidenceInputs
  };
}

function buildCandidates({
  control,
  thought,
  memory
}: {
  control: DecisionAIExperimentControlInput;
  thought: DecisionAIThoughtEpisode;
  memory: DecisionAIThoughtMemory;
}): DecisionAIExperimentCandidate[] {
  const recommendation = memory.recall.recommendation;
  const memoryUrl = withQuery("/api/sports/decision/ai-thought-memory", thought.date, thought.sport, { limit: "12" });
  const thoughtUrl = withQuery("/api/sports/decision/ai-thought-episode", thought.date, thought.sport);
  const controlUrl = withQuery("/api/sports/decision/ai-control", thought.date, thought.sport);
  const sessionEvaluationUrl = withQuery("/api/sports/decision/ai-session-evaluation", thought.date, thought.sport, { run: "1" });

  const recurringBlockers = memory.recall.recurringBlockers.slice(0, 4);
  const firstReplay = thought.replay.commands.find((item) => item.safeToRun) ?? thought.replay.commands[0] ?? null;
  const firstReplayUrl = thought.replay.urls[0] ?? thoughtUrl;
  const candidates: DecisionAIExperimentCandidate[] = [];

  if (recommendation.action === "hold-public-action") {
    candidates.push(
      routeCandidate({
        id: "replay-memory-blockers",
        label: "Replay memory blockers",
        objective: "Check whether similar private thought episodes still require the public action to stay held.",
        hypothesis: "The recalled blockers are still present, so the safest public action remains avoid or watch-only.",
        falsifier: "Thought memory returns no similar blocker pressure and the control packet no longer reports blocked/watch stages.",
        verifyUrl: memoryUrl,
        expectedEvidence: recommendation.nextCheck,
        source: "thought-memory",
        risk: "low",
        evidenceInputs: [memory.memoryHash, thought.thoughtHash, control.controlHash]
      })
    );
  }

  if (recommendation.action === "replay-similar-proof" && firstReplay) {
    candidates.push(
      commandCandidate({
        id: "replay-similar-proof",
        label: firstReplay.label,
        objective: "Replay the strongest similar proof path without changing public action or training state.",
        hypothesis: "A read-only replay will reproduce the same evidence shape as the recalled private episode.",
        falsifier: "The replay response hash, status, or blocker set materially differs from the similar stored episode.",
        command: firstReplay.command,
        verifyUrl: firstReplayUrl,
        expectedEvidence: recommendation.nextCheck,
        source: "thought-memory",
        risk: "medium",
        evidenceInputs: [memory.memoryHash, thought.memoryDraft.payloadHash]
      })
    );
  }

  if (recommendation.action === "capture-current-trace") {
    candidates.push(
      routeCandidate({
        id: "capture-current-trace",
        label: "Capture current thought trace",
        objective: "Make the current control and thought episode observable before trusting recall.",
        hypothesis: "A fresh thought episode will expose the current blockers, replay commands, and storage gate.",
        falsifier: "The thought episode cannot be built or lacks the control and operator hashes needed for future recall.",
        verifyUrl: thoughtUrl,
        expectedEvidence: "AI thought episode returns a stable thought hash, replay commands, proof URLs, and private memory payload hash.",
        source: "thought-episode",
        risk: "low",
        evidenceInputs: [thought.thoughtHash, control.controlHash]
      })
    );
  }

  candidates.push(
    commandCandidate({
      id: "control-next-move",
      label: control.nextMove.label,
      objective: "Run the control packet's selected bounded proof move.",
      hypothesis: "The control packet selected this move because it is the safest proof transition available now.",
      falsifier: "The command is not read-only/dry-run, has missing env placeholders, or fails to produce expected evidence.",
      command: control.nextMove.command,
      verifyUrl: control.nextMove.verifyUrl ?? controlUrl,
      expectedEvidence: control.nextMove.expectedEvidence,
      source: control.nextMove.source,
      risk: control.nextMove.runMode === "read-only" ? "low" : control.nextMove.runMode === "dry-run" ? "medium" : "high",
      blockers: control.nextMove.missingEnv.map((item) => `Missing ${item}`),
      evidenceInputs: [control.controlHash, control.status],
      controlMove: control.nextMove
    }),
    routeCandidate({
      id: "inspect-session-shadow",
      label: "Inspect session shadow evaluation",
      objective: "Check whether the AI decision session can become a no-write learning candidate.",
      hypothesis: "Learning remains locked until session, outcome, calibration, backtest, corpus, and permission gates clear.",
      falsifier: "The shadow evaluation returns pass gates with real outcome/backtest/corpus proof and training still locked by policy.",
      verifyUrl: sessionEvaluationUrl,
      expectedEvidence: "AI session shadow evaluation returns gate scores and keeps training permission false.",
      source: "session-shadow-evaluation",
      risk: "low",
      evidenceInputs: [thought.identity.operatorEpisodeHash, control.controlHash]
    })
  );

  if (firstReplay) {
    candidates.push(
      commandCandidate({
        id: "thought-replay-command",
        label: firstReplay.label,
        objective: "Replay the thought episode's first safe proof command.",
        hypothesis: "The replay command should reproduce the public operator proof without persistence or publishing.",
        falsifier: "The replay command is unsafe, requires missing env, or returns a proof state that contradicts the thought episode.",
        command: firstReplay.command,
        verifyUrl: firstReplayUrl,
        expectedEvidence: "Replay response confirms the operator proof path and keeps public action no stronger.",
        source: "thought-episode",
        risk: firstReplay.safeToRun ? "medium" : "high",
        blockers: firstReplay.safeToRun ? [] : ["Thought replay command is not marked safe."],
        evidenceInputs: [thought.thoughtHash, thought.memoryDraft.payloadHash]
      })
    );
  }

  if (recurringBlockers.length) {
    candidates.push(
      routeCandidate({
        id: "audit-recurring-blockers",
        label: "Audit recurring blockers",
        objective: "Name the repeated blockers before any trust or action change.",
        hypothesis: "Recurring blockers explain why the planner should reduce trust or stay audit-only.",
        falsifier: "No recurring blocker is present after a fresh thought-memory read.",
        verifyUrl: memoryUrl,
        expectedEvidence: recurringBlockers[0],
        source: "thought-memory",
        risk: "low",
        evidenceInputs: recurringBlockers
      })
    );
  }

  const byId = new Map<string, DecisionAIExperimentCandidate>();
  for (const candidate of candidates) {
    if (!byId.has(candidate.id)) byId.set(candidate.id, candidate);
  }
  return Array.from(byId.values()).slice(0, 8);
}

function chooseCandidate(candidates: DecisionAIExperimentCandidate[], memory: DecisionAIThoughtMemory): DecisionAIExperimentCandidate | null {
  const preferredIds =
    memory.recall.recommendation.action === "hold-public-action"
      ? ["replay-memory-blockers", "audit-recurring-blockers", "control-next-move"]
      : memory.recall.recommendation.action === "replay-similar-proof"
        ? ["replay-similar-proof", "thought-replay-command", "control-next-move"]
        : ["capture-current-trace", "control-next-move", "inspect-session-shadow"];

  for (const id of preferredIds) {
    const candidate = candidates.find((item) => item.id === id && item.canRunNow && item.runMode === "read-only");
    if (candidate) return candidate;
  }

  return (
    candidates.find((item) => item.canRunNow && item.runMode === "read-only") ??
    candidates.find((item) => item.canRunNow && item.runMode === "dry-run") ??
    candidates.find((item) => item.runMode !== "manual-only" && !item.missingEnv.length) ??
    candidates[0] ??
    null
  );
}

function statusFor(selected: DecisionAIExperimentCandidate | null, memory: DecisionAIThoughtMemory): DecisionAIExperimentPlannerStatus {
  if (memory.status === "not-configured" || memory.status === "failed") return "needs-memory";
  if (selected?.canRunNow && selected.runMode === "read-only") return "ready-readonly";
  if (selected?.canRunNow || selected?.runMode === "dry-run") return "manual-proof";
  return "blocked";
}

function summaryFor(status: DecisionAIExperimentPlannerStatus, selected: DecisionAIExperimentCandidate | null, memory: DecisionAIThoughtMemory): string {
  if (status === "needs-memory") {
    return `AI experiment planner is waiting for private thought memory, so the selected experiment is only ${selected?.label ?? "trace capture"}.`;
  }
  if (status === "ready-readonly") return `AI experiment planner selected ${selected?.label ?? "a read-only proof"} as the next bounded read-only experiment.`;
  if (status === "manual-proof") return `AI experiment planner selected ${selected?.label ?? "a proof"} but it still needs manual proof controls.`;
  return "AI experiment planner is blocked; no experiment can raise trust, publish, persist, or train.";
}

function selectionReasons(selected: DecisionAIExperimentCandidate | null, memory: DecisionAIThoughtMemory): string[] {
  if (!selected) return ["No experiment candidate is available."];
  return unique(
    [
      `memory:${memory.recall.recommendation.action}`,
      `influence:${memory.recall.recommendation.influence}`,
      `run:${selected.runMode}`,
      selected.canRunNow ? "can-run-now" : "needs-operator-proof",
      selected.risk === "low" ? "low-risk-route" : `risk:${selected.risk}`
    ],
    6
  );
}

export function buildDecisionAIExperimentPlanner({
  control,
  thought,
  memory,
  now = new Date()
}: {
  control: DecisionAIExperimentControlInput;
  thought: DecisionAIThoughtEpisode;
  memory: DecisionAIThoughtMemory;
  now?: Date;
}): DecisionAIExperimentPlanner {
  const candidates = buildCandidates({ control, thought, memory });
  const selectedExperiment = chooseCandidate(candidates, memory);
  const status = statusFor(selectedExperiment, memory);
  const controls = {
    canRunReadOnly: Boolean(selectedExperiment?.canRunNow && selectedExperiment.runMode === "read-only"),
    canRunCommand: Boolean(selectedExperiment?.canRunNow && selectedExperiment.runMode !== "manual-only"),
    canAskOpenAI: false as const,
    canPersist: false as const,
    canPublish: false as const,
    canTrain: false as const,
    canRaiseTrust: false as const,
    canUpgradePublicAction: false as const
  };
  const plannerHash = stableHash({
    control: control.controlHash,
    thought: thought.thoughtHash,
    memory: memory.memoryHash,
    recommendation: memory.recall.recommendation.action,
    selected: selectedExperiment?.id,
    status,
    controls
  });

  return {
    generatedAt: now.toISOString(),
    date: thought.date,
    sport: thought.sport,
    mode: "ai-experiment-planner",
    status,
    plannerHash,
    summary: summaryFor(status, selectedExperiment, memory),
    memoryDecision: {
      status: memory.status,
      action: memory.recall.recommendation.action,
      influence: memory.recall.recommendation.influence,
      reason: compact(memory.recall.recommendation.reason, 260),
      nextCheck: memory.recall.recommendation.nextCheck,
      usableSimilarEpisodes: memory.controls.canUseForAudit ? memory.recall.similarCount : 0
    },
    selectedExperiment,
    candidates,
    selection: {
      rationale: selectedExperiment
        ? `${selectedExperiment.label} was selected because recall is ${memory.recall.recommendation.influence} and the route is ${selectedExperiment.runMode}.`
        : "No bounded experiment was selected.",
      whyThis: selectionReasons(selectedExperiment, memory),
      rejected: candidates
        .filter((item) => item.id !== selectedExperiment?.id)
        .slice(0, 5)
        .map((item) => `${item.label}: ${item.canRunNow ? "lower priority" : item.missingEnv[0] ?? item.blockers[0] ?? "not runnable now"}`)
    },
    controls,
    forbiddenActions: unique(
      [
        "Do not publish, persist, train, stake, or upgrade public action from the experiment planner.",
        "Do not treat private memory as authority; use it only to choose proof or reduce trust.",
        "Do not run manual-only commands or commands with missing env placeholders.",
        "Do not ask OpenAI from this planner route; use the existing bounded AI review routes."
      ],
      8
    ),
    proofUrls: unique(
      [
        "/api/sports/decision/ai-experiment-planner",
        "/api/sports/decision/ai-thought-memory",
        "/api/sports/decision/ai-thought-episode",
        "/api/sports/decision/ai-control",
        ...(selectedExperiment ? [selectedExperiment.verifyUrl] : []),
        ...memory.proofUrls,
        ...thought.proofUrls,
        ...control.proofUrls
      ],
      32
    )
  };
}
