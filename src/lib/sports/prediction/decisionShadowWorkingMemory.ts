import type { DecisionShadowNextCycleInterpreter } from "@/lib/sports/prediction/decisionShadowNextCycleInterpreter";
import type { DecisionShadowNextCyclePlanner } from "@/lib/sports/prediction/decisionShadowNextCyclePlanner";

export type DecisionShadowWorkingMemoryStatus = "ready-shadow" | "waiting-observation" | "needs-repair" | "blocked";
export type DecisionShadowWorkingMemoryCellKind = "belief" | "doubt" | "proof" | "risk" | "next-action" | "learning" | "guardrail";
export type DecisionShadowWorkingMemoryCellStatus = "known" | "open" | "observed" | "queued" | "locked" | "blocked";

export type DecisionShadowWorkingMemoryCell = {
  id: string;
  kind: DecisionShadowWorkingMemoryCellKind;
  status: DecisionShadowWorkingMemoryCellStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  source: string;
  detail: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionShadowWorkingMemory = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowNextCyclePlanner["sport"];
  mode: "decision-shadow-working-memory";
  status: DecisionShadowWorkingMemoryStatus;
  memoryHash: string;
  summary: string;
  focus: {
    selectedStepId: string | null;
    selectedStepLabel: string | null;
    proofHash: string | null;
    interpreterHash: string;
  };
  attention: {
    currentBelief: string;
    primaryDoubt: string;
    decisiveUnknown: string;
    safestNextAction: string;
  };
  counts: {
    cells: number;
    beliefs: number;
    doubts: number;
    proofs: number;
    risks: number;
    nextActions: number;
    learning: number;
    guardrails: number;
    blocked: number;
  };
  cells: DecisionShadowWorkingMemoryCell[];
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string | null;
    content: string;
  };
  policy: {
    rule: string;
    verificationUrl: string;
    canUseForPlanning: boolean;
    canPersist: false;
    canTrain: false;
    canPublish: false;
    canStake: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canUseHiddenChainOfThought: false;
  };
  controls: {
    canInspectReadOnly: true;
    canPlanNextReadOnlyStep: boolean;
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function cell(input: DecisionShadowWorkingMemoryCell): DecisionShadowWorkingMemoryCell {
  return {
    ...input,
    detail: compact(input.detail),
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction)
  };
}

function statusFromInterpreter(interpreter: DecisionShadowNextCycleInterpreter): DecisionShadowWorkingMemoryStatus {
  if (interpreter.status === "observed-proof") return "ready-shadow";
  if (interpreter.status === "waiting-observation") return "waiting-observation";
  if (interpreter.status === "needs-repair") return "needs-repair";
  return "blocked";
}

function cellsFromInterpreter(interpreter: DecisionShadowNextCycleInterpreter): DecisionShadowWorkingMemoryCell[] {
  const traceCells = interpreter.publicTrace.map((trace): DecisionShadowWorkingMemoryCell => {
    const kind: DecisionShadowWorkingMemoryCellKind =
      trace.id === "select"
        ? "belief"
        : trace.id === "observe"
          ? "proof"
          : trace.id === "interpret"
            ? "doubt"
            : trace.id === "guard"
              ? "guardrail"
              : trace.id === "learn"
                ? "learning"
                : "next-action";
    return cell({
      id: `trace-${trace.id}`,
      kind,
      status: trace.status === "pass" ? (kind === "proof" ? "observed" : "known") : trace.status === "watch" ? "open" : "blocked",
      priority: trace.status === "block" ? "critical" : trace.status === "watch" ? "high" : "medium",
      label: trace.label,
      source: "shadow-next-cycle-interpreter",
      detail: trace.publicReason,
      evidence: trace.evidence,
      nextAction: trace.nextAction
    });
  });

  return [
    cell({
      id: "current-belief",
      kind: "belief",
      status: interpreter.status === "observed-proof" ? "known" : "open",
      priority: "high",
      label: "Current shadow belief",
      source: "interpreter.interpretation.learned",
      detail: interpreter.interpretation.learned,
      evidence: unique([interpreter.interpreterHash, interpreter.input.proofHash]),
      nextAction: interpreter.interpretation.nextAction
    }),
    cell({
      id: "primary-doubt",
      kind: "doubt",
      status: interpreter.status === "observed-proof" ? "open" : interpreter.status === "waiting-observation" ? "open" : "blocked",
      priority: interpreter.status === "observed-proof" ? "medium" : "high",
      label: "Primary doubt",
      source: "interpreter.interpretation.risk",
      detail: interpreter.interpretation.risk,
      evidence: unique([interpreter.input.receiptStatus, interpreter.input.proofHash]),
      nextAction: interpreter.nextTurn.label
    }),
    cell({
      id: "safest-next-action",
      kind: "next-action",
      status: interpreter.nextTurn.safeToRun ? "queued" : "blocked",
      priority: interpreter.nextTurn.safeToRun ? "high" : "critical",
      label: interpreter.nextTurn.label,
      source: "interpreter.nextTurn",
      detail: interpreter.nextTurn.command ?? interpreter.nextTurn.verifyUrl,
      evidence: [interpreter.nextTurn.verifyUrl, String(interpreter.nextTurn.safeToRun)],
      nextAction: interpreter.nextTurn.safeToRun ? "Run only this read-only command or inspect the linked route." : "Repair the blocked proof route before continuing."
    }),
    cell({
      id: "public-action-lock",
      kind: "guardrail",
      status: "locked",
      priority: "critical",
      label: "Public action lock",
      source: "interpreter.controls",
      detail: "Shadow memory cannot change picks, probabilities, confidence, training, staking, or persistence.",
      evidence: [
        `probability:${interpreter.interpretation.probabilityEffect}`,
        `publicAction:${interpreter.interpretation.publicActionEffect}`,
        `persist:${interpreter.controls.canPersistMemory}`,
        `train:${interpreter.controls.canTrainModels}`,
        `stake:${interpreter.controls.canStake}`
      ],
      nextAction: "Keep all public action and model-authority controls locked."
    }),
    ...traceCells
  ];
}

