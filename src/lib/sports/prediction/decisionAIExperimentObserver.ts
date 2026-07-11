import type { DecisionAIExperimentCandidate, DecisionAIExperimentPlanner } from "@/lib/sports/prediction/decisionAIExperimentPlanner";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionAIExperimentObservationStatus = "not-run" | "observed" | "observed-warning" | "blocked" | "failed";

export type DecisionAIExperimentObservationTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionAIExperimentObservation = {
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

export type DecisionAIExperimentObserver = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-experiment-observer";
  status: DecisionAIExperimentObservationStatus;
  observerHash: string;
  plannerHash: string;
  summary: string;
  selectedExperiment: DecisionAIExperimentCandidate | null;
  target: DecisionAIExperimentObservationTarget;
  observation: DecisionAIExperimentObservation;
  verification: {
    requested: boolean;
    expectedEvidence: string | null;
    hypothesis: string | null;
    falsifier: string | null;
    outcome: "unobserved" | "supports" | "warns" | "blocks";
    nextAction: string;
  };
  controls: {
    canObserveProof: boolean;
    canExecuteShell: false;
    canAskOpenAI: false;
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
  const text = typeof value === "string" ? value : JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
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
    lower.includes("review=1") ||
    lower.includes("review=true") ||
    lower.includes("agent=1") ||
    lower.includes("enhance=1")
  );
}

function defaultObservation(): DecisionAIExperimentObservation {
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

export function resolveDecisionAIExperimentTarget({
  planner,
  origin = decisionSiteOrigin()
}: {
  planner: DecisionAIExperimentPlanner;
  origin?: string;
}): DecisionAIExperimentObservationTarget {
  const experiment = planner.selectedExperiment;
  if (!experiment) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No experiment is selected for observation."
    };
  }

  if (!experiment.canRunNow || experiment.runMode === "manual-only") {
    return {
      allowed: false,
      method: null,
      path: experiment.verifyUrl,
      url: null,
      reason: "The selected experiment is not currently safe to observe."
    };
  }

  const path = normalizePath(experiment.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: experiment.verifyUrl,
      url: null,
      reason: "The selected experiment does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/ai-experiment-observer")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes can be observed by the experiment observer."
    };
  }

  if (hasUnsafeQuery(path)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The proof URL contains a write, publish, AI-review, or unsafe dry-run flag."
    };
  }

  const url = new URL(path, origin);
  return {
    allowed: true,
    method: "GET",
    path,
    url: url.toString(),
    reason: "Approved local read-only experiment proof route."
  };
}

function statusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionAIExperimentObservationTarget;
  observation: DecisionAIExperimentObservation;
}): DecisionAIExperimentObservationStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "observed";
}

function outcomeFor(status: DecisionAIExperimentObservationStatus): DecisionAIExperimentObserver["verification"]["outcome"] {
  if (status === "observed") return "supports";
  if (status === "observed-warning" || status === "failed") return "warns";
  if (status === "blocked") return "blocks";
  return "unobserved";
}

