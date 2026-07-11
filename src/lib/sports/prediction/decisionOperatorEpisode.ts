import type { DecisionOperatorReceipt } from "@/lib/sports/prediction/decisionOperatorReceipt";
import type { DecisionOperatorState } from "@/lib/sports/prediction/decisionOperatorState";
import type { DecisionOperatorTurn } from "@/lib/sports/prediction/decisionOperatorTurn";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionOperatorEpisodeStatus = "ready-to-observe" | "observed" | "advance-shadow" | "needs-repair" | "blocked";
export type DecisionOperatorEpisodeStepStatus = "pass" | "watch" | "block";

export type DecisionOperatorEpisodeStep = {
  id: "turn" | "receipt" | "state" | "memory" | "next";
  label: string;
  status: DecisionOperatorEpisodeStepStatus;
  evidence: string[];
  detail: string;
  nextAction: string;
};

export type DecisionOperatorEpisode = {
  generatedAt: string;
  date: string;
  sport: DecisionOperatorTurn["sport"];
  mode: "operator-episode";
  status: DecisionOperatorEpisodeStatus;
  episodeHash: string;
  summary: string;
  objective: DecisionOperatorTurn["objective"];
  chain: {
    turnHash: string;
    receiptHash: string;
    stateHash: string;
    proofHash: string | null;
  };
  timeline: DecisionOperatorEpisodeStep[];
  finalPatch: {
    confidence: DecisionOperatorState["statePatch"]["confidence"];
    trust: DecisionOperatorState["statePatch"]["trust"];
    action: DecisionOperatorState["statePatch"]["authorizedAction"];
    posture: DecisionOperatorState["statePatch"]["publicPosture"];
    canAdvanceReadOnly: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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
  operatorNarrative: {
    belief: string;
    observed: string;
    decision: string;
    risk: string;
    next: string;
  };
  memoryDraft: DecisionOperatorState["memoryDraft"];
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

function episodeStatus({
  receipt,
  state
}: {
  receipt: DecisionOperatorReceipt;
  state: DecisionOperatorState;
}): DecisionOperatorEpisodeStatus {
  if (state.status === "advance-shadow") return "advance-shadow";
  if (state.status === "needs-repair") return "needs-repair";
  if (state.status === "blocked" || receipt.status === "blocked") return "blocked";
  if (receipt.status === "verified" || state.status === "proof-observed") return "observed";
  return "ready-to-observe";
}

function step(input: DecisionOperatorEpisodeStep): DecisionOperatorEpisodeStep {
  return {
    ...input,
    detail: compact(input.detail),
    evidence: unique(input.evidence, 6),
    nextAction: compact(input.nextAction)
  };
}

function buildTimeline({
  turn,
  receipt,
  state
}: {
  turn: DecisionOperatorTurn;
  receipt: DecisionOperatorReceipt;
  state: DecisionOperatorState;
}): DecisionOperatorEpisodeStep[] {
  return [
    step({
      id: "turn",
      label: "Turn selected",
      status: turn.permissions.canRunCommand ? "pass" : turn.status === "blocked" ? "block" : "watch",
      evidence: unique([turn.turnHash, turn.status, turn.nextOperation?.label, turn.nextOperation?.runMode]),
      detail: turn.summary,
      nextAction: turn.nextOperation?.expectedEvidence ?? "Select a safe operator turn."
    }),
    step({
      id: "receipt",
      label: "Proof observed",
      status: receipt.status === "verified" ? "pass" : receipt.status === "not-run" ? "watch" : "block",
      evidence: unique([receipt.receiptHash, receipt.status, receipt.observation.responseHash, receipt.observation.statusLabel]),
      detail: receipt.summary,
      nextAction: receipt.status === "not-run" ? "Run the receipt with run=1." : receipt.verification.fallbackAction
    }),
    step({
      id: "state",
      label: "State reduced",
      status: state.status === "advance-shadow" ? "pass" : state.status === "proof-observed" || state.status === "pending-proof" ? "watch" : "block",
      evidence: [state.stateHash, state.status, state.statePatch.confidence, state.statePatch.trust],
      detail: state.summary,
      nextAction: state.interpretation.nextMove
    }),
    step({
      id: "memory",
      label: "Memory draft",
      status: state.memoryDraft.canPersist ? "pass" : "watch",
      evidence: unique([state.memoryDraft.evidenceHash, state.memoryDraft.label]),
      detail: state.memoryDraft.content,
      nextAction: state.memoryDraft.canPersist ? "Persist memory draft with write approval." : "Keep memory as a draft until Supabase write gates pass."
    }),
    step({
      id: "next",
      label: "Next bounded move",
      status: state.nextTurn.safeToRun ? "pass" : "block",
      evidence: [state.nextTurn.label, state.nextTurn.verifyUrl],
      detail: state.nextTurn.command,
      nextAction: "Run only the next safe read-only command or inspect the proof URL."
    })
  ];
}

function summaryFor(status: DecisionOperatorEpisodeStatus, state: DecisionOperatorState): string {
  if (status === "advance-shadow") return "Operator episode can advance in read-only shadow mode; persistence and publishing remain locked.";
  if (status === "observed") return "Operator episode observed proof and reduced state, but trust remains capped until blockers clear.";
  if (status === "needs-repair") return "Operator episode needs proof repair before the next state change.";
  if (status === "blocked") return "Operator episode is blocked by an unsafe or unavailable proof path.";
  return `Operator episode is ready to observe proof through ${state.nextTurn.label}.`;
}

function narrative({
  turn,
  receipt,
  state
}: {
  turn: DecisionOperatorTurn;
  receipt: DecisionOperatorReceipt;
  state: DecisionOperatorState;
}): DecisionOperatorEpisode["operatorNarrative"] {
  return {
    belief: compact(turn.objective.reason),
    observed:
      receipt.status === "not-run"
        ? "The proof target is approved but has not been observed."
        : compact(receipt.observation.summary ?? receipt.summary),
    decision: compact(state.interpretation.reason),
    risk: compact(
      state.gates.find((item) => item.status === "block")?.nextAction ??
        state.gates.find((item) => item.status === "watch")?.nextAction ??
        "No blocking state risk was reported."
    ),
    next: compact(state.interpretation.nextMove)
  };
}

export function buildDecisionOperatorEpisode({
  turn,
  receipt,
  state,
  now = new Date()
}: {
  turn: DecisionOperatorTurn;
  receipt: DecisionOperatorReceipt;
  state: DecisionOperatorState;
  now?: Date;
}): DecisionOperatorEpisode {
  const timeline = buildTimeline({ turn, receipt, state });
  const status = episodeStatus({ receipt, state });
  const episodeHash = stableHash({
    date: turn.date,
    sport: turn.sport,
    turn: turn.turnHash,
    receipt: receipt.receiptHash,
    state: state.stateHash,
    proof: receipt.observation.responseHash,
    status,
    timeline: timeline.map((item) => [item.id, item.status])
  });

  return {
    generatedAt: now.toISOString(),
    date: turn.date,
    sport: turn.sport,
    mode: "operator-episode",
    status,
    episodeHash,
    summary: summaryFor(status, state),
    objective: turn.objective,
    chain: {
      turnHash: turn.turnHash,
      receiptHash: receipt.receiptHash,
      stateHash: state.stateHash,
      proofHash: receipt.observation.responseHash
    },
    timeline,
    finalPatch: {
      confidence: state.statePatch.confidence,
      trust: state.statePatch.trust,
      action: state.statePatch.authorizedAction,
      posture: state.statePatch.publicPosture,
      canAdvanceReadOnly: state.statePatch.mayAdvanceReadOnly,
      canPersist: false,
      canPublish: false,
      canTrain: false
    },
    replay: {
      commands: [
        {
          id: "operator-turn",
          label: "Rebuild operator turn",
          command: decisionCurlCommand(`/api/sports/decision/operator-turn?date=${encodeURIComponent(turn.date)}&sport=${encodeURIComponent(turn.sport)}`),
          safeToRun: true
        },
        {
          id: "operator-receipt",
          label: "Observe operator receipt",
          command: decisionCurlCommand(`/api/sports/decision/operator-receipt?date=${encodeURIComponent(turn.date)}&sport=${encodeURIComponent(turn.sport)}&run=1`),
          safeToRun: true
        },
        {
          id: "operator-state",
          label: "Reduce operator state",
          command: decisionCurlCommand(`/api/sports/decision/operator-state?date=${encodeURIComponent(turn.date)}&sport=${encodeURIComponent(turn.sport)}&run=1`),
          safeToRun: true
        }
      ],
      urls: unique(["/api/sports/decision/operator-episode", "/api/sports/decision/operator-turn", "/api/sports/decision/operator-receipt", "/api/sports/decision/operator-state"])
    },
    operatorNarrative: narrative({ turn, receipt, state }),
    memoryDraft: state.memoryDraft,
    locks: unique([
      ...state.locks,
      "Operator episode is replay-only until Supabase write gates pass.",
      "Do not publish episode-derived picks while final patch canPublish is false."
    ], 18),
    proofUrls: unique(["/api/sports/decision/operator-episode", ...state.proofUrls, ...receipt.proofUrls, ...turn.proofUrls])
  };
}
