import type { DecisionShadowNextCyclePlanner } from "@/lib/sports/prediction/decisionShadowNextCyclePlanner";
import type { DecisionShadowNextCycleReceipt } from "@/lib/sports/prediction/decisionShadowNextCycleReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowNextCycleInterpreterStatus = "waiting-observation" | "observed-proof" | "needs-repair" | "blocked";
export type DecisionShadowNextCycleInterpreterTraceStatus = "pass" | "watch" | "block";

export type DecisionShadowNextCycleInterpreterTrace = {
  id: "select" | "observe" | "interpret" | "guard" | "decide" | "learn";
  label: string;
  status: DecisionShadowNextCycleInterpreterTraceStatus;
  publicReason: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionShadowNextCycleInterpreter = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowNextCyclePlanner["sport"];
  mode: "decision-shadow-next-cycle-interpreter";
  status: DecisionShadowNextCycleInterpreterStatus;
  interpreterHash: string;
  summary: string;
  input: {
    plannerHash: string;
    receiptHash: string;
    selectedStepId: string | null;
    receiptStatus: DecisionShadowNextCycleReceipt["status"];
    proofHash: string | null;
  };
  interpretation: {
    learned: string;
    risk: string;
    nextAction: string;
    diagnosis: {
      active: boolean;
      selectedLabel: string | null;
      nextProof: string | null;
      proofTarget: string | null;
    };
    confidenceEffect: "keep-capped" | "reduce" | "shadow-only";
    publicActionEffect: "none";
    probabilityEffect: 0;
  };
  publicTrace: DecisionShadowNextCycleInterpreterTrace[];
  nextTurn: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string | null;
    content: string;
  };
  controls: {
    canRunReceiptObservation: boolean;
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

function unique(values: Array<string | null | undefined>, limit = 28): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function hasSignal(receipt: DecisionShadowNextCycleReceipt, pattern: RegExp): boolean {
  return receipt.observation.signals.some((signal) => pattern.test(signal)) || Boolean(receipt.observation.statusLabel && pattern.test(receipt.observation.statusLabel));
}

function statusFor(receipt: DecisionShadowNextCycleReceipt): DecisionShadowNextCycleInterpreterStatus {
  if (receipt.status === "blocked") return "blocked";
  if (receipt.status === "failed" || receipt.status === "observed-warning") return "needs-repair";
  if (receipt.status === "verified" && receipt.selectedStep.source === "historical-diagnosis") {
    return hasSignal(receipt, /fail|error|persist:true|adjust:true/i) ? "needs-repair" : "observed-proof";
  }
  if (receipt.status === "verified") return hasSignal(receipt, /block|fail|error|persist:true|adjust:true/i) ? "needs-repair" : "observed-proof";
  return "waiting-observation";
}

function traceItem(input: DecisionShadowNextCycleInterpreterTrace): DecisionShadowNextCycleInterpreterTrace {
  return {
    ...input,
    publicReason: compact(input.publicReason),
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction)
  };
}