function counts(cells: DecisionShadowWorkingMemoryCell[]): DecisionShadowWorkingMemory["counts"] {
  return {
    cells: cells.length,
    beliefs: cells.filter((item) => item.kind === "belief").length,
    doubts: cells.filter((item) => item.kind === "doubt").length,
    proofs: cells.filter((item) => item.kind === "proof").length,
    risks: cells.filter((item) => item.kind === "risk").length,
    nextActions: cells.filter((item) => item.kind === "next-action").length,
    learning: cells.filter((item) => item.kind === "learning").length,
    guardrails: cells.filter((item) => item.kind === "guardrail").length,
    blocked: cells.filter((item) => item.status === "blocked").length
  };
}

function summaryFor(status: DecisionShadowWorkingMemoryStatus, count: DecisionShadowWorkingMemory["counts"], nextAction: string): string {
  if (status === "ready-shadow") return `Shadow working memory is ready for read-only planning with ${count.cells} cell(s); next: ${nextAction}`;
  if (status === "waiting-observation") return `Shadow working memory is waiting for proof observation; next: ${nextAction}`;
  if (status === "needs-repair") return `Shadow working memory needs repair across ${count.blocked} blocked cell(s); next: ${nextAction}`;
  return `Shadow working memory is blocked across ${count.blocked} cell(s); no autonomous action is allowed.`;
}

export function buildDecisionShadowWorkingMemory({
  interpreter,
  now = new Date()
}: {
  interpreter: DecisionShadowNextCycleInterpreter;
  now?: Date;
}): DecisionShadowWorkingMemory {
  const status = statusFromInterpreter(interpreter);
  const cells = cellsFromInterpreter(interpreter);
  const cellCounts = counts(cells);
  const currentBelief = cells.find((item) => item.id === "current-belief")?.detail ?? "No current shadow belief.";
  const primaryDoubt = cells.find((item) => item.id === "primary-doubt")?.detail ?? "No primary doubt is loaded.";
  const decisiveUnknown =
    cells.find((item) => item.status === "blocked")?.detail ??
    cells.find((item) => item.kind === "doubt" && item.status === "open")?.detail ??
    "No decisive unknown is currently open.";
  const safestNextAction = cells.find((item) => item.id === "safest-next-action")?.detail ?? interpreter.nextTurn.verifyUrl;
  const memoryHash = stableHash({
    date: interpreter.date,
    sport: interpreter.sport,
    interpreter: interpreter.interpreterHash,
    status,
    cells: cells.map((item) => [item.id, item.kind, item.status, item.evidence])
  });
  const memoryContent = compact(
    [
      `status:${status}`,
      `belief:${currentBelief}`,
      `doubt:${primaryDoubt}`,
      `unknown:${decisiveUnknown}`,
      `next:${safestNextAction}`,
      `proof:${interpreter.input.proofHash ?? "pending"}`
    ].join(" | "),
    460
  );

  return {
    generatedAt: now.toISOString(),
    date: interpreter.date,
    sport: interpreter.sport,
    mode: "decision-shadow-working-memory",
    status,
    memoryHash,
    summary: summaryFor(status, cellCounts, interpreter.nextTurn.label),
    focus: {
      selectedStepId: interpreter.input.selectedStepId,
      selectedStepLabel: interpreter.nextTurn.label,
      proofHash: interpreter.input.proofHash,
      interpreterHash: interpreter.interpreterHash
    },
    attention: {
      currentBelief,
      primaryDoubt,
      decisiveUnknown,
      safestNextAction
    },
    counts: cellCounts,
    cells,
    memoryDraft: {
      canPersist: false,
      label: "shadow_working_memory",
      evidenceHash: interpreter.input.proofHash,
      content: memoryContent
    },
    policy: {
      rule: "Shadow working memory is inspect-only; it may guide the next read-only proof question but cannot promote public action, probability, confidence, training, staking, or persistence.",
      verificationUrl: `/api/sports/decision/shadow-working-memory?date=${encodeURIComponent(interpreter.date)}&sport=${encodeURIComponent(interpreter.sport)}`,
      canUseForPlanning: status === "ready-shadow" || status === "waiting-observation",
      canPersist: false,
      canTrain: false,
      canPublish: false,
      canStake: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canUseHiddenChainOfThought: false
    },
    controls: {
      canInspectReadOnly: true,
      canPlanNextReadOnlyStep: interpreter.controls.canPlanNextReadOnlyStep || interpreter.controls.canRunReceiptObservation,
      canPersistMemory: false,
      canPersistDecisions: false,
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
      "/api/sports/decision/shadow-working-memory",
      "/api/sports/decision/shadow-next-cycle-interpreter",
      ...interpreter.proofUrls
    ]),
    locks: unique([
      "Shadow working memory is a public inspect-only blackboard.",
      "It cannot persist memory, write decisions, train models, adjust probabilities, raise confidence, publish picks, stake, or expose hidden chain-of-thought.",
      ...interpreter.locks
    ])
  };
}
