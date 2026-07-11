import type { DecisionOperatorTurn } from "@/lib/sports/prediction/decisionOperatorTurn";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionOperatorReceiptStatus = "not-run" | "verified" | "observed-warning" | "blocked" | "failed";

export type DecisionOperatorProofTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionOperatorProofObservation = {
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

export type DecisionOperatorReceipt = {
  generatedAt: string;
  date: string;
  sport: DecisionOperatorTurn["sport"];
  mode: "operator-proof-receipt";
  status: DecisionOperatorReceiptStatus;
  receiptHash: string;
  turnHash: string;
  summary: string;
  objective: DecisionOperatorTurn["objective"];
  operation: {
    label: string | null;
    source: string | null;
    runMode: DecisionOperatorTurn["nextOperation"] extends infer Operation
      ? Operation extends { runMode: infer Mode }
        ? Mode
        : "manual-only"
      : "manual-only";
    command: string | null;
    verifyUrl: string | null;
  };
  target: DecisionOperatorProofTarget;
  observation: DecisionOperatorProofObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  statePatch: DecisionOperatorTurn["statePatch"];
  permissions: {
    canObserveProof: boolean;
    canExecuteShell: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function unique(values: Array<string | null | undefined>, limit = 10): string[] {
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
    lower.includes("dryrun=0") ||
    lower.includes("dryrun=false") ||
    lower.includes("run=1") ||
    lower.includes("run=true") ||
    lower.includes("review=1") ||
    lower.includes("review=true") ||
    lower.includes("agent=1") ||
    lower.includes("enhance=1")
  );
}

export function resolveDecisionOperatorProofTarget({
  turn,
  origin = decisionSiteOrigin()
}: {
  turn: DecisionOperatorTurn;
  origin?: string;
}): DecisionOperatorProofTarget {
  const operation = turn.nextOperation;
  if (!operation) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No operator operation is selected for this turn."
    };
  }

  if (!turn.permissions.canRunCommand || !operation.safeToRun || operation.runMode === "manual-only") {
    return {
      allowed: false,
      method: null,
      path: operation.verifyUrl,
      url: null,
      reason: "The selected operation is not currently safe to observe."
    };
  }

  const path = operation.verifyUrl ? normalizePath(operation.verifyUrl) : null;
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: operation.verifyUrl,
      url: null,
      reason: "The selected operation does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/operator-receipt")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes can be observed by the receipt runner."
    };
  }

  if (hasUnsafeQuery(path)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The proof URL contains a write, AI-run, persistence, or unsafe dry-run flag."
    };
  }

  const url = new URL(path, origin);
  return {
    allowed: true,
    method: "GET",
    path,
    url: url.toString(),
    reason: "Approved local read-only proof route."
  };
}

function defaultObservation(): DecisionOperatorProofObservation {
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

function statusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionOperatorProofTarget;
  observation: DecisionOperatorProofObservation;
}): DecisionOperatorReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "verified";
}

function summaryFor(status: DecisionOperatorReceiptStatus, turn: DecisionOperatorTurn, target: DecisionOperatorProofTarget, observation: DecisionOperatorProofObservation): string {
  if (status === "verified") {
    return `Operator receipt verified ${turn.nextOperation?.label ?? "the selected proof"} with response ${observation.responseHash ?? "unhashed"}.`;
  }
  if (status === "observed-warning") {
    return `Operator receipt observed the proof route, but the response was not a clean success.`;
  }
  if (status === "failed") {
    return `Operator receipt attempted the proof route and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  }
  if (status === "blocked") {
    return `Operator receipt is blocked: ${target.reason}`;
  }
  return `Operator receipt is ready to observe ${turn.nextOperation?.label ?? "the selected proof"} when run=1 is requested.`;
}

export function buildDecisionOperatorReceipt({
  turn,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  turn: DecisionOperatorTurn;
  runRequested?: boolean;
  observation?: DecisionOperatorProofObservation;
  origin?: string;
  now?: Date;
}): DecisionOperatorReceipt {
  const target = resolveDecisionOperatorProofTarget({ turn, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const receiptHash = stableHash({
    date: turn.date,
    sport: turn.sport,
    turnHash: turn.turnHash,
    status,
    target: [target.path, target.allowed],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.statusLabel]
  });

  return {
    generatedAt: now.toISOString(),
    date: turn.date,
    sport: turn.sport,
    mode: "operator-proof-receipt",
    status,
    receiptHash,
    turnHash: turn.turnHash,
    summary: summaryFor(status, turn, target, observed),
    objective: turn.objective,
    operation: {
      label: turn.nextOperation?.label ?? null,
      source: turn.nextOperation?.source ?? null,
      runMode: turn.nextOperation?.runMode ?? "manual-only",
      command: turn.nextOperation?.command ?? null,
      verifyUrl: turn.nextOperation?.verifyUrl ?? null
    },
    target,
    observation: {
      ...observed,
      summary: observed.summary ? compact(observed.summary) : null,
      signals: unique(observed.signals, 8)
    },
    verification: {
      requested: runRequested,
      successCriteria: unique([
        ...turn.verification.successCriteria,
        target.allowed ? `Receipt runner can fetch ${target.path}.` : null,
        "Receipt must not execute shell commands, write Supabase rows, publish picks, or train models."
      ]),
      failureSignals: unique([target.allowed ? null : target.reason, ...turn.verification.failureSignals, observed.error]),
      fallbackAction: status === "failed" || status === "observed-warning" ? "Hold the turn state and rerun operator-turn plus the proof route manually." : turn.verification.fallbackAction
    },
    statePatch: turn.statePatch,
    permissions: {
      canObserveProof: target.allowed,
      canExecuteShell: false,
      canPersist: false,
      canPublish: false,
      canTrain: false
    },
    locks: unique(
      [
        ...turn.locks,
        "Receipt runner may only fetch approved local GET proof routes.",
        "Receipt runner must not execute shell commands or POST write operations."
      ],
      14
    ),
    proofUrls: unique(["/api/sports/decision/operator-receipt", "/api/sports/decision/operator-turn", target.path, ...turn.proofUrls])
  };
}
