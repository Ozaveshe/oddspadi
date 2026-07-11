import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionAIExperimentObserver } from "@/lib/sports/prediction/decisionAIExperimentObserver";
import type { DecisionAIExperimentState } from "@/lib/sports/prediction/decisionAIExperimentState";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIExperimentEpisodeStatus = "ready-to-observe" | "shadow-recorded" | "hold-trust" | "retry-experiment" | "blocked";
export type DecisionAIExperimentEpisodeStepStatus = "pass" | "watch" | "block";
export type DecisionAIExperimentEpisodeStabilityStatus = "single-attempt" | "stable-observed" | "retry-selected" | "unstable-retry" | "blocked";

export type DecisionAIExperimentEpisodeStabilityInput = {
  attempts: number;
  selectedAttempt: number;
  observedStatuses: string[];
  responseHashes: Array<string | null>;
  reason: string;
};

export type DecisionAIExperimentEpisodeStep = {
  id: "plan" | "observe" | "reduce" | "memory" | "next";
  label: string;
  status: DecisionAIExperimentEpisodeStepStatus;
  evidence: string[];
  detail: string;
  nextAction: string;
};

export type DecisionAIExperimentEpisode = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-experiment-episode";
  status: DecisionAIExperimentEpisodeStatus;
  episodeHash: string;
  summary: string;
  chain: {
    plannerHash: string;
    observerHash: string;
    stateHash: string;
    responseHash: string | null;
    experimentId: string | null;
  };
  timeline: DecisionAIExperimentEpisodeStep[];
  finalPatch: {
    action: DecisionAIExperimentState["statePatch"]["action"];
    trust: DecisionAIExperimentState["statePatch"]["trust"];
    confidence: DecisionAIExperimentState["statePatch"]["confidence"];
    canAdvanceReadOnly: boolean;
    canRetry: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
  };
  stability: {
    status: DecisionAIExperimentEpisodeStabilityStatus;
    attempts: number;
    selectedAttempt: number;
    selectedObserverHash: string;
    selectedResponseHash: string | null;
    observedStatuses: string[];
    reason: string;
    nextAction: string;
    canRetryAgain: boolean;
    canRaiseTrust: false;
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
  experimentNarrative: {
    planned: string;
    observed: string;
    reduced: string;
    risk: string;
    next: string;
  };
  memoryDraft: DecisionAIExperimentState["memoryDraft"];
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

function unique(values: Array<string | null | undefined>, limit = 16): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function episodeStatus(state: DecisionAIExperimentState): DecisionAIExperimentEpisodeStatus {
  if (state.status === "proof-observed") return "shadow-recorded";
  if (state.status === "hold-trust") return "hold-trust";
  if (state.status === "retry-experiment") return "retry-experiment";
  if (state.status === "blocked") return "blocked";
  return "ready-to-observe";
}

function step(input: DecisionAIExperimentEpisodeStep): DecisionAIExperimentEpisodeStep {
  return {
    ...input,
    detail: compact(input.detail),
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction)
  };
}