function summaryFor({
  status,
  planner,
  target,
  observation
}: {
  status: DecisionAIExperimentObservationStatus;
  planner: DecisionAIExperimentPlanner;
  target: DecisionAIExperimentObservationTarget;
  observation: DecisionAIExperimentObservation;
}): string {
  const label = planner.selectedExperiment?.label ?? "the selected experiment";
  if (status === "observed") return `AI experiment observer verified ${label} with response ${observation.responseHash ?? "unhashed"}.`;
  if (status === "observed-warning") return `AI experiment observer fetched ${label}, but the response was not a clean success.`;
  if (status === "failed") return `AI experiment observer attempted ${label} and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `AI experiment observer is blocked: ${target.reason}`;
  return `AI experiment observer is ready to fetch ${label} when run=1 is requested.`;
}

export function buildDecisionAIExperimentObserver({
  planner,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  planner: DecisionAIExperimentPlanner;
  runRequested?: boolean;
  observation?: DecisionAIExperimentObservation;
  origin?: string;
  now?: Date;
}): DecisionAIExperimentObserver {
  const target = resolveDecisionAIExperimentTarget({ planner, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const experiment = planner.selectedExperiment;
  const observerHash = stableHash({
    planner: planner.plannerHash,
    experiment: experiment?.id,
    status,
    target: [target.path, target.allowed],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.statusLabel]
  });
  const outcome = outcomeFor(status);

  return {
    generatedAt: now.toISOString(),
    date: planner.date,
    sport: planner.sport,
    mode: "ai-experiment-observer",
    status,
    observerHash,
    plannerHash: planner.plannerHash,
    summary: summaryFor({ status, planner, target, observation: observed }),
    selectedExperiment: experiment,
    target,
    observation: {
      ...observed,
      summary: observed.summary ? compact(observed.summary) : null,
      signals: unique(observed.signals, 8)
    },
    verification: {
      requested: runRequested,
      expectedEvidence: experiment?.expectedEvidence ?? null,
      hypothesis: experiment?.hypothesis ?? null,
      falsifier: experiment?.falsifier ?? null,
      outcome,
      nextAction:
        outcome === "supports"
          ? "Compare the response hash with the next planner run before changing any trust state."
          : outcome === "warns"
            ? "Hold trust and inspect the observed response before replaying the experiment."
            : outcome === "blocks"
              ? target.reason
              : "Call this observer with run=1 to fetch the selected read-only proof route."
    },
    controls: {
      canObserveProof: target.allowed,
      canExecuteShell: false,
      canAskOpenAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    },
    locks: unique(
      [
        ...planner.forbiddenActions,
        "Observer may only fetch approved local GET proof routes.",
        "Observer must not execute shell commands, call OpenAI, write Supabase rows, publish picks, or train models."
      ],
      14
    ),
    proofUrls: unique(["/api/sports/decision/ai-experiment-observer", "/api/sports/decision/ai-experiment-planner", target.path, ...planner.proofUrls], 32)
  };
}

export function summarizeDecisionAIExperimentPayload(
  payload: unknown
): Pick<DecisionAIExperimentObservation, "success" | "statusLabel" | "summary" | "signals"> {
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
  const counts = data.counts && typeof data.counts === "object" ? (data.counts as Record<string, unknown>) : null;
  const memoryDecision = data.memoryDecision && typeof data.memoryDecision === "object" ? (data.memoryDecision as Record<string, unknown>) : null;
  const selected = data.selectedExperiment && typeof data.selectedExperiment === "object" ? (data.selectedExperiment as Record<string, unknown>) : null;

  const statusLabel =
    typeof data.status === "string"
      ? data.status
      : typeof data.verdict === "string"
        ? data.verdict
        : typeof record.status === "string"
          ? record.status
          : null;
  const summary = typeof data.summary === "string" ? data.summary : typeof data.reason === "string" ? data.reason : typeof record.error === "string" ? record.error : null;
  const signals = unique([
    typeof record.success === "boolean" ? `success:${record.success}` : null,
    statusLabel ? `status:${statusLabel}` : null,
    typeof data.mode === "string" ? `mode:${data.mode}` : null,
    typeof data.plannerHash === "string" ? `planner:${data.plannerHash}` : null,
    typeof data.thoughtHash === "string" ? `thought:${data.thoughtHash}` : null,
    memoryDecision && typeof memoryDecision.influence === "string" ? `memory:${memoryDecision.influence}` : null,
    selected && typeof selected.id === "string" ? `selected:${selected.id}` : null,
    counts ? `counts:${Object.entries(counts).map(([key, value]) => `${key}=${value}`).join(",")}` : null
  ]);

  return {
    success: typeof record.success === "boolean" ? record.success : null,
    statusLabel,
    summary: summary ? compact(summary) : null,
    signals
  };
}