function buildTrace({
  planner,
  receipt,
  status
}: {
  planner: DecisionShadowNextCyclePlanner;
  receipt: DecisionShadowNextCycleReceipt;
  status: DecisionShadowNextCycleInterpreterStatus;
}): DecisionShadowNextCycleInterpreterTrace[] {
  return [
    traceItem({
      id: "select",
      label: "Selected step",
      status: planner.selectedStep ? "pass" : "block",
      publicReason: planner.selectedStep?.question ?? "No next-cycle step was selected.",
      evidence: unique([planner.plannerHash, planner.selectedStep?.id, planner.selectedStep?.source]),
      nextAction: planner.selectedStep ? "Keep the selected proof question as the only next-cycle target." : "Rebuild the planner with a safe selected step."
    }),
    traceItem({
      id: "observe",
      label: "Proof observation",
      status: receipt.status === "verified" ? "pass" : receipt.status === "not-run" ? "watch" : "block",
      publicReason: receipt.summary,
      evidence: unique([receipt.receiptHash, receipt.status, receipt.observation.responseHash, receipt.observation.statusLabel]),
      nextAction:
        receipt.status === "not-run"
          ? "Run the shadow next-cycle receipt with run=1."
          : receipt.status === "verified"
            ? "Use the receipt hash as observed public proof."
            : receipt.verification.fallbackAction
    }),
    traceItem({
      id: "interpret",
      label: "Receipt interpretation",
      status: status === "observed-proof" ? "pass" : status === "waiting-observation" ? "watch" : "block",
      publicReason:
        status === "observed-proof"
          ? receipt.selectedStep.source === "historical-diagnosis"
            ? "The historical diagnosis proof was observed without public blocker signals."
            : "The proof was observed without public blocker signals."
          : status === "waiting-observation"
            ? "The proof target is approved but has not been observed."
            : "The observed proof requires repair before the agent can continue.",
      evidence: unique([receipt.observation.summary, ...receipt.observation.signals]),
      nextAction: status === "observed-proof" ? "Plan the next read-only cycle from the observed proof." : "Keep the current cycle capped until observation or repair completes."
    }),
    traceItem({
      id: "guard",
      label: "Side-effect guard",
      status:
        receipt.controls.canExecuteShell ||
        receipt.controls.canPersistMemory ||
        receipt.controls.canTrainModels ||
        receipt.controls.canAdjustProbabilities ||
        receipt.controls.canPublishPicks ||
        receipt.controls.canStake
          ? "block"
          : "pass",
      publicReason: "Receipt controls keep shell, persistence, training, probability changes, publishing, and staking locked.",
      evidence: [
        `shell:${receipt.controls.canExecuteShell}`,
        `persist:${receipt.controls.canPersistMemory}`,
        `train:${receipt.controls.canTrainModels}`,
        `adjust:${receipt.controls.canAdjustProbabilities}`,
        `publish:${receipt.controls.canPublishPicks}`,
        `stake:${receipt.controls.canStake}`
      ],
      nextAction: "Continue only in read-only shadow mode."
    }),
    traceItem({
      id: "decide",
      label: "Next decision",
      status: status === "blocked" || status === "needs-repair" ? "block" : "watch",
      publicReason:
        status === "observed-proof"
          ? receipt.selectedStep.source === "historical-diagnosis"
            ? "The agent can continue the provider retest evidence ladder, but public action remains unchanged."
            : "The agent can continue planning, but public action remains unchanged."
          : status === "waiting-observation"
            ? "The agent should observe the selected proof before deciding a next step."
            : "The agent should repair the proof route before continuing.",
      evidence: unique([status, receipt.target.path, receipt.target.reason]),
      nextAction:
        status === "observed-proof"
          ? receipt.selectedStep.source === "historical-diagnosis"
            ? "Move to the next diagnosis proof while keeping training and picks locked."
            : "Build another read-only next-cycle plan from the observed proof hash."
          : status === "waiting-observation"
            ? "Observe the approved target once."
            : "Repair or replace the selected proof target."
    }),
    traceItem({
      id: "learn",
      label: "Shadow memory",
      status: "watch",
      publicReason: "The interpreter drafts memory but cannot persist it until live outcome and governance gates pass.",
      evidence: unique([receipt.observation.responseHash, planner.plannerHash, receipt.receiptHash]),
      nextAction: "Keep the memory draft local to the response and wait for promotion governance."
    })
  ];
}

