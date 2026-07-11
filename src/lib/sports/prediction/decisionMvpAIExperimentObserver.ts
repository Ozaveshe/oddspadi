import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionMvpAIExperimentObserverStatus = "ready-observation" | "observed-support" | "observed-warning" | "observed-contradiction" | "blocked" | "failed";

export type DecisionMvpAIExperimentObservation = {
  attempted: boolean;
  ok: boolean;
  statusCode: number | null;
  contentType: string | null;
  responseHash: string | null;
  bodyBytes: number;
  success: boolean | null;
  statusLabel: string | null;
  summary: string | null;
  signals: string[];
  error: string | null;
};

export type DecisionMvpAIExperimentObserver = {
  mode: "decision-mvp-ai-experiment-observer";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIDecisionTurn["sport"];
  status: DecisionMvpAIExperimentObserverStatus;
  observerHash: string;
  summary: string;
  target: {
    allowed: boolean;
    method: "GET" | null;
    path: string | null;
    url: string | null;
    reason: string;
  };
  interpretation: {
    hypothesis: string;
    outcome: "unobserved" | "supports" | "warns" | "contradicts" | "blocks";
    learned: string;
    risk: string;
    beliefEffect: "hold" | "support-shadow" | "warn" | "contradict" | "blocked";
    probabilityEffect: 0;
    publicActionEffect: "none";
    nextAction: string;
  };
  observation: DecisionMvpAIExperimentObservation;
  source: {
    decisionTurnHash: string;
    selectedProof: string;
    protocolHypothesis: string;
    protocolEvidenceAction: string;
  };
  controls: {
    canInspectReadOnly: true;
    canObserveProof: boolean;
    canCallOpenAI: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
  nextAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
};

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string | null | undefined, maxLength = 280): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function defaultObservation(): DecisionMvpAIExperimentObservation {
  return {
    attempted: false,
    ok: false,
    statusCode: null,
    contentType: null,
    responseHash: null,
    bodyBytes: 0,
    success: null,
    statusLabel: null,
    summary: null,
    signals: [],
    error: null
  };
}

function normalizePath(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

function hasUnsafeQuery(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("persist=1") ||
    lower.includes("persist=true") ||
    lower.includes("publish=1") ||
    lower.includes("publish=true") ||
    lower.includes("dryrun=0") ||
    lower.includes("dryrun=false") ||
    lower.includes("run=1") ||
    lower.includes("run=true") ||
    lower.includes("enhance=1") ||
    lower.includes("stake=1")
  );
}

export function resolveDecisionMvpAIExperimentTarget({
  decisionTurn,
  origin = decisionSiteOrigin()
}: {
  decisionTurn: DecisionMvpAIDecisionTurn;
  origin?: string;
}): DecisionMvpAIExperimentObserver["target"] {
  if (!decisionTurn.nextAction.safeToRun || !decisionTurn.nextAction.verifyUrl) {
    return {
      allowed: false,
      method: null,
      path: decisionTurn.nextAction.verifyUrl || null,
      url: null,
      reason: "The selected decision-turn proof is not currently safe to observe."
    };
  }

  const path = normalizePath(decisionTurn.nextAction.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: decisionTurn.nextAction.verifyUrl,
      url: null,
      reason: "The selected proof does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/mvp-ai-experiment-observer")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes can be observed by the MVP AI observer."
    };
  }

  if (hasUnsafeQuery(path)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The selected proof URL contains an unsafe write, run, publish, stake, or enhancement flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only MVP experiment proof route."
  };
}

function statusFor({
  target,
  observation
}: {
  target: DecisionMvpAIExperimentObserver["target"];
  observation: DecisionMvpAIExperimentObservation;
}): DecisionMvpAIExperimentObserverStatus {
  if (!target.allowed) return "blocked";
  if (!observation.attempted) return "ready-observation";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  if (observation.signals.some((signal) => signal.toLowerCase().includes("block") || signal.toLowerCase().includes("contradict"))) return "observed-contradiction";
  return "observed-support";
}

