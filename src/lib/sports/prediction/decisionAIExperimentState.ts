import type { DecisionAIExperimentObserver } from "@/lib/sports/prediction/decisionAIExperimentObserver";
import type { DecisionAIExperimentPlanner } from "@/lib/sports/prediction/decisionAIExperimentPlanner";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIExperimentStatePlannerInput = Pick<
  DecisionAIExperimentPlanner,
  "date" | "sport" | "plannerHash" | "selectedExperiment" | "proofUrls"
> & {
  status?: DecisionAIExperimentPlanner["status"];
  memoryDecision?: Pick<DecisionAIExperimentPlanner["memoryDecision"], "influence">;
};

export type DecisionAIExperimentStateStatus = "pending-observation" | "proof-observed" | "retry-experiment" | "hold-trust" | "blocked";
export type DecisionAIExperimentStateGateStatus = "pass" | "watch" | "block";
export type DecisionAIExperimentStatePatchAction = "record-shadow-proof" | "observe-proof" | "retry-proof" | "hold" | "reduce-trust";

export type DecisionAIExperimentStateGate = {
  id: string;
  label: string;
  status: DecisionAIExperimentStateGateStatus;
  evidence: string[];
  nextAction: string;
};

export type DecisionAIExperimentState = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-experiment-state";
  status: DecisionAIExperimentStateStatus;
  stateHash: string;
  summary: string;
  input: {
    plannerHash: string;
    observerHash: string;
    experimentId: string | null;
    observerStatus: DecisionAIExperimentObserver["status"];
    responseHash: string | null;
  };
  statePatch: {
    action: DecisionAIExperimentStatePatchAction;
    trust: "hold" | "reduce";
    confidence: "keep-capped" | "cap-low";
    memory: "draft-only";
    publicAction: "no-upgrade";
    mayAdvanceReadOnly: boolean;
    mayRetry: boolean;
    mayAskOpenAI: false;
    mayPersist: false;
    mayPublish: false;
    mayTrain: false;
    mayRaiseTrust: false;
  };
  interpretation: {
    label: string;
    reason: string;
    evidence: string[];
    nextMove: string;
  };
  gates: DecisionAIExperimentStateGate[];
  nextExperiment: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string | null;
    content: string;
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

function unique(values: Array<string | null | undefined>, limit = 14): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function observerHasWatchSignal(observer: DecisionAIExperimentObserver): boolean {
  const label = observer.observation.statusLabel?.toLowerCase() ?? "";
  const summary = observer.observation.summary?.toLowerCase() ?? "";
  const signals = observer.observation.signals.join(" ").toLowerCase();
  return (
    label.includes("watch") ||
    label.includes("needs") ||
    summary.includes("waiting") ||
    summary.includes("locked") ||
    summary.includes("blocked") ||
    signals.includes("memory:failed") ||
    signals.includes("status:needs") ||
    signals.includes("status:blocked")
  );
}

function statusFor(observer: DecisionAIExperimentObserver): DecisionAIExperimentStateStatus {
  if (observer.status === "not-run") return "pending-observation";
  if (observer.status === "blocked") return "blocked";
  if (observer.status === "failed" || observer.status === "observed-warning") return "retry-experiment";
  if (observerHasWatchSignal(observer)) return "hold-trust";
  return "proof-observed";
}

function stateAction(status: DecisionAIExperimentStateStatus): DecisionAIExperimentStatePatchAction {
  if (status === "proof-observed") return "record-shadow-proof";
  if (status === "pending-observation") return "observe-proof";
  if (status === "retry-experiment") return "retry-proof";
  if (status === "blocked") return "reduce-trust";
  return "hold";
}

function gate(input: DecisionAIExperimentStateGate): DecisionAIExperimentStateGate {
  return {
    ...input,
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction)
  };
}