function interpretationFor(status: DecisionShadowNextCycleInterpreterStatus, receipt: DecisionShadowNextCycleReceipt): DecisionShadowNextCycleInterpreter["interpretation"] {
  const diagnosisActive = receipt.selectedStep.source === "historical-diagnosis";
  const diagnosisLabel = receipt.selectedStep.label;
  const diagnosisNext =
    diagnosisLabel === "Provider fixture identity"
      ? {
          nextProof: "Odds snapshot readiness",
          proofTarget: "/api/sports/decision/odds-snapshot-storage-readiness"
        }
      : diagnosisLabel === "Opening, pre-match, and closing odds snapshots"
        ? {
            nextProof: "Provider context feature gap",
            proofTarget: "/api/sports/decision/training/football-provider-feature-intake-gap"
          }
        : diagnosisActive
          ? {
              nextProof: "Provider-enriched market gates",
              proofTarget: "/api/sports/decision/training/football-data-model-promotion-decision"
            }
          : {
              nextProof: null,
              proofTarget: null
            };

  if (status === "observed-proof") {
    return {
      learned: compact(
        diagnosisActive
          ? `${diagnosisLabel ?? "Historical diagnosis proof"} responded as a public receipt: ${receipt.observation.summary ?? "selected read-only route responded successfully."}`
          : (receipt.observation.summary ?? "The selected read-only proof route responded successfully.")
      ),
      risk: diagnosisActive
        ? "Historical diagnosis proof can choose the next retest question only; it cannot change model probability, confidence, public action, or stake."
        : "Observed proof can shape the next question only; it cannot change the pick, probability, confidence, or stake.",
      nextAction: diagnosisNext.nextProof
        ? `Move to ${diagnosisNext.nextProof} as the next read-only diagnosis proof.`
        : "Plan the next read-only shadow step from the receipt hash.",
      diagnosis: {
        active: diagnosisActive,
        selectedLabel: diagnosisLabel,
        nextProof: diagnosisNext.nextProof,
        proofTarget: diagnosisNext.proofTarget
      },
      confidenceEffect: "shadow-only",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  if (status === "waiting-observation") {
    return {
      learned: "The agent has selected an approved proof target, but no observation has been run.",
      risk: "Without a receipt hash, the next cycle must not claim fresh evidence.",
      nextAction: "Run one shadow next-cycle receipt observation.",
      diagnosis: {
        active: diagnosisActive,
        selectedLabel: diagnosisLabel,
        nextProof: diagnosisNext.nextProof,
        proofTarget: diagnosisNext.proofTarget
      },
      confidenceEffect: "keep-capped",
      publicActionEffect: "none",
      probabilityEffect: 0
    };
  }
  return {
    learned: compact(receipt.observation.error ?? receipt.target.reason),
    risk: "The proof path is blocked or unreliable, so the agent must repair evidence before continuing.",
    nextAction: receipt.verification.fallbackAction,
    diagnosis: {
      active: diagnosisActive,
      selectedLabel: diagnosisLabel,
      nextProof: diagnosisNext.nextProof,
      proofTarget: diagnosisNext.proofTarget
    },
    confidenceEffect: "reduce",
    publicActionEffect: "none",
    probabilityEffect: 0
  };
}

function nextTurnFor({
  date,
  sport,
  receipt,
  status,
  interpretation
}: {
  date: string;
  sport: DecisionShadowNextCyclePlanner["sport"];
  receipt: DecisionShadowNextCycleReceipt;
  status: DecisionShadowNextCycleInterpreterStatus;
  interpretation: DecisionShadowNextCycleInterpreter["interpretation"];
}): DecisionShadowNextCycleInterpreter["nextTurn"] {
  if (status === "waiting-observation" && receipt.target.allowed) {
    const verifyUrl = `/api/sports/decision/shadow-next-cycle-receipt?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&run=1`;
    return {
      label: "Observe selected shadow proof",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true
    };
  }
  if (status === "observed-proof" && interpretation.diagnosis.active && interpretation.diagnosis.proofTarget) {
    return {
      label: `Inspect ${interpretation.diagnosis.nextProof ?? "next diagnosis proof"}`,
      command: interpretation.diagnosis.proofTarget.includes("/training/") ? null : decisionCurlCommand(interpretation.diagnosis.proofTarget),
      verifyUrl: interpretation.diagnosis.proofTarget,
      safeToRun: !interpretation.diagnosis.proofTarget.includes("/training/")
    };
  }
  if (status === "observed-proof") {
    const verifyUrl = `/api/sports/decision/shadow-next-cycle-planner?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`;
    return {
      label: "Plan another read-only shadow cycle",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true
    };
  }
  return {
    label: "Repair selected proof route",
    command: null,
    verifyUrl: receipt.target.path ?? "/api/sports/decision/shadow-next-cycle-planner",
    safeToRun: false
  };
}

function summaryFor(status: DecisionShadowNextCycleInterpreterStatus, interpretation: DecisionShadowNextCycleInterpreter["interpretation"]): string {
  if (status === "observed-proof") return `Shadow next-cycle interpreter learned: ${interpretation.learned}`;
  if (status === "waiting-observation") return "Shadow next-cycle interpreter is waiting for the selected proof receipt to be observed.";
  if (status === "needs-repair") return "Shadow next-cycle interpreter needs proof repair before the agent can continue.";
  return "Shadow next-cycle interpreter is blocked by an unsafe or unavailable proof target.";
}

export function buildDecisionShadowNextCycleInterpreter({
  planner,
  receipt,
  now = new Date()
}: {
  planner: DecisionShadowNextCyclePlanner;
  receipt: DecisionShadowNextCycleReceipt;
  now?: Date;
}): DecisionShadowNextCycleInterpreter {
  const status = statusFor(receipt);
  const interpretation = interpretationFor(status, receipt);
  const publicTrace = buildTrace({ planner, receipt, status });
  const nextTurn = nextTurnFor({ date: planner.date, sport: planner.sport, receipt, status, interpretation });
  const memoryContent = compact(
    [
      `status:${status}`,
      `step:${receipt.selectedStep.label ?? "none"}`,
      `proof:${receipt.observation.responseHash ?? "pending"}`,
      `learned:${interpretation.learned}`,
      `risk:${interpretation.risk}`
    ].join(" | "),
    420
  );
  const interpreterHash = stableHash({
    date: planner.date,
    sport: planner.sport,
    planner: planner.plannerHash,
    receipt: receipt.receiptHash,
    status,
    proof: receipt.observation.responseHash,
    trace: publicTrace.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: planner.date,
    sport: planner.sport,
    mode: "decision-shadow-next-cycle-interpreter",
    status,
    interpreterHash,
    summary: summaryFor(status, interpretation),
    input: {
      plannerHash: planner.plannerHash,
      receiptHash: receipt.receiptHash,
      selectedStepId: receipt.selectedStep.id,
      receiptStatus: receipt.status,
      proofHash: receipt.observation.responseHash
    },
    interpretation,
    publicTrace,
    nextTurn,
    memoryDraft: {
      canPersist: false,
      label: "shadow_next_cycle_interpretation",
      evidenceHash: receipt.observation.responseHash,
      content: memoryContent
    },
    controls: {
      canRunReceiptObservation: status === "waiting-observation" && receipt.target.allowed,
      canPlanNextReadOnlyStep: status === "observed-proof",
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
      "/api/sports/decision/shadow-next-cycle-interpreter",
      "/api/sports/decision/shadow-next-cycle-receipt",
      "/api/sports/decision/shadow-next-cycle-planner",
      nextTurn.verifyUrl,
      ...receipt.proofUrls,
      ...planner.proofUrls
    ]),
    locks: unique([
      "Interpreter output is public trace only, not hidden chain-of-thought.",
      "It may run or recommend one read-only receipt/planner route only.",
      "It cannot persist memory, write decisions, train models, adjust probabilities, raise confidence, publish picks, or stake.",
      ...receipt.locks,
      ...planner.locks
    ])
  };
}
