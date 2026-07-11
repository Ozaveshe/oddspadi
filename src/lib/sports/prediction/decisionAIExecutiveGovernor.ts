import type { DecisionAIExecutive } from "@/lib/sports/prediction/decisionAIExecutive";
import type { DecisionAIExecutiveCycle, DecisionAIExecutiveCycleCommand } from "@/lib/sports/prediction/decisionAIExecutiveCycle";
import type { DecisionAIExecutiveFeedback } from "@/lib/sports/prediction/decisionAIExecutiveFeedback";
import type { DecisionAIExecutiveRunbook } from "@/lib/sports/prediction/decisionAIExecutiveRunbook";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIExecutiveGovernorStatus =
  | "observe-proof"
  | "inspect-learning"
  | "review-readonly"
  | "refresh-state"
  | "hold"
  | "blocked";
export type DecisionAIExecutiveGovernorIntentId = "observe-proof" | "inspect-learning" | "ask-ai-review" | "inspect-executive" | "hold";
export type DecisionAIExecutiveGovernorBeliefStatus = "supported" | "uncertain" | "blocked";

export type DecisionAIExecutiveGovernorCandidate = {
  id: DecisionAIExecutiveGovernorIntentId;
  label: string;
  command: string | null;
  verifyUrl: string | null;
  allowed: boolean;
  safeToRun: boolean;
  expectedEvidence: string;
  expectedStateChange: string;
  utility: {
    informationGain: number;
    urgency: number;
    risk: number;
    lockPenalty: number;
    score: number;
  };
  blockedBy: string[];
  rationale: string;
};

export type DecisionAIExecutiveGovernorBelief = {
  id: string;
  label: string;
  status: DecisionAIExecutiveGovernorBeliefStatus;
  confidence: number;
  evidence: string[];
  implication: string;
};