function buildTimeline({
  observer,
  state
}: {
  observer: DecisionAIExperimentObserver;
  state: DecisionAIExperimentState;
}): DecisionAIExperimentEpisodeStep[] {
  return [
    step({
      id: "plan",
      label: "Experiment planned",
      status: observer.selectedExperiment ? "pass" : "block",
      evidence: unique([observer.plannerHash, observer.selectedExperiment?.id, observer.selectedExperiment?.runMode, observer.selectedExperiment?.source]),
      detail: observer.selectedExperiment?.objective ?? "No experiment was selected.",
      nextAction: observer.selectedExperiment?.expectedEvidence ?? "Return to the planner and select a bounded proof."
    }),
    step({
      id: "observe",
      label: "Proof observed",
      status: observer.status === "observed" ? "pass" : observer.status === "not-run" ? "watch" : "block",
      evidence: unique([observer.observerHash, observer.status, observer.observation.responseHash, observer.observation.statusLabel, observer.target.path]),
      detail: observer.summary,
      nextAction: observer.status === "not-run" ? "Run the observer with run=1." : observer.verification.nextAction
    }),
    step({
      id: "reduce",
      label: "State reduced",
      status: state.status === "proof-observed" ? "pass" : state.status === "pending-observation" || state.status === "hold-trust" ? "watch" : "block",
      evidence: unique([state.stateHash, state.status, state.statePatch.action, state.statePatch.trust, state.statePatch.confidence]),
      detail: state.summary,
      nextAction: state.interpretation.nextMove
    }),
    step({
      id: "memory",
      label: "Memory drafted",
      status: state.memoryDraft.canPersist ? "pass" : "watch",
      evidence: unique([state.memoryDraft.evidenceHash, state.memoryDraft.label]),
      detail: state.memoryDraft.content,
      nextAction: state.memoryDraft.canPersist ? "Persist the experiment memory draft with write approval." : "Keep the experiment memory as a draft until Supabase write gates pass."
    }),
    step({
      id: "next",
      label: "Next experiment move",
      status: state.nextExperiment.safeToRun ? "pass" : "block",
      evidence: unique([state.nextExperiment.label, state.nextExperiment.verifyUrl]),
      detail: state.nextExperiment.command,
      nextAction: "Run only the next safe read-only command or inspect the proof URL."
    })
  ];
}

function summaryFor(status: DecisionAIExperimentEpisodeStatus, state: DecisionAIExperimentState): string {
  if (status === "shadow-recorded") return "AI experiment episode recorded a shadow proof; persistence, publishing, training, and trust raises remain locked.";
  if (status === "hold-trust") return "AI experiment episode observed proof but keeps trust held by watch pressure.";
  if (status === "retry-experiment") return "AI experiment episode needs another proof attempt before changing state.";
  if (status === "blocked") return "AI experiment episode is blocked by an unsafe or unavailable proof path.";
  return `AI experiment episode is ready to observe proof through ${state.nextExperiment.label}.`;
}

function narrative({
  observer,
  state
}: {
  observer: DecisionAIExperimentObserver;
  state: DecisionAIExperimentState;
}): DecisionAIExperimentEpisode["experimentNarrative"] {
  const riskGate = state.gates.find((item) => item.status === "block") ?? state.gates.find((item) => item.status === "watch");
  return {
    planned: compact(observer.selectedExperiment?.hypothesis ?? "No selected experiment hypothesis is available."),
    observed:
      observer.status === "not-run"
        ? "The experiment target is approved but has not been observed."
        : compact(observer.observation.summary ?? observer.summary),
    reduced: compact(state.interpretation.reason),
    risk: compact(riskGate?.nextAction ?? "No blocking experiment-state risk was reported."),
    next: compact(state.interpretation.nextMove)
  };
}

function stabilityFor({
  observer,
  state,
  input
}: {
  observer: DecisionAIExperimentObserver;
  state: DecisionAIExperimentState;
  input?: DecisionAIExperimentEpisodeStabilityInput;
}): DecisionAIExperimentEpisode["stability"] {
  const attempts = Math.max(1, input?.attempts ?? 1);
  const selectedAttempt = Math.max(1, Math.min(attempts, input?.selectedAttempt ?? 1));
  const observedStatuses = unique(input?.observedStatuses ?? [observer.status], 6);
  const hasRetry = attempts > 1;
  const status: DecisionAIExperimentEpisodeStabilityStatus =
    state.status === "blocked"
      ? "blocked"
      : hasRetry && observer.status === "observed"
        ? "retry-selected"
        : hasRetry
          ? "unstable-retry"
          : observer.status === "observed"
            ? "stable-observed"
            : "single-attempt";

  return {
    status,
    attempts,
    selectedAttempt,
    selectedObserverHash: observer.observerHash,
    selectedResponseHash: observer.observation.responseHash,
    observedStatuses,
    reason:
      input?.reason ??
      (status === "stable-observed"
        ? "The first observer attempt produced a clean proof receipt."
        : status === "single-attempt"
          ? "Only one observer attempt has been made."
          : status === "retry-selected"
            ? "A later observer attempt produced the strongest proof receipt."
            : status === "blocked"
              ? "The observer target is blocked, so retrying would not be safe."
              : "The observer retry still did not produce a clean proof receipt."),
    nextAction:
      status === "stable-observed" || status === "retry-selected"
        ? "Compare the selected response hash with the next planner run before changing trust."
        : status === "blocked"
          ? "Return to the planner and choose an approved proof route."
          : "Keep trust capped and retry only after the next planner rebuild.",
    canRetryAgain: status === "single-attempt" || status === "unstable-retry",
    canRaiseTrust: false
  };
}

