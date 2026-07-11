import type { DecisionAIExecutive } from "@/lib/sports/prediction/decisionAIExecutive";
import type { DecisionAIExecutiveCycle, DecisionAIExecutiveCycleCommand } from "@/lib/sports/prediction/decisionAIExecutiveCycle";
import type { DecisionAIExecutiveFeedback } from "@/lib/sports/prediction/decisionAIExecutiveFeedback";
import type { DecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIExecutiveRunbookStatus = "ready-readonly" | "needs-proof" | "learning-locked" | "repair-required" | "blocked";
export type DecisionAIExecutiveRunbookGateStatus = "pass" | "watch" | "block";
export type DecisionAIExecutiveRunbookStepId = "preflight" | "execute" | "verify" | "reduce" | "learn" | "halt";

export type DecisionAIExecutiveRunbookGate = {
  id: string;
  label: string;
  status: DecisionAIExecutiveRunbookGateStatus;
  detail: string;
  nextAction: string;
  evidence: string[];
};

export type DecisionAIExecutiveRunbookStep = {
  id: DecisionAIExecutiveRunbookStepId;
  label: string;
  status: DecisionAIExecutiveRunbookGateStatus;
  instruction: string;
  expectedEvidence: string;
};

export type DecisionAIExecutiveRunbook = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-executive-runbook";
  status: DecisionAIExecutiveRunbookStatus;
  runbookHash: string;
  summary: string;
  input: {
    executiveHash: string;
    policyHash: string;
    feedbackHash: string;
    cycleHash: string;
    providerIngestionStatus: DecisionProviderIngestionEvidence["status"] | "not-attached";
    supabaseIsolationStatus: DecisionSupabaseProjectIsolation["status"];
  };
  activeInstruction: {
    commandId: string | null;
    label: string;
    command: string | null;
    verifyUrl: string | null;
    runMode: "local-readonly-get" | "manual-hold";
    safeToRun: boolean;
    reason: string;
    expectedEvidence: string;
  };
  gates: DecisionAIExecutiveRunbookGate[];
  orderedSteps: DecisionAIExecutiveRunbookStep[];
  abortConditions: string[];
  successCriteria: string[];
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string;
    content: string;
  };
  controls: {
    canRunActiveCommand: boolean;
    canRunReadOnly: boolean;
    canAskAIReview: boolean;
    canObserveProof: boolean;
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

function isSafeLocalGetCommand(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  const expectedOrigin = decisionSiteOrigin().toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (!lower.includes(`${expectedOrigin}/api/sports/decision/`)) {
    return false;
  }
  return ![
    " -x post",
    "-xpost",
    "persist=1",
    "publish=1",
    "train=1",
    "dryrun=0",
    "apply_migration",
    "supabase db push",
    "service_role",
    "service-role",
    "authorization:"
  ].some((fragment) => lower.includes(fragment));
}

function isSafeVerifyUrl(verifyUrl: string | null): boolean {
  return Boolean(verifyUrl && verifyUrl.startsWith("/api/sports/decision/"));
}

function selectActiveCommand({
  cycle,
  feedback
}: {
  cycle: DecisionAIExecutiveCycle;
  feedback: DecisionAIExecutiveFeedback;
}): DecisionAIExecutiveCycleCommand | null {
  if (cycle.status === "learning-queued" || feedback.statePatch.action === "queue-learning") {
    return cycle.commandQueue.find((item) => item.id === "inspect-learning" && item.safeToRun) ?? cycle.commandQueue.find((item) => item.safeToRun) ?? null;
  }

  if (cycle.status === "repair-required") {
    return cycle.commandQueue.find((item) => item.id === "inspect-executive" && item.safeToRun) ?? cycle.commandQueue.find((item) => item.safeToRun) ?? null;
  }

  return cycle.commandQueue.find((item) => item.safeToRun) ?? cycle.commandQueue[0] ?? null;
}

function providerGate(providerIngestionEvidence?: DecisionProviderIngestionEvidence | null): DecisionAIExecutiveRunbookGate {
  if (!providerIngestionEvidence) {
    return {
      id: "provider-ingestion",
      label: "Provider ingestion evidence",
      status: "watch",
      detail: "Provider ingestion evidence is not attached to this runbook.",
      nextAction: "Inspect provider ingestion evidence before provider dry-runs or training work.",
      evidence: ["not-attached"]
    };
  }

  return {
    id: "provider-ingestion",
    label: "Provider ingestion evidence",
    status: providerIngestionEvidence.status === "ready-dry-run" ? "pass" : providerIngestionEvidence.status === "blocked" ? "block" : "watch",
    detail: providerIngestionEvidence.summary,
    nextAction:
      providerIngestionEvidence.nextCommand?.expectedEvidence ??
      providerIngestionEvidence.nextProviderSignal?.expectedEvidence ??
      "Keep provider ingestion read-only until dry-run evidence is available.",
    evidence: unique([providerIngestionEvidence.evidenceHash, providerIngestionEvidence.status, providerIngestionEvidence.nextCommand?.id])
  };
}

function supabaseGate(supabaseIsolation: DecisionSupabaseProjectIsolation): DecisionAIExecutiveRunbookGate {
  const blocked = supabaseIsolation.status.startsWith("blocked");
  return {
    id: "supabase-isolation",
    label: "OddsPadi Supabase isolation",
    status: supabaseIsolation.status === "ready-isolated" ? "pass" : blocked ? "block" : "watch",
    detail: supabaseIsolation.summary,
    nextAction: supabaseIsolation.nextAction,
    evidence: unique([supabaseIsolation.isolationHash, supabaseIsolation.status, supabaseIsolation.detected.repoMcpConfig.projectRef])
  };
}

function buildGates({
  executive,
  feedback,
  cycle,
  activeCommand,
  activeCommandSafe,
  providerIngestionEvidence,
  supabaseIsolation
}: {
  executive: DecisionAIExecutive;
  feedback: DecisionAIExecutiveFeedback;
  cycle: DecisionAIExecutiveCycle;
  activeCommand: DecisionAIExecutiveCycleCommand | null;
  activeCommandSafe: boolean;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
}): DecisionAIExecutiveRunbookGate[] {
  return [
    {
      id: "selected-command",
      label: "Selected command",
      status: activeCommandSafe ? "pass" : "block",
      detail: activeCommand?.command ? compact(activeCommand.command, 240) : "No local read-only GET command is selected.",
      nextAction: activeCommandSafe ? activeCommand?.reason ?? "Run the selected local proof command." : "Hold until a local read-only command and verification URL are selected.",
      evidence: unique([activeCommand?.id, activeCommand?.safeToRun ? "safe:true" : "safe:false", activeCommand?.verifyUrl])
    },
    {
      id: "policy",
      label: "Executive policy",
      status:
        executive.policy.status === "approved-readonly" || executive.policy.status === "watch-proof"
          ? "pass"
          : executive.policy.status === "repair-first"
            ? "watch"
            : "block",
      detail: executive.policy.decisionRule,
      nextAction: executive.policy.requiredProof[0] ?? executive.finalDirective.reason,
      evidence: [executive.policy.policyHash, executive.policy.status, executive.policy.action, `budget:${executive.policy.confidenceBudget.score}`]
    },
    {
      id: "proof-receipt",
      label: "Proof receipt",
      status: executive.proofReceipt.status === "observed" ? "pass" : executive.proofReceipt.target.allowed ? "watch" : "block",
      detail: executive.proofReceipt.summary,
      nextAction:
        executive.proofReceipt.status === "observed"
          ? "Use the observed response hash for this turn only."
          : executive.proofReceipt.target.reason,
      evidence: unique([executive.proofReceipt.receiptHash, executive.proofReceipt.status, executive.proofReceipt.observation.responseHash])
    },
    {
      id: "cycle-transition",
      label: "Cycle transition",
      status: cycle.transition.allowed ? "pass" : cycle.status === "learning-queued" ? "watch" : "block",
      detail: `${cycle.transition.from} to ${cycle.transition.to}: ${cycle.transition.reason}`,
      nextAction: cycle.transition.allowed ? "Allow the transition after the command returns expected proof." : "Keep the transition supervised and stop at the current cycle stage.",
      evidence: [cycle.cycleHash, cycle.status, cycle.currentStep, `allowed:${cycle.transition.allowed}`]
    },
    providerGate(providerIngestionEvidence),
    supabaseGate(supabaseIsolation),
    {
      id: "learning-lock",
      label: "Learning lock",
      status: feedback.input.learningStatus === "ready" && feedback.learningPlan.blockedBy.length === 0 ? "pass" : feedback.input.learningStatus === "blocked" ? "block" : "watch",
      detail: feedback.learningPlan.expectedLearningSignal,
      nextAction: feedback.learningPlan.blockedBy[0] ?? feedback.learningPlan.nextTaskTitle ?? "Keep learning as a queue-only signal.",
      evidence: unique([feedback.input.learningStatus, feedback.learningPlan.nextTaskId, feedback.learningPlan.nextTaskStatus, ...feedback.learningPlan.blockedBy.slice(0, 2)])
    },
    {
      id: "write-locks",
      label: "Write locks",
      status:
        executive.controls.canPersist ||
        executive.controls.canPublish ||
        executive.controls.canTrain ||
        feedback.controls.canPersist ||
        feedback.controls.canPublish ||
        feedback.controls.canTrain ||
        cycle.controls.canPersist ||
        cycle.controls.canPublish ||
        cycle.controls.canTrain
          ? "block"
          : "pass",
      detail: "Persist, publish, train, trust-raise, and public-action upgrade controls must remain false.",
      nextAction: "Abort if any write, train, publish, or trust-upgrade flag becomes true.",
      evidence: [
        `persist:${executive.controls.canPersist || feedback.controls.canPersist || cycle.controls.canPersist}`,
        `publish:${executive.controls.canPublish || feedback.controls.canPublish || cycle.controls.canPublish}`,
        `train:${executive.controls.canTrain || feedback.controls.canTrain || cycle.controls.canTrain}`
      ]
    }
  ];
}

function statusFor({
  feedback,
  cycle,
  activeCommandSafe
}: {
  feedback: DecisionAIExecutiveFeedback;
  cycle: DecisionAIExecutiveCycle;
  activeCommandSafe: boolean;
}): DecisionAIExecutiveRunbookStatus {
  if (!activeCommandSafe || cycle.status === "halted" || feedback.status === "blocked") return "blocked";
  if (cycle.status === "repair-required" || feedback.status === "repair-required") return "repair-required";
  if (cycle.status === "awaiting-proof") return "needs-proof";
  if (cycle.status === "learning-queued" || feedback.input.learningStatus === "blocked" || feedback.learningPlan.blockedBy.length > 0) return "learning-locked";
  return "ready-readonly";
}

function summaryFor(status: DecisionAIExecutiveRunbookStatus, activeCommand: DecisionAIExecutiveCycleCommand | null): string {
  if (status === "needs-proof") return `Executive runbook is ready for one supervised proof command: ${activeCommand?.label ?? "none"}.`;
  if (status === "ready-readonly") return "Executive runbook can run the selected read-only command and re-check the cycle state.";
  if (status === "learning-locked") return "Executive runbook can inspect learning state, but training, memory, and publish gates stay locked.";
  if (status === "repair-required") return "Executive runbook must repair or re-inspect proof before another state transition.";
  return "Executive runbook is blocked because no safe local read-only command is available.";
}

function buildSteps({
  status,
  activeCommand,
  activeCommandSafe,
  cycle,
  feedback
}: {
  status: DecisionAIExecutiveRunbookStatus;
  activeCommand: DecisionAIExecutiveCycleCommand | null;
  activeCommandSafe: boolean;
  cycle: DecisionAIExecutiveCycle;
  feedback: DecisionAIExecutiveFeedback;
}): DecisionAIExecutiveRunbookStep[] {
  return [
    {
      id: "preflight",
      label: "Preflight the active command",
      status: activeCommandSafe ? "pass" : "block",
      instruction: "Confirm the selected command is a local GET proof route and has a same-route verification URL.",
      expectedEvidence: activeCommand?.reason ?? "A safe command must be selected before execution."
    },
    {
      id: "execute",
      label: "Run only the selected command",
      status: activeCommandSafe && status !== "blocked" ? "watch" : "block",
      instruction: activeCommand?.command ?? "Hold; no command is safe to run.",
      expectedEvidence: status === "needs-proof" ? "The proof receipt changes to observed with a response hash." : activeCommand?.reason ?? "The route returns a same-or-safer read-only packet."
    },
    {
      id: "verify",
      label: "Verify the route response",
      status: activeCommand?.verifyUrl ? "watch" : "block",
      instruction: activeCommand?.verifyUrl ? `Open ${activeCommand.verifyUrl} and compare status, hash, and controls.` : "No verification URL is available.",
      expectedEvidence: "Response keeps canPersist, canPublish, canTrain, canRaiseTrust, and canUpgradePublicAction false."
    },
    {
      id: "reduce",
      label: "Reduce state after proof",
      status: cycle.status === "awaiting-proof" ? "watch" : cycle.status === "proof-observed" || cycle.status === "learning-queued" ? "pass" : "block",
      instruction: "Rebuild the executive, feedback, and cycle after the proof route returns.",
      expectedEvidence: `Cycle transition remains ${cycle.transition.from} to ${cycle.transition.to}; feedback action is ${feedback.statePatch.action}.`
    },
    {
      id: "learn",
      label: "Queue learning only",
      status: status === "learning-locked" ? "watch" : feedback.input.learningStatus === "ready" ? "pass" : "block",
      instruction: "Inspect learning blockers, but do not write memory, outcomes, features, labels, or training data from this runbook.",
      expectedEvidence: feedback.learningPlan.expectedLearningSignal
    },
    {
      id: "halt",
      label: "Stop at locked gates",
      status: "pass",
      instruction: "Stop immediately after verification or learning inspection; do not chain into writes or shell actions.",
      expectedEvidence: "The runbook ends with draft-only memory and all write/publish/train controls false."
    }
  ];
}

function abortConditions({
  activeCommand,
  activeCommandSafe,
  gates
}: {
  activeCommand: DecisionAIExecutiveCycleCommand | null;
  activeCommandSafe: boolean;
  gates: DecisionAIExecutiveRunbookGate[];
}): string[] {
  return unique(
    [
      activeCommandSafe ? null : "Abort because the selected command is not a local read-only GET proof command.",
      activeCommand?.verifyUrl && isSafeVerifyUrl(activeCommand.verifyUrl) ? null : "Abort because the verification URL is missing or outside /api/sports/decision.",
      "Abort if the response enables canPersist, canPublish, canTrain, canRaiseTrust, or canUpgradePublicAction.",
      "Abort if the response upgrades a public action instead of keeping the same-or-safer stance.",
      "Abort if the command asks for service-role keys, SQL execution, migrations, provider writes, model training, or publishing.",
      ...gates.filter((item) => item.status === "block").map((item) => `${item.label}: ${item.nextAction}`)
    ],
    14
  );
}

function successCriteria({
  status,
  activeCommand,
  cycle,
  feedback
}: {
  status: DecisionAIExecutiveRunbookStatus;
  activeCommand: DecisionAIExecutiveCycleCommand | null;
  cycle: DecisionAIExecutiveCycle;
  feedback: DecisionAIExecutiveFeedback;
}): string[] {
  const proofCriterion =
    status === "needs-proof"
      ? "Proof receipt status becomes observed and includes a non-empty response hash."
      : "The selected route returns a same-or-safer executive/cycle packet.";
  return unique([
    proofCriterion,
    activeCommand?.verifyUrl ? `Verification URL remains available: ${activeCommand.verifyUrl}` : null,
    `Cycle can be rebuilt from ${cycle.currentStep} with feedback ${feedback.status}.`,
    "All write, publish, train, trust-raise, and public-action-upgrade controls remain false.",
    status === "learning-locked" ? "Learning blockers are listed explicitly and no learning row is written." : "Memory stays draft-only until a dedicated storage gate passes."
  ]);
}

export function buildDecisionAIExecutiveRunbook({
  executive,
  feedback,
  cycle,
  providerIngestionEvidence = null,
  supabaseIsolation,
  now = new Date()
}: {
  executive: DecisionAIExecutive;
  feedback: DecisionAIExecutiveFeedback;
  cycle: DecisionAIExecutiveCycle;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  now?: Date;
}): DecisionAIExecutiveRunbook {
  const activeCommand = selectActiveCommand({ cycle, feedback });
  const activeCommandSafe = Boolean(activeCommand?.safeToRun && isSafeLocalGetCommand(activeCommand.command) && isSafeVerifyUrl(activeCommand.verifyUrl));
  const status = statusFor({ feedback, cycle, activeCommandSafe });
  const gates = buildGates({
    executive,
    feedback,
    cycle,
    activeCommand,
    activeCommandSafe,
    providerIngestionEvidence,
    supabaseIsolation
  });
  const runbookHash = stableHash({
    executive: executive.executiveHash,
    feedback: feedback.feedbackHash,
    cycle: cycle.cycleHash,
    command: [activeCommand?.id, activeCommand?.command, activeCommandSafe],
    provider: providerIngestionEvidence ? [providerIngestionEvidence.evidenceHash, providerIngestionEvidence.status] : null,
    supabase: [supabaseIsolation.isolationHash, supabaseIsolation.status],
    gates: gates.map((item) => [item.id, item.status]),
    status
  });
  const memoryContent = compact(
    `${summaryFor(status, activeCommand)} Active command ${activeCommand?.id ?? "none"}; cycle ${cycle.status}/${cycle.currentStep}; feedback ${feedback.status}; blocked gates ${gates
      .filter((item) => item.status === "block")
      .map((item) => item.id)
      .join(", ") || "none"}.`,
    420
  );

  return {
    generatedAt: now.toISOString(),
    date: executive.date,
    sport: executive.sport,
    mode: "ai-executive-runbook",
    status,
    runbookHash,
    summary: summaryFor(status, activeCommand),
    input: {
      executiveHash: executive.executiveHash,
      policyHash: executive.policy.policyHash,
      feedbackHash: feedback.feedbackHash,
      cycleHash: cycle.cycleHash,
      providerIngestionStatus: providerIngestionEvidence?.status ?? "not-attached",
      supabaseIsolationStatus: supabaseIsolation.status
    },
    activeInstruction: {
      commandId: activeCommand?.id ?? null,
      label: activeCommand?.label ?? "No safe command selected",
      command: activeCommand?.command ?? null,
      verifyUrl: activeCommand?.verifyUrl ?? null,
      runMode: activeCommandSafe ? "local-readonly-get" : "manual-hold",
      safeToRun: activeCommandSafe,
      reason: activeCommand?.reason ?? "No safe executive runbook command is available.",
      expectedEvidence: activeCommand?.reason ?? "A safe local proof command must be selected."
    },
    gates,
    orderedSteps: buildSteps({ status, activeCommand, activeCommandSafe, cycle, feedback }),
    abortConditions: abortConditions({ activeCommand, activeCommandSafe, gates }),
    successCriteria: successCriteria({ status, activeCommand, cycle, feedback }),
    memoryDraft: {
      canPersist: false,
      label: `${executive.activeDecision.match ?? "Active executive decision"} executive runbook`,
      evidenceHash: runbookHash,
      content: memoryContent
    },
    controls: {
      canRunActiveCommand: activeCommandSafe,
      canRunReadOnly: activeCommandSafe,
      canAskAIReview: Boolean(activeCommandSafe && activeCommand?.command?.includes("run=1") && executive.controls.canAskOpenAI),
      canObserveProof: Boolean(activeCommandSafe && activeCommand?.command?.includes("observe=1")),
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    locks: unique(
      [
        "Run only the selected local read-only GET command; do not chain shell actions.",
        "Abort if any response enables persist, publish, train, trust raise, or public action upgrade.",
        "Supabase, provider ingestion, memory, and training gates require separate verified proof before writes.",
        ...executive.locks,
        ...feedback.locks,
        ...cycle.locks
      ],
      28
    ),
    proofUrls: unique(
      [
        "/api/sports/decision/ai-executive",
        "/api/sports/decision/learning-queue",
        "/api/sports/decision/provider-ingestion-evidence",
        "/api/sports/decision/supabase-project-isolation",
        activeCommand?.verifyUrl,
        ...executive.proofUrls,
        ...feedback.proofUrls,
        ...cycle.proofUrls
      ],
      36
    )
  };
}