function interpretationFor({
  status,
  decisionTurn,
  target,
  observation
}: {
  status: DecisionMvpAIExperimentObserverStatus;
  decisionTurn: DecisionMvpAIDecisionTurn;
  target: DecisionMvpAIExperimentObserver["target"];
  observation: DecisionMvpAIExperimentObservation;
}): DecisionMvpAIExperimentObserver["interpretation"] {
  if (status === "observed-support") {
    return {
      hypothesis: decisionTurn.experimentProtocol.hypothesis,
      outcome: "supports",
      learned: compact(observation.summary ?? decisionTurn.experimentProtocol.supportSignal),
      risk: "Support is shadow-only until storage, backtest, authority, and promotion gates pass.",
      beliefEffect: "support-shadow",
      probabilityEffect: 0,
      publicActionEffect: "none",
      nextAction: "Compare this observation with the next proof coordinator run before changing any trust state."
    };
  }
  if (status === "observed-warning" || status === "failed") {
    return {
      hypothesis: decisionTurn.experimentProtocol.hypothesis,
      outcome: "warns",
      learned: compact(observation.error ?? observation.summary ?? "The proof route did not produce a clean supporting response."),
      risk: compact(decisionTurn.experimentProtocol.contradictionSignal),
      beliefEffect: "warn",
      probabilityEffect: 0,
      publicActionEffect: "none",
      nextAction: "Hold the belief and inspect the observed proof response before replaying the experiment."
    };
  }
  if (status === "observed-contradiction") {
    return {
      hypothesis: decisionTurn.experimentProtocol.hypothesis,
      outcome: "contradicts",
      learned: compact(observation.summary ?? decisionTurn.experimentProtocol.contradictionSignal),
      risk: compact(decisionTurn.experimentProtocol.contradictionSignal),
      beliefEffect: "contradict",
      probabilityEffect: 0,
      publicActionEffect: "none",
      nextAction: "Keep or lower the belief only; queue a fresh proof turn before any further action."
    };
  }
  if (status === "blocked") {
    return {
      hypothesis: decisionTurn.experimentProtocol.hypothesis,
      outcome: "blocks",
      learned: compact(target.reason),
      risk: compact(decisionTurn.experimentProtocol.stopConditions.join(" ")),
      beliefEffect: "blocked",
      probabilityEffect: 0,
      publicActionEffect: "none",
      nextAction: target.reason
    };
  }
  return {
    hypothesis: decisionTurn.experimentProtocol.hypothesis,
    outcome: "unobserved",
    learned: "No proof response has been observed yet.",
    risk: compact(decisionTurn.experimentProtocol.stopConditions.join(" ")),
    beliefEffect: "hold",
    probabilityEffect: 0,
    publicActionEffect: "none",
    nextAction: "Call this observer with run=1 to fetch the selected read-only proof route."
  };
}

function summaryFor(status: DecisionMvpAIExperimentObserverStatus, decisionTurn: DecisionMvpAIDecisionTurn): string {
  if (status === "observed-support") return `MVP AI experiment observer found support for ${decisionTurn.turn.selectedProof}; belief remains shadow-only.`;
  if (status === "observed-contradiction") return `MVP AI experiment observer found contradiction pressure for ${decisionTurn.turn.selectedProof}; public action stays locked.`;
  if (status === "observed-warning") return `MVP AI experiment observer observed ${decisionTurn.turn.selectedProof}, but the proof returned warning evidence.`;
  if (status === "failed") return `MVP AI experiment observer attempted ${decisionTurn.turn.selectedProof} and failed.`;
  if (status === "blocked") return `MVP AI experiment observer is blocked for ${decisionTurn.turn.selectedProof}.`;
  return `MVP AI experiment observer is ready to observe ${decisionTurn.turn.selectedProof} as one read-only proof.`;
}