function buildGates({
  planner,
  observer,
  status
}: {
  planner: DecisionAIExperimentStatePlannerInput;
  observer: DecisionAIExperimentObserver;
  status: DecisionAIExperimentStateStatus;
}): DecisionAIExperimentStateGate[] {
  return [
    gate({
      id: "planner-selection",
      label: "Planner selection",
      status: planner.selectedExperiment ? "pass" : "block",
      evidence: unique([planner.plannerHash, planner.status ?? "observer-snapshot", planner.selectedExperiment?.id, planner.memoryDecision?.influence ?? "unknown"]),
      nextAction: planner.selectedExperiment ? planner.selectedExperiment.expectedEvidence : "Build a planner candidate before reducing experiment state."
    }),
    gate({
      id: "target-safety",
      label: "Target safety",
      status: observer.target.allowed ? "pass" : "block",
      evidence: unique([observer.target.path, observer.target.reason, observer.target.method]),
      nextAction: observer.target.allowed ? "Keep the experiment target limited to this approved local GET route." : observer.target.reason
    }),
    gate({
      id: "observation",
      label: "Observation",
      status: observer.status === "observed" ? "pass" : observer.status === "not-run" ? "watch" : "block",
      evidence: unique([observer.observerHash, observer.status, observer.observation.responseHash, observer.observation.statusLabel, observer.observation.error]),
      nextAction:
        observer.status === "observed"
          ? "Use the response hash as a shadow-only proof receipt."
          : observer.status === "not-run"
            ? "Run the experiment observer with run=1 before changing experiment state."
            : observer.verification.nextAction
    }),
    gate({
      id: "watch-pressure",
      label: "Watch pressure",
      status: observerHasWatchSignal(observer) ? "watch" : observer.status === "observed" ? "pass" : "watch",
      evidence: unique([observer.observation.summary, ...observer.observation.signals]),
      nextAction: observerHasWatchSignal(observer)
        ? "Hold trust because the observed proof still carries blocker, memory, or watch pressure."
        : "No watch signal was found in the observed response."
    }),
    gate({
      id: "side-effects",
      label: "Side effects",
      status:
        observer.controls.canAskOpenAI ||
        observer.controls.canPersist ||
        observer.controls.canPublish ||
        observer.controls.canTrain ||
        observer.controls.canRaiseTrust ||
        observer.controls.canUpgradePublicAction
          ? "block"
          : "pass",
      evidence: [
        `openai:${observer.controls.canAskOpenAI}`,
        `persist:${observer.controls.canPersist}`,
        `publish:${observer.controls.canPublish}`,
        `train:${observer.controls.canTrain}`,
        `raiseTrust:${observer.controls.canRaiseTrust}`
      ],
      nextAction: "Keep AI calls, persistence, publishing, training, and trust raises locked for this reducer."
    }),
    gate({
      id: "state-transition",
      label: "State transition",
      status: status === "proof-observed" ? "pass" : status === "pending-observation" || status === "hold-trust" ? "watch" : "block",
      evidence: [status, stateAction(status), observer.verification.outcome],
      nextAction:
        status === "proof-observed"
          ? "Record a shadow-only proof and rerun the planner/observer before any future trust change."
          : status === "hold-trust"
            ? "Keep the current experiment state capped and choose the next proof around the observed watch signal."
            : status === "pending-observation"
              ? "Observe the selected proof before reducing state."
              : "Repair or replace the experiment before reducing state."
    })
  ];
}

function interpretationFor(observer: DecisionAIExperimentObserver, status: DecisionAIExperimentStateStatus): DecisionAIExperimentState["interpretation"] {
  if (status === "proof-observed") {
    return {
      label: "Shadow proof recorded",
      reason: "The selected experiment returned a clean observation without visible watch pressure.",
      evidence: unique([observer.observation.responseHash, observer.observation.summary, ...observer.observation.signals]),
      nextMove: "Rebuild the planner and compare hashes before any future state change."
    };
  }
  if (status === "hold-trust") {
    return {
      label: "Proof observed, trust held",
      reason: "The selected experiment was observed, but the response still carries watch, memory, or blocker pressure.",
      evidence: unique([observer.observation.responseHash, observer.observation.summary, ...observer.observation.signals]),
      nextMove: "Choose the next bounded experiment around the observed pressure and keep trust capped."
    };
  }
  if (status === "pending-observation") {
    return {
      label: "Observation pending",
      reason: "The observer has approved a local proof route, but no response hash exists yet.",
      evidence: unique([observer.target.path, observer.target.reason]),
      nextMove: "Call the observer with run=1 to produce a no-write receipt."
    };
  }
  if (status === "retry-experiment") {
    return {
      label: "Retry experiment",
      reason: observer.observation.error ?? "The observation returned a warning or non-clean response.",
      evidence: unique([observer.observation.responseHash, observer.observation.statusLabel, ...observer.observation.signals]),
      nextMove: "Rerun the observer once or select a narrower experiment if the warning repeats."
    };
  }
  return {
    label: "Experiment blocked",
    reason: observer.target.reason,
    evidence: unique([observer.target.path, observer.observation.error, ...observer.locks]),
    nextMove: "Return to the planner and select an approved local read-only proof target."
  };
}