export function buildDecisionAIExperimentEpisode({
  observer,
  state,
  stability,
  now = new Date()
}: {
  observer: DecisionAIExperimentObserver;
  state: DecisionAIExperimentState;
  stability?: DecisionAIExperimentEpisodeStabilityInput;
  now?: Date;
}): DecisionAIExperimentEpisode {
  const timeline = buildTimeline({ observer, state });
  const status = episodeStatus(state);
  const stabilityPacket = stabilityFor({ observer, state, input: stability });
  const episodeHash = stableHash({
    date: state.date,
    sport: state.sport,
    planner: state.input.plannerHash,
    observer: observer.observerHash,
    state: state.stateHash,
    response: state.input.responseHash,
    status,
    stability: [stabilityPacket.status, stabilityPacket.attempts, stabilityPacket.selectedAttempt],
    timeline: timeline.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: state.date,
    sport: state.sport,
    mode: "ai-experiment-episode",
    status,
    episodeHash,
    summary: summaryFor(status, state),
    chain: {
      plannerHash: state.input.plannerHash,
      observerHash: observer.observerHash,
      stateHash: state.stateHash,
      responseHash: state.input.responseHash,
      experimentId: state.input.experimentId
    },
    timeline,
    finalPatch: {
      action: state.statePatch.action,
      trust: state.statePatch.trust,
      confidence: state.statePatch.confidence,
      canAdvanceReadOnly: state.statePatch.mayAdvanceReadOnly,
      canRetry: state.statePatch.mayRetry,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false
    },
    stability: stabilityPacket,
    replay: {
      commands: [
        {
          id: "ai-experiment-planner",
          label: "Rebuild experiment planner",
          command: decisionCurlCommand(`/api/sports/decision/ai-experiment-planner?date=${encodeURIComponent(state.date)}&sport=${encodeURIComponent(state.sport)}`),
          safeToRun: true
        },
        {
          id: "ai-experiment-observer",
          label: "Observe selected experiment",
          command: decisionCurlCommand(`/api/sports/decision/ai-experiment-observer?date=${encodeURIComponent(state.date)}&sport=${encodeURIComponent(state.sport)}&run=1`),
          safeToRun: Boolean(observer.target.allowed)
        },
        {
          id: "ai-experiment-state",
          label: "Reduce experiment state",
          command: decisionCurlCommand(`/api/sports/decision/ai-experiment-state?date=${encodeURIComponent(state.date)}&sport=${encodeURIComponent(state.sport)}&run=1`),
          safeToRun: true
        },
        {
          id: "ai-experiment-episode",
          label: "Replay experiment episode",
          command: decisionCurlCommand(`/api/sports/decision/ai-experiment-episode?date=${encodeURIComponent(state.date)}&sport=${encodeURIComponent(state.sport)}&run=1`),
          safeToRun: true
        }
      ],
      urls: unique([
        "/api/sports/decision/ai-experiment-episode",
        "/api/sports/decision/ai-experiment-planner",
        "/api/sports/decision/ai-experiment-observer",
        "/api/sports/decision/ai-experiment-state"
      ])
    },
    experimentNarrative: narrative({ observer, state }),
    memoryDraft: state.memoryDraft,
    locks: unique(
      [
        ...state.locks,
        "AI experiment episode is replay-only until OddsPadi Supabase write gates pass.",
        "Do not publish episode-derived picks while finalPatch.canPublish is false."
      ],
      20
    ),
    proofUrls: unique(["/api/sports/decision/ai-experiment-episode", ...state.proofUrls, ...observer.proofUrls], 36)
  };
}