export function buildDecisionMvpAIExperimentObserver({
  decisionTurn,
  observation,
  origin,
  now = new Date()
}: {
  decisionTurn: DecisionMvpAIDecisionTurn;
  observation?: DecisionMvpAIExperimentObservation;
  origin?: string;
  now?: Date;
}): DecisionMvpAIExperimentObserver {
  const target = resolveDecisionMvpAIExperimentTarget({ decisionTurn, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ target, observation: observed });
  const interpretation = interpretationFor({ status, decisionTurn, target, observation: observed });

  return {
    mode: "decision-mvp-ai-experiment-observer",
    generatedAt: now.toISOString(),
    date: decisionTurn.date,
    sport: decisionTurn.sport,
    status,
    observerHash: stableHash({
      status,
      decisionTurn: decisionTurn.turnHash,
      target: [target.allowed, target.path],
      observation: [observed.statusCode, observed.responseHash, observed.success, observed.statusLabel],
      interpretation: [interpretation.outcome, interpretation.beliefEffect]
    }),
    summary: summaryFor(status, decisionTurn),
    target,
    interpretation,
    observation: {
      ...observed,
      summary: observed.summary ? compact(observed.summary) : null,
      signals: unique(observed.signals, 10)
    },
    source: {
      decisionTurnHash: decisionTurn.turnHash,
      selectedProof: decisionTurn.turn.selectedProof,
      protocolHypothesis: decisionTurn.experimentProtocol.hypothesis,
      protocolEvidenceAction: decisionTurn.experimentProtocol.evidenceAction
    },
    controls: {
      canInspectReadOnly: true,
      canObserveProof: target.allowed,
      canCallOpenAI: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    nextAction: {
      label: status === "ready-observation" ? "Observe selected proof" : "Review observed proof interpretation",
      command: status === "ready-observation" && target.path ? `curl.exe -sS "${new URL(`/api/sports/decision/mvp-ai-experiment-observer?date=${encodeURIComponent(decisionTurn.date)}&sport=${encodeURIComponent(decisionTurn.sport)}&run=1`, origin ?? decisionSiteOrigin()).toString()}"` : null,
      verifyUrl: "/api/sports/decision/mvp-ai-experiment-observer",
      safeToRun: status === "ready-observation" && target.allowed,
      expectedEvidence: status === "ready-observation" ? decisionTurn.experimentProtocol.evidenceAction : interpretation.nextAction
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-experiment-observer",
      target.path,
      "/api/sports/decision/mvp-ai-decision-turn",
      ...decisionTurn.proofUrls
    ]),
    locks: unique([
      "MVP AI experiment observer is public-safe and does not expose hidden chain-of-thought.",
      "Observer may fetch one approved local GET proof route only when run=1 is requested.",
      "Observer can support, warn, contradict, block, or hold a belief; it cannot change probabilities, publish, stake, train, persist, call OpenAI, raise confidence, or write provider rows.",
      ...decisionTurn.locks
    ])
  };
}

export function summarizeDecisionMvpAIExperimentPayload(
  payload: unknown
): Pick<DecisionMvpAIExperimentObservation, "success" | "statusLabel" | "summary" | "signals"> {
  if (!payload || typeof payload !== "object") {
    return {
      success: null,
      statusLabel: null,
      summary: null,
      signals: ["Response was not a JSON object."]
    };
  }

  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : {};
  const controls = data.controls && typeof data.controls === "object" ? (data.controls as Record<string, unknown>) : null;
  const nextAction = data.nextAction && typeof data.nextAction === "object" ? (data.nextAction as Record<string, unknown>) : null;
  const statusLabel =
    typeof data.status === "string"
      ? data.status
      : typeof data.mode === "string"
        ? data.mode
        : typeof record.status === "string"
          ? record.status
          : null;
  const summary = typeof data.summary === "string" ? data.summary : typeof data.reason === "string" ? data.reason : typeof record.error === "string" ? record.error : null;
  const signals = unique([
    typeof record.success === "boolean" ? `success:${record.success}` : null,
    statusLabel ? `status:${statusLabel}` : null,
    typeof data.mode === "string" ? `mode:${data.mode}` : null,
    typeof data.queueHash === "string" ? `queue:${data.queueHash}` : null,
    typeof data.checkpointHash === "string" ? `checkpoint:${data.checkpointHash}` : null,
    typeof data.bridgeHash === "string" ? `bridge:${data.bridgeHash}` : null,
    typeof data.receiptHash === "string" ? `receipt:${data.receiptHash}` : null,
    controls && controls.canPublishPicks === true ? "block:publish-open" : null,
    controls && controls.canStake === true ? "block:stake-open" : null,
    nextAction && typeof nextAction.expectedEvidence === "string" ? `evidence:${nextAction.expectedEvidence}` : null
  ]);

  return {
    success: typeof record.success === "boolean" ? record.success : null,
    statusLabel,
    summary: summary ? compact(summary) : null,
    signals
  };
}