function summaryFor(status: DecisionAIExperimentStateStatus, observer: DecisionAIExperimentObserver): string {
  if (status === "proof-observed") return `AI experiment state recorded shadow proof ${observer.observation.responseHash ?? observer.observerHash}.`;
  if (status === "hold-trust") return "AI experiment state observed proof, but trust remains held by watch or memory pressure.";
  if (status === "retry-experiment") return "AI experiment state needs a retry because the observation failed or returned a warning.";
  if (status === "blocked") return "AI experiment state is blocked by an unsafe or unavailable experiment target.";
  return "AI experiment state is waiting for an observed no-write proof receipt.";
}

export function buildDecisionAIExperimentState({
  planner,
  observer,
  now = new Date()
}: {
  planner: DecisionAIExperimentStatePlannerInput;
  observer: DecisionAIExperimentObserver;
  now?: Date;
}): DecisionAIExperimentState {
  const status = statusFor(observer);
  const gates = buildGates({ planner, observer, status });
  const action = stateAction(status);
  const interpretation = interpretationFor(observer, status);
  const statePatch = {
    action,
    trust: status === "retry-experiment" || status === "blocked" ? "reduce" : "hold",
    confidence: status === "retry-experiment" || status === "blocked" ? "cap-low" : "keep-capped",
    memory: "draft-only",
    publicAction: "no-upgrade",
    mayAdvanceReadOnly: status === "proof-observed",
    mayRetry: status === "retry-experiment" || status === "pending-observation",
    mayAskOpenAI: false,
    mayPersist: false,
    mayPublish: false,
    mayTrain: false,
    mayRaiseTrust: false
  } satisfies DecisionAIExperimentState["statePatch"];
  const stateHash = stableHash({
    planner: planner.plannerHash,
    observer: observer.observerHash,
    experiment: planner.selectedExperiment?.id,
    response: observer.observation.responseHash,
    status,
    patch: statePatch,
    gates: gates.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: planner.date,
    sport: planner.sport,
    mode: "ai-experiment-state",
    status,
    stateHash,
    summary: summaryFor(status, observer),
    input: {
      plannerHash: planner.plannerHash,
      observerHash: observer.observerHash,
      experimentId: planner.selectedExperiment?.id ?? null,
      observerStatus: observer.status,
      responseHash: observer.observation.responseHash
    },
    statePatch,
    interpretation,
    gates,
    nextExperiment: {
      label: status === "pending-observation" || status === "retry-experiment" ? "Observe selected experiment" : "Rebuild experiment planner",
      command:
        status === "pending-observation" || status === "retry-experiment"
          ? decisionCurlCommand(`/api/sports/decision/ai-experiment-observer?date=${encodeURIComponent(planner.date)}&sport=${encodeURIComponent(planner.sport)}&run=1`)
          : decisionCurlCommand(`/api/sports/decision/ai-experiment-planner?date=${encodeURIComponent(planner.date)}&sport=${encodeURIComponent(planner.sport)}`),
      verifyUrl:
        status === "pending-observation" || status === "retry-experiment"
          ? "/api/sports/decision/ai-experiment-observer"
          : "/api/sports/decision/ai-experiment-planner",
      safeToRun: Boolean(observer.target.allowed || status === "proof-observed" || status === "hold-trust")
    },
    memoryDraft: {
      canPersist: false,
      label: "AI experiment observation",
      evidenceHash: observer.observation.responseHash,
      content: `${interpretation.label}: ${interpretation.reason}`
    },
    locks: unique(
      [
        ...observer.locks,
        "AI experiment state may only hold, retry, reduce, or record shadow proof.",
        "A single experiment observation cannot raise trust or publish a pick.",
        "Do not persist the memory draft until the OddsPadi Supabase project and write gates are verified."
      ],
      18
    ),
    proofUrls: unique(["/api/sports/decision/ai-experiment-state", ...observer.proofUrls, ...planner.proofUrls])
  };
}