export type DecisionAIExecutiveGovernor = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-executive-governor";
  status: DecisionAIExecutiveGovernorStatus;
  governorHash: string;
  summary: string;
  selectedIntent: DecisionAIExecutiveGovernorCandidate;
  candidates: DecisionAIExecutiveGovernorCandidate[];
  beliefs: DecisionAIExecutiveGovernorBelief[];
  doubts: string[];
  decisionBoundary: string[];
  nextObservation: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    expectedEvidence: string;
  };
  autonomy: {
    mode: "supervised-readonly" | "manual-hold";
    reason: string;
    maxCommandsThisTurn: 1;
    requiresOperator: true;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string;
    content: string;
  };
  controls: {
    canRunSelectedCommand: boolean;
    canRunReadOnly: boolean;
    canAskAIReview: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 300): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function clampScore(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

function score({
  informationGain,
  urgency,
  risk,
  lockPenalty,
  allowed
}: {
  informationGain: number;
  urgency: number;
  risk: number;
  lockPenalty: number;
  allowed: boolean;
}): DecisionAIExecutiveGovernorCandidate["utility"] {
  const raw = allowed ? informationGain + urgency - risk - lockPenalty : -80 - risk - lockPenalty;
  return {
    informationGain,
    urgency,
    risk,
    lockPenalty,
    score: clampScore(raw)
  };
}

function commandById(cycle: DecisionAIExecutiveCycle, id: DecisionAIExecutiveCycleCommand["id"]): DecisionAIExecutiveCycleCommand | null {
  return cycle.commandQueue.find((item) => item.id === id) ?? null;
}

function isSafeLocalReadOnly(command: string | null, verifyUrl: string | null): boolean {
  if (!command || !verifyUrl) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (!lower.includes("/api/sports/decision/")) return false;
  if (!verifyUrl.startsWith("/api/sports/decision/")) return false;
  return ![" -x post", "-xpost", "persist=1", "publish=1", "train=1", "dryrun=0", "apply_migration", "supabase db push"].some((fragment) =>
    lower.includes(fragment)
  );
}

function lockPenalty(runbook: DecisionAIExecutiveRunbook, extra = 0): number {
  const blocks = runbook.gates.filter((item) => item.status === "block").length;
  const watches = runbook.gates.filter((item) => item.status === "watch").length;
  return blocks * 5 + watches * 2 + extra;
}

function candidate(input: Omit<DecisionAIExecutiveGovernorCandidate, "rationale"> & { rationale?: string }): DecisionAIExecutiveGovernorCandidate {
  return {
    ...input,
    rationale:
      input.rationale ??
      (input.allowed
        ? `${input.label} has score ${input.utility.score} because information gain ${input.utility.informationGain} and urgency ${input.utility.urgency} outweigh risk ${input.utility.risk}.`
        : `${input.label} is blocked by ${input.blockedBy[0] ?? "missing proof"}.`)
  };
}

function buildCandidates({
  executive,
  feedback,
  cycle,
  runbook
}: {
  executive: DecisionAIExecutive;
  feedback: DecisionAIExecutiveFeedback;
  cycle: DecisionAIExecutiveCycle;
  runbook: DecisionAIExecutiveRunbook;
}): DecisionAIExecutiveGovernorCandidate[] {
  const nextCommand = commandById(cycle, "next-feedback-turn");
  const learningCommand = commandById(cycle, "inspect-learning");
  const inspectCommand = commandById(cycle, "inspect-executive");
  const observeAllowed =
    Boolean(nextCommand?.command?.includes("observe=1")) &&
    runbook.controls.canObserveProof &&
    isSafeLocalReadOnly(nextCommand?.command ?? null, nextCommand?.verifyUrl ?? null);
  const learningAllowed =
    Boolean(learningCommand) &&
    (cycle.status === "learning-queued" || feedback.statePatch.action === "queue-learning" || runbook.status === "learning-locked") &&
    isSafeLocalReadOnly(learningCommand?.command ?? null, learningCommand?.verifyUrl ?? null);
  const reviewAllowed =
    Boolean(nextCommand?.command?.includes("run=1")) &&
    executive.controls.canAskOpenAI &&
    feedback.controls.canAskAIReview &&
    runbook.status !== "blocked" &&
    isSafeLocalReadOnly(nextCommand?.command ?? null, nextCommand?.verifyUrl ?? null);
  const inspectAllowed = Boolean(inspectCommand && isSafeLocalReadOnly(inspectCommand.command, inspectCommand.verifyUrl));
  const penalty = lockPenalty(runbook);

  return [
    candidate({
      id: "observe-proof",
      label: "Observe selected proof",
      command: nextCommand?.command?.includes("observe=1") ? nextCommand.command : null,
      verifyUrl: nextCommand?.command?.includes("observe=1") ? nextCommand.verifyUrl : null,
      allowed: observeAllowed,
      safeToRun: observeAllowed,
      expectedEvidence: "Executive proof receipt changes to observed with a response hash.",
      expectedStateChange: "Feedback can reduce from ready-to-observe to a proof-backed state.",
      utility: score({
        informationGain: executive.proofReceipt.status === "observed" ? 5 : 46,
        urgency: cycle.status === "awaiting-proof" ? 34 : 12,
        risk: 6,
        lockPenalty: observeAllowed ? Math.max(0, penalty - 4) : penalty,
        allowed: observeAllowed
      }),
      blockedBy: observeAllowed ? [] : unique([nextCommand ? null : "no feedback command", runbook.controls.canObserveProof ? null : "runbook cannot observe proof"]),
      rationale: "The governor wants proof first because it can change the executive receipt without writes or public-action upgrades."
    }),
    candidate({
      id: "inspect-learning",
      label: "Inspect learning queue",
      command: learningCommand?.command ?? null,
      verifyUrl: learningCommand?.verifyUrl ?? null,
      allowed: learningAllowed,
      safeToRun: learningAllowed,
      expectedEvidence: feedback.learningPlan.expectedLearningSignal,
      expectedStateChange: "Learning blockers become explicit while training and memory writes remain locked.",
      utility: score({
        informationGain: cycle.status === "learning-queued" ? 40 : 24,
        urgency: feedback.learningPlan.blockedBy.length ? 24 : 12,
        risk: 4,
        lockPenalty: learningAllowed ? Math.max(0, penalty - 2) : penalty,
        allowed: learningAllowed
      }),
      blockedBy: learningAllowed ? [] : unique([learningCommand ? null : "no learning command", cycle.status === "learning-queued" ? null : "cycle is not in learning stage"]),
      rationale: "Learning inspection is useful only after proof has been reduced or the feedback loop is already queued behind learning gates."
    }),
    candidate({
      id: "ask-ai-review",
      label: "Run guarded AI review",
      command: nextCommand?.command?.includes("run=1") ? nextCommand.command : null,
      verifyUrl: nextCommand?.command?.includes("run=1") ? nextCommand.verifyUrl : null,
      allowed: reviewAllowed,
      safeToRun: reviewAllowed,
      expectedEvidence: "Executive AI review returns a same-or-safer verdict with never permissions.",
      expectedStateChange: "The public action can stay the same or become safer; it cannot upgrade.",
      utility: score({
        informationGain: 32,
        urgency: executive.latestRun.status === "not-requested" ? 16 : 8,
        risk: 14,
        lockPenalty: reviewAllowed ? penalty : penalty + 8,
        allowed: reviewAllowed
      }),
      blockedBy: reviewAllowed
        ? []
        : unique([
            executive.controls.canAskOpenAI ? null : "OpenAI review is not enabled for this executive state",
            feedback.controls.canAskAIReview ? null : "feedback cannot ask AI review",
            nextCommand?.command?.includes("run=1") ? null : "no guarded review command selected"
          ]),
      rationale: "AI review is useful only after the proof path is safe; it remains same-or-safer and never grants persistence or publishing."
    }),
    candidate({
      id: "inspect-executive",
      label: "Refresh executive state",
      command: inspectCommand?.command ?? null,
      verifyUrl: inspectCommand?.verifyUrl ?? null,
      allowed: inspectAllowed,
      safeToRun: inspectAllowed,
      expectedEvidence: "Executive, policy, feedback, cycle, runbook, and governor hashes refresh without writes.",
      expectedStateChange: "The agent can detect whether stale state, proof, or locks changed since the last turn.",
      utility: score({
        informationGain: 18,
        urgency: runbook.status === "repair-required" || cycle.status === "halted" ? 22 : 8,
        risk: 3,
        lockPenalty: inspectAllowed ? Math.max(0, penalty - 3) : penalty,
        allowed: inspectAllowed
      }),
      blockedBy: inspectAllowed ? [] : ["no safe executive refresh command"],
      rationale: "Refreshing the executive is a low-risk fallback when the higher-value proof or learning commands are not the right next move."
    }),
    candidate({
      id: "hold",
      label: "Hold position",
      command: null,
      verifyUrl: "/api/sports/decision/ai-executive",
      allowed: true,
      safeToRun: false,
      expectedEvidence: "No command is run; the operator keeps the current conservative state.",
      expectedStateChange: "No state changes; the executive remains conservative until proof improves.",
      utility: score({
        informationGain: 0,
        urgency: runbook.status === "blocked" ? 18 : 2,
        risk: 0,
        lockPenalty: Math.max(0, penalty - 4),
        allowed: true
      }),
      blockedBy: [],
      rationale: "Holding is selected only when every useful command is less safe than staying conservative."
    })
  ];
}

function selectCandidate(candidates: DecisionAIExecutiveGovernorCandidate[]): DecisionAIExecutiveGovernorCandidate {
  const runnable = candidates.filter((item) => item.allowed && item.id !== "hold");
  if (!runnable.length) return candidates.find((item) => item.id === "hold") ?? candidates[0];
  return [...runnable].sort((a, b) => b.utility.score - a.utility.score || b.utility.informationGain - a.utility.informationGain)[0];
}

function statusFrom(selected: DecisionAIExecutiveGovernorCandidate, runbook: DecisionAIExecutiveRunbook): DecisionAIExecutiveGovernorStatus {
  if (runbook.status === "blocked" && selected.id === "hold") return "blocked";
  if (selected.id === "observe-proof") return "observe-proof";
  if (selected.id === "inspect-learning") return "inspect-learning";
  if (selected.id === "ask-ai-review") return "review-readonly";
  if (selected.id === "inspect-executive") return "refresh-state";
  return runbook.status === "blocked" ? "blocked" : "hold";
}

function buildBeliefs({
  executive,
  feedback,
  cycle,
  runbook
}: {
  executive: DecisionAIExecutive;
  feedback: DecisionAIExecutiveFeedback;
  cycle: DecisionAIExecutiveCycle;
  runbook: DecisionAIExecutiveRunbook;
}): DecisionAIExecutiveGovernorBelief[] {
  const writesLocked =
    !executive.controls.canPersist &&
    !executive.controls.canPublish &&
    !executive.controls.canTrain &&
    !feedback.controls.canPersist &&
    !feedback.controls.canPublish &&
    !feedback.controls.canTrain &&
    !cycle.controls.canPersist &&
    !cycle.controls.canPublish &&
    !cycle.controls.canTrain &&
    !runbook.controls.canPersist &&
    !runbook.controls.canPublish &&
    !runbook.controls.canTrain;

  return [
    {
      id: "public-action",
      label: "Public action is same-or-safer",
      status: executive.activeDecision.canShowAsPick ? "blocked" : "supported",
      confidence: executive.policy.confidenceBudget.score,
      evidence: [executive.activeDecision.executiveAction, executive.activeDecision.publicStance, executive.policy.policyHash],
      implication: "The governor may explain or inspect, but it cannot upgrade the public action."
    },
    {
      id: "proof-state",
      label: "Proof receipt controls the next turn",
      status: executive.proofReceipt.status === "observed" ? "supported" : executive.proofReceipt.status === "failed" ? "blocked" : "uncertain",
      confidence: executive.proofReceipt.status === "observed" ? 78 : executive.proofReceipt.target.allowed ? 46 : 20,
      evidence: unique([executive.proofReceipt.status, executive.proofReceipt.receiptHash, executive.proofReceipt.observation.responseHash]),
      implication:
        executive.proofReceipt.status === "observed"
          ? "The agent can move from proof observation into learning inspection."
          : "The agent should observe the selected proof before reducing trust or learning state."
    },
    {
      id: "learning-state",
      label: "Learning remains queue-only",
      status: feedback.input.learningStatus === "blocked" || feedback.learningPlan.blockedBy.length ? "blocked" : "uncertain",
      confidence: feedback.input.learningStatus === "blocked" ? 72 : 48,
      evidence: unique([feedback.input.learningStatus, feedback.learningPlan.nextTaskId, ...feedback.learningPlan.blockedBy.slice(0, 3)]),
      implication: "Historical learning cannot affect live guardrails until persistence, outcomes, calibration, backtests, and corpus proof pass."
    },
    {
      id: "safety-state",
      label: "Write controls are locked",
      status: writesLocked ? "supported" : "blocked",
      confidence: writesLocked ? 95 : 5,
      evidence: [`persist:${runbook.controls.canPersist}`, `publish:${runbook.controls.canPublish}`, `train:${runbook.controls.canTrain}`],
      implication: "The governor can authorize one supervised read-only command at most."
    }
  ];
}

function decisionBoundary({
  selected,
  feedback,
  runbook
}: {
  selected: DecisionAIExecutiveGovernorCandidate;
  feedback: DecisionAIExecutiveFeedback;
  runbook: DecisionAIExecutiveRunbook;
}): string[] {
  return unique([
    selected.id === "observe-proof" ? "If observe=1 returns an observed proof receipt with a response hash, the next intent should shift to learning inspection or guarded review." : null,
    selected.id === "inspect-learning" ? "If the learning queue reports ready with no blockers, the next turn may prepare storage proof, but still cannot train from this governor." : null,
    selected.id === "ask-ai-review" ? "If AI review returns downgrade, repair, or block, the governor must keep the safer action and route to repair." : null,
    selected.id === "inspect-executive" ? "If refreshed executive state still reports the same blockers, proof observation or learning inspection remains the only safe progress." : null,
    "If any response enables persistence, publishing, training, trust raise, or public-action upgrade, stop and treat the turn as unsafe.",
    feedback.learningPlan.blockedBy[0] ?? runbook.abortConditions[0] ?? "If proof contradicts the executive policy, select repair before any new observation."
  ]);
}

function summaryFor(status: DecisionAIExecutiveGovernorStatus, selected: DecisionAIExecutiveGovernorCandidate): string {
  if (status === "observe-proof") return `Governor selected proof observation because ${selected.expectedEvidence}`;
  if (status === "inspect-learning") return `Governor selected learning inspection because ${selected.expectedEvidence}`;
  if (status === "review-readonly") return "Governor selected guarded AI review with same-or-safer output permissions.";
  if (status === "refresh-state") return "Governor selected executive refresh to avoid acting on stale state.";
  if (status === "blocked") return "Governor is blocked; no useful supervised read-only command outranks holding.";
  return "Governor is holding the conservative state until a safer command is available.";
}

export function buildDecisionAIExecutiveGovernor({
  executive,
  feedback,
  cycle,
  runbook,
  now = new Date()
}: {
  executive: DecisionAIExecutive;
  feedback: DecisionAIExecutiveFeedback;
  cycle: DecisionAIExecutiveCycle;
  runbook: DecisionAIExecutiveRunbook;
  now?: Date;
}): DecisionAIExecutiveGovernor {
  const candidates = buildCandidates({ executive, feedback, cycle, runbook });
  const selectedIntent = selectCandidate(candidates);
  const status = statusFrom(selectedIntent, runbook);
  const beliefs = buildBeliefs({ executive, feedback, cycle, runbook });
  const doubts = unique(
    [
      ...beliefs.filter((item) => item.status !== "supported").map((item) => `${item.label}: ${item.implication}`),
      ...runbook.gates.filter((item) => item.status !== "pass").map((item) => `${item.label}: ${item.nextAction}`),
      ...feedback.learningPlan.questions.slice(0, 3)
    ],
    12
  );
  const boundary = decisionBoundary({ selected: selectedIntent, feedback, runbook });
  const governorHash = stableHash({
    executive: executive.executiveHash,
    feedback: feedback.feedbackHash,
    cycle: cycle.cycleHash,
    runbook: runbook.runbookHash,
    selected: [selectedIntent.id, selectedIntent.utility.score, selectedIntent.allowed],
    beliefs: beliefs.map((item) => [item.id, item.status, item.confidence]),
    doubts,
    status
  });
  const memoryContent = compact(
    `${summaryFor(status, selectedIntent)} Selected ${selectedIntent.id} score ${selectedIntent.utility.score}; beliefs ${beliefs
      .map((item) => `${item.id}:${item.status}`)
      .join(", ")}; doubts ${doubts.slice(0, 3).join("; ") || "none"}.`,
    420
  );

  return {
    generatedAt: now.toISOString(),
    date: executive.date,
    sport: executive.sport,
    mode: "ai-executive-governor",
    status,
    governorHash,
    summary: summaryFor(status, selectedIntent),
    selectedIntent,
    candidates,
    beliefs,
    doubts,
    decisionBoundary: boundary,
    nextObservation: {
      label: selectedIntent.label,
      command: selectedIntent.command,
      verifyUrl: selectedIntent.verifyUrl,
      expectedEvidence: selectedIntent.expectedEvidence
    },
    autonomy: {
      mode: selectedIntent.safeToRun ? "supervised-readonly" : "manual-hold",
      reason: selectedIntent.rationale,
      maxCommandsThisTurn: 1,
      requiresOperator: true
    },
    memoryDraft: {
      canPersist: false,
      label: `${executive.activeDecision.match ?? "Active executive decision"} executive governor`,
      evidenceHash: governorHash,
      content: memoryContent
    },
    controls: {
      canRunSelectedCommand: selectedIntent.safeToRun,
      canRunReadOnly: selectedIntent.safeToRun,
      canAskAIReview: selectedIntent.id === "ask-ai-review" && selectedIntent.safeToRun,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    locks: unique(
      [
        "The governor can choose one supervised local read-only command per turn.",
        "The governor cannot persist, publish, train, raise trust, or upgrade public action.",
        "The governor must stop when any runbook abort condition appears.",
        ...runbook.locks
      ],
      30
    ),
    proofUrls: unique(
      [
        "/api/sports/decision/ai-executive",
        selectedIntent.verifyUrl,
        ...runbook.proofUrls,
        ...cycle.proofUrls,
        ...feedback.proofUrls,
        ...executive.proofUrls
      ],
      40
    )
  };
}
