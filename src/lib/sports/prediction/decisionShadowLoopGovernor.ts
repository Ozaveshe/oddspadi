import type { DecisionShadowNextCycleInterpreter } from "@/lib/sports/prediction/decisionShadowNextCycleInterpreter";
import type { DecisionShadowReasoningLoop } from "@/lib/sports/prediction/decisionShadowReasoningLoop";
import type { DecisionShadowWorkingMemory } from "@/lib/sports/prediction/decisionShadowWorkingMemory";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowLoopGovernorStatus = "observe-receipt" | "ask-next-question" | "inspect-memory" | "repair-required" | "hold" | "blocked";
export type DecisionShadowLoopGovernorIntentId = "observe-receipt" | "ask-next-question" | "inspect-memory" | "repair-proof" | "hold";
export type DecisionShadowLoopGovernorBeliefStatus = "supported" | "uncertain" | "blocked";

export type DecisionShadowLoopGovernorCandidate = {
  id: DecisionShadowLoopGovernorIntentId;
  status: "ready" | "waiting" | "blocked";
  label: string;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  expectedEvidence: string;
  expectedStateChange: string;
  utility: {
    informationGain: number;
    urgency: number;
    safety: number;
    score: number;
  };
  blockedBy: string[];
  rationale: string;
};

export type DecisionShadowLoopGovernorBelief = {
  id: "proof-state" | "memory-state" | "loop-budget" | "safety-locks";
  label: string;
  status: DecisionShadowLoopGovernorBeliefStatus;
  confidence: number;
  evidence: string[];
  implication: string;
};

export type DecisionShadowLoopGovernor = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowReasoningLoop["sport"];
  mode: "decision-shadow-loop-governor";
  status: DecisionShadowLoopGovernorStatus;
  governorHash: string;
  summary: string;
  selectedIntent: DecisionShadowLoopGovernorCandidate;
  candidates: DecisionShadowLoopGovernorCandidate[];
  beliefs: DecisionShadowLoopGovernorBelief[];
  decisionBoundary: string[];
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string;
    content: string;
  };
  controls: {
    canRunSelectedCommand: boolean;
    canRunReadOnly: boolean;
    canInspectMemory: true;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function unique(values: Array<string | null | undefined>, limit = 28): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function safeCommand(command: string | null, verifyUrl: string): boolean {
  if (!command || !verifyUrl.startsWith("/api/sports/decision/")) return false;
  const lower = command.toLowerCase();
  const banned = ["persist=1", "persist=true", "publish=1", "train=1", "stake=1", "dryrun=0", "dryrun=false", "deploy", "--prod"];
  return lower.includes("curl.exe") && lower.includes("/api/sports/decision/") && !banned.some((token) => lower.includes(token));
}

function utility(input: { informationGain: number; urgency: number; safety: number; allowed: boolean }) {
  const score = input.allowed ? input.informationGain * 0.45 + input.urgency * 0.3 + input.safety * 0.25 : 0;
  return {
    informationGain: input.informationGain,
    urgency: input.urgency,
    safety: input.safety,
    score: Number(score.toFixed(2))
  };
}

function candidate(input: Omit<DecisionShadowLoopGovernorCandidate, "rationale"> & { rationale?: string }): DecisionShadowLoopGovernorCandidate {
  return {
    ...input,
    blockedBy: unique(input.blockedBy, 8),
    rationale:
      input.rationale ??
      (input.safeToRun
        ? `${input.label} is selected inside read-only shadow-loop controls.`
        : `${input.label} is held until blockers clear.`)
  };
}

function buildCandidates({
  loop,
  memory,
  interpreter
}: {
  loop: DecisionShadowReasoningLoop;
  memory: DecisionShadowWorkingMemory;
  interpreter: DecisionShadowNextCycleInterpreter;
}): DecisionShadowLoopGovernorCandidate[] {
  const observeAllowed = loop.decision.nextMove === "observe-receipt" && loop.controls.canRunOneReadOnlyTurn;
  const askAllowed = loop.decision.nextMove === "ask-next-question" && loop.controls.canRunOneReadOnlyTurn;
  const memoryUrl = `/api/sports/decision/shadow-working-memory?date=${encodeURIComponent(loop.date)}&sport=${encodeURIComponent(loop.sport)}`;
  const repairUrl = interpreter.nextTurn.verifyUrl;

  return [
    candidate({
      id: "observe-receipt",
      status: observeAllowed ? "ready" : loop.status === "awaiting-observation" ? "waiting" : "blocked",
      label: "Observe selected shadow receipt",
      command: observeAllowed ? loop.decision.command : null,
      verifyUrl: loop.decision.nextMove === "observe-receipt" ? loop.decision.verifyUrl : "/api/sports/decision/shadow-next-cycle-receipt",
      safeToRun: observeAllowed && safeCommand(loop.decision.command, loop.decision.verifyUrl),
      expectedEvidence: "A public receipt hash and status from the selected read-only proof route.",
      expectedStateChange: "Move from waiting-observation into observed-proof without changing public action.",
      utility: utility({ informationGain: 78, urgency: loop.status === "awaiting-observation" ? 70 : 8, safety: 92, allowed: observeAllowed }),
      blockedBy: observeAllowed ? [] : unique([loop.status !== "awaiting-observation" ? `loop:${loop.status}` : null, loop.decision.safeToRun ? null : loop.decision.reason]),
      rationale: "Receipt observation is the highest priority when no proof hash exists."
    }),
    candidate({
      id: "ask-next-question",
      status: askAllowed ? "ready" : loop.status === "thinking-shadow" ? "waiting" : "blocked",
      label: "Ask next read-only proof question",
      command: askAllowed ? loop.decision.command : null,
      verifyUrl: loop.decision.nextMove === "ask-next-question" ? loop.decision.verifyUrl : "/api/sports/decision/shadow-next-cycle-planner",
      safeToRun: askAllowed && safeCommand(loop.decision.command, loop.decision.verifyUrl),
      expectedEvidence: "A refreshed next-cycle planner response using observed shadow memory.",
      expectedStateChange: "Queue the next proof question while preserving zero probability, confidence, and public-action deltas.",
      utility: utility({ informationGain: 62, urgency: loop.status === "thinking-shadow" ? 44 : 6, safety: 88, allowed: askAllowed }),
      blockedBy: askAllowed ? [] : unique([loop.status !== "thinking-shadow" ? `loop:${loop.status}` : null, memory.policy.canUseForPlanning ? null : "working memory cannot guide planning"]),
      rationale: "The next proof question is allowed only after a receipt has been observed."
    }),
    candidate({
      id: "inspect-memory",
      status: memory.controls.canInspectReadOnly ? "ready" : "blocked",
      label: "Inspect shadow working memory",
      command: decisionCurlCommand(memoryUrl),
      verifyUrl: memoryUrl,
      safeToRun: memory.controls.canInspectReadOnly,
      expectedEvidence: "Current belief, doubt, unknown, safest next action, and lock cells remain visible.",
      expectedStateChange: "Refresh the operator view without observing a new proof or changing state.",
      utility: utility({ informationGain: 32, urgency: memory.status === "needs-repair" || memory.status === "blocked" ? 50 : 18, safety: 96, allowed: memory.controls.canInspectReadOnly }),
      blockedBy: [],
      rationale: "Memory inspection is the safest fallback when no proof turn should run."
    }),
    candidate({
      id: "repair-proof",
      status: loop.status === "repair-required" || loop.status === "halted" ? "ready" : "waiting",
      label: "Repair shadow proof route",
      command: null,
      verifyUrl: repairUrl,
      safeToRun: false,
      expectedEvidence: "A repaired proof route or a safer replacement selected by the planner.",
      expectedStateChange: "Clear blocked proof or memory cells before the loop continues.",
      utility: utility({ informationGain: 45, urgency: loop.status === "repair-required" || loop.status === "halted" ? 82 : 12, safety: 70, allowed: false }),
      blockedBy: unique([loop.status, loop.cycleBudget.stopReason, memory.attention.decisiveUnknown]),
      rationale: "Repair is manual-only because it may require changing provider, route, or evidence configuration."
    }),
    candidate({
      id: "hold",
      status: "ready",
      label: "Hold shadow loop",
      command: null,
      verifyUrl: "/api/sports/decision/shadow-reasoning-loop",
      safeToRun: false,
      expectedEvidence: "No new evidence is collected.",
      expectedStateChange: "The loop remains locked until an operator chooses a safe read-only path.",
      utility: utility({ informationGain: 4, urgency: loop.status === "halted" ? 60 : 6, safety: 100, allowed: false }),
      blockedBy: [],
      rationale: "Hold is selected when every runnable candidate is blocked or unsafe."
    })
  ];
}

function selectCandidate(candidates: DecisionShadowLoopGovernorCandidate[]): DecisionShadowLoopGovernorCandidate {
  const runnable = candidates.filter((item) => item.safeToRun && item.id !== "hold");
  if (!runnable.length) return candidates.find((item) => item.id === "hold") ?? candidates[0];
  return runnable.slice().sort((a, b) => b.utility.score - a.utility.score)[0];
}

function statusFrom(selected: DecisionShadowLoopGovernorCandidate, loop: DecisionShadowReasoningLoop): DecisionShadowLoopGovernorStatus {
  if (loop.status === "halted") return "blocked";
  if (loop.status === "repair-required" && selected.id !== "repair-proof") return "repair-required";
  if (selected.id === "observe-receipt") return "observe-receipt";
  if (selected.id === "ask-next-question") return "ask-next-question";
  if (selected.id === "inspect-memory") return "inspect-memory";
  if (selected.id === "repair-proof") return "repair-required";
  return "hold";
}

function beliefsFor({
  loop,
  memory,
  interpreter
}: {
  loop: DecisionShadowReasoningLoop;
  memory: DecisionShadowWorkingMemory;
  interpreter: DecisionShadowNextCycleInterpreter;
}): DecisionShadowLoopGovernorBelief[] {
  const locksSupported =
    !loop.controls.canPersistMemory &&
    !loop.controls.canPersistDecisions &&
    !loop.controls.canTrainModels &&
    !loop.controls.canAdjustProbabilities &&
    !loop.controls.canPublishPicks &&
    !loop.controls.canStake &&
    !interpreter.controls.canPersistMemory &&
    !memory.controls.canPersistMemory;

  return [
    {
      id: "proof-state",
      label: "Proof state controls the next turn",
      status: loop.focus.proofHash ? "supported" : loop.status === "awaiting-observation" ? "uncertain" : "blocked",
      confidence: loop.focus.proofHash ? 82 : loop.status === "awaiting-observation" ? 48 : 20,
      evidence: unique([loop.focus.proofHash, interpreter.input.receiptStatus, interpreter.input.receiptHash]),
      implication: loop.focus.proofHash ? "The governor may ask another proof question." : "The governor should observe one receipt before asking another question."
    },
    {
      id: "memory-state",
      label: "Working memory is bounded",
      status: memory.status === "blocked" ? "blocked" : memory.policy.canUseForPlanning ? "supported" : "uncertain",
      confidence: memory.policy.canUseForPlanning ? 76 : 34,
      evidence: [memory.memoryHash, memory.status, `cells:${memory.counts.cells}`],
      implication: "Memory can guide the next read-only question only; it cannot promote public action."
    },
    {
      id: "loop-budget",
      label: "Read-only cycle budget remains",
      status: loop.cycleBudget.remainingReadOnlyTurns > 0 ? "supported" : "blocked",
      confidence: loop.cycleBudget.remainingReadOnlyTurns > 0 ? 88 : 10,
      evidence: [`used:${loop.cycleBudget.usedReadOnlyTurns}`, `left:${loop.cycleBudget.remainingReadOnlyTurns}`, loop.cycleBudget.stopReason ?? "not-stopped"],
      implication: loop.cycleBudget.remainingReadOnlyTurns > 0 ? "One supervised read-only turn can still be proposed." : "The loop must stop until an operator resets the cycle."
    },
    {
      id: "safety-locks",
      label: "Public/model authority is locked",
      status: locksSupported ? "supported" : "blocked",
      confidence: locksSupported ? 96 : 0,
      evidence: [
        `persist:${loop.controls.canPersistMemory}`,
        `train:${loop.controls.canTrainModels}`,
        `adjust:${loop.controls.canAdjustProbabilities}`,
        `publish:${loop.controls.canPublishPicks}`,
        `stake:${loop.controls.canStake}`
      ],
      implication: "The governor can authorize at most one read-only local command."
    }
  ];
}

function boundary(selected: DecisionShadowLoopGovernorCandidate, beliefs: DecisionShadowLoopGovernorBelief[], loop: DecisionShadowReasoningLoop): string[] {
  return unique([
    `Selected ${selected.id}; max action is ${selected.safeToRun ? "one read-only command" : "hold/manual repair"}.`,
    "No selected intent may persist memory, write decisions, train models, adjust probabilities, publish picks, or stake.",
    loop.cycleBudget.stopReason ? `Stop: ${loop.cycleBudget.stopReason}` : null,
    ...beliefs.filter((item) => item.status !== "supported").map((item) => `${item.label}: ${item.implication}`),
    selected.blockedBy[0] ? `Primary blocker: ${selected.blockedBy[0]}` : null
  ]);
}

function summaryFor(status: DecisionShadowLoopGovernorStatus, selected: DecisionShadowLoopGovernorCandidate): string {
  if (status === "observe-receipt") return `Shadow loop governor selected receipt observation: ${selected.expectedEvidence}`;
  if (status === "ask-next-question") return `Shadow loop governor selected the next proof question: ${selected.expectedEvidence}`;
  if (status === "inspect-memory") return "Shadow loop governor selected memory inspection as the safest read-only step.";
  if (status === "repair-required") return "Shadow loop governor requires proof repair before another loop turn.";
  if (status === "blocked") return "Shadow loop governor is blocked; no supervised read-only command is safe.";
  return "Shadow loop governor is holding the loop.";
}

export function buildDecisionShadowLoopGovernor({
  loop,
  memory,
  interpreter,
  now = new Date()
}: {
  loop: DecisionShadowReasoningLoop;
  memory: DecisionShadowWorkingMemory;
  interpreter: DecisionShadowNextCycleInterpreter;
  now?: Date;
}): DecisionShadowLoopGovernor {
  const candidates = buildCandidates({ loop, memory, interpreter });
  const selectedIntent = selectCandidate(candidates);
  const status = statusFrom(selectedIntent, loop);
  const beliefs = beliefsFor({ loop, memory, interpreter });
  const decisionBoundary = boundary(selectedIntent, beliefs, loop);
  const governorHash = stableHash({
    date: loop.date,
    sport: loop.sport,
    loop: loop.loopHash,
    memory: memory.memoryHash,
    interpreter: interpreter.interpreterHash,
    selected: [selectedIntent.id, selectedIntent.safeToRun, selectedIntent.utility.score],
    beliefs: beliefs.map((item) => [item.id, item.status, item.confidence])
  });
  const memoryContent = compact(
    `${summaryFor(status, selectedIntent)} Boundary: ${decisionBoundary.join(" | ")}`
  );

  return {
    generatedAt: now.toISOString(),
    date: loop.date,
    sport: loop.sport,
    mode: "decision-shadow-loop-governor",
    status,
    governorHash,
    summary: summaryFor(status, selectedIntent),
    selectedIntent,
    candidates,
    beliefs,
    decisionBoundary,
    memoryDraft: {
      canPersist: false,
      label: "shadow_loop_governor",
      evidenceHash: governorHash,
      content: memoryContent
    },
    controls: {
      canRunSelectedCommand: selectedIntent.safeToRun,
      canRunReadOnly: selectedIntent.safeToRun,
      canInspectMemory: true,
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/shadow-loop-governor",
      "/api/sports/decision/shadow-reasoning-loop",
      selectedIntent.verifyUrl,
      ...loop.proofUrls,
      ...memory.proofUrls,
      ...interpreter.proofUrls
    ]),
    locks: unique([
      "Shadow loop governor can select one supervised read-only command at most.",
      "Governor intent cannot persist memory, write decisions, train models, adjust probabilities, raise confidence, publish picks, stake, or upgrade public action.",
      "Governor must stop when proof repair, halted loop state, or read-only budget exhaustion appears.",
      ...loop.locks,
      ...memory.locks,
      ...interpreter.locks
    ])
  };
}
