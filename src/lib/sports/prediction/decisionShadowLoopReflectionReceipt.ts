import type { DecisionShadowLoopReflection, DecisionShadowLoopReflectionMoveId } from "@/lib/sports/prediction/decisionShadowLoopReflection";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowLoopReflectionReceiptStatus = "not-run" | "verified" | "observed-warning" | "blocked" | "failed";

export type DecisionShadowLoopReflectionReceiptTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionShadowLoopReflectionObservation = {
  attempted: boolean;
  ok: boolean;
  statusCode: number | null;
  contentType: string | null;
  responseHash: string | null;
  bodyBytes: number;
  success: boolean | null;
  mode: string | null;
  statusLabel: string | null;
  summary: string | null;
  signals: string[];
  error: string | null;
};

export type DecisionShadowLoopReflectionReceipt = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopReflection["sport"];
  mode: "decision-shadow-loop-reflection-receipt";
  status: DecisionShadowLoopReflectionReceiptStatus;
  receiptHash: string;
  reflectionHash: string;
  summary: string;
  selectedMove: {
    id: DecisionShadowLoopReflectionMoveId | null;
    label: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
    reason: string | null;
  };
  target: DecisionShadowLoopReflectionReceiptTarget;
  observation: DecisionShadowLoopReflectionObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canObserveSelectedMove: boolean;
    canExecuteShell: false;
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
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

type DecisionFetch = (input: URL | string, init?: RequestInit) => Promise<Response>;

function stableHash(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
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

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePath(value: string | null): string | null {
  const trimmed = value?.trim();
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

function allowsRunFlag(path: string, moveId: DecisionShadowLoopReflectionMoveId): boolean {
  const lower = path.toLowerCase();
  if (!lower.includes("run=1") && !lower.includes("run=true")) return true;
  if (moveId === "observe-loop-receipt") return lower.includes("/shadow-loop-receipt");
  if (moveId === "refresh-governor") return lower.includes("/shadow-loop-governor");
  return false;
}

function hasUnsafeQuery(path: string, moveId: DecisionShadowLoopReflectionMoveId): boolean {
  const lower = path.toLowerCase();
  if (!allowsRunFlag(path, moveId)) return true;
  return (
    lower.includes("persist=1") ||
    lower.includes("persist=true") ||
    lower.includes("dryrun=0") ||
    lower.includes("dryrun=false") ||
    lower.includes("review=1") ||
    lower.includes("review=true") ||
    lower.includes("agent=1") ||
    lower.includes("enhance=1") ||
    lower.includes("publish=1") ||
    lower.includes("train=1") ||
    lower.includes("stake=1") ||
    lower.includes("deploy")
  );
}

export function resolveDecisionShadowLoopReflectionReceiptTarget({
  reflection,
  origin = decisionSiteOrigin()
}: {
  reflection: DecisionShadowLoopReflection;
  origin?: string;
}): DecisionShadowLoopReflectionReceiptTarget {
  const move = reflection.nextMove;
  if (!move) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No shadow loop reflection move is selected."
    };
  }

  if (!reflection.controls.canRunNextReadOnlyMove || !move.safeToRun || !move.command) {
    return {
      allowed: false,
      method: null,
      path: move.verifyUrl,
      url: null,
      reason: "The selected reflection move is not currently safe to observe."
    };
  }

  const path = normalizePath(move.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: move.verifyUrl,
      url: null,
      reason: "The selected reflection move does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/shadow-loop-reflection-receipt")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only non-recursive local sports decision proof routes can be observed by the shadow loop reflection receipt."
    };
  }

  if (hasUnsafeQuery(path, move.id)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The reflection proof URL contains a write, AI-run, persistence, publishing, training, staking, deploy, or unsafe run flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only reflection-selected proof route."
  };
}

function defaultObservation(): DecisionShadowLoopReflectionObservation {
  return {
    attempted: false,
    ok: false,
    statusCode: null,
    contentType: null,
    responseHash: null,
    bodyBytes: 0,
    success: null,
    mode: null,
    statusLabel: null,
    summary: null,
    signals: [],
    error: null
  };
}

function summarizePayload(payload: unknown): Pick<DecisionShadowLoopReflectionObservation, "success" | "mode" | "statusLabel" | "summary" | "signals"> {
  if (!payload || typeof payload !== "object") {
    return {
      success: null,
      mode: null,
      statusLabel: null,
      summary: null,
      signals: ["Response was not a JSON object."]
    };
  }

  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? (record.data as Record<string, unknown>) : {};
  const controls = data.controls && typeof data.controls === "object" ? (data.controls as Record<string, unknown>) : null;
  const target = data.target && typeof data.target === "object" ? (data.target as Record<string, unknown>) : null;
  const observation = data.observation && typeof data.observation === "object" ? (data.observation as Record<string, unknown>) : null;
  const selectedMove = data.selectedMove && typeof data.selectedMove === "object" ? (data.selectedMove as Record<string, unknown>) : null;
  const selectedIntent = data.selectedIntent && typeof data.selectedIntent === "object" ? (data.selectedIntent as Record<string, unknown>) : null;
  const mode = stringValue(data.mode);
  const statusLabel = stringValue(data.status) ?? stringValue(record.status);
  const summary = stringValue(data.summary) ?? stringValue(record.error);

  return {
    success: typeof record.success === "boolean" ? record.success : null,
    mode,
    statusLabel,
    summary: summary ? compact(summary) : null,
    signals: unique([
      typeof record.success === "boolean" ? `success:${record.success}` : null,
      mode ? `mode:${mode}` : null,
      statusLabel ? `status:${statusLabel}` : null,
      selectedMove ? `move:${stringValue(selectedMove.id) ?? stringValue(selectedMove.label) ?? "selected"}` : null,
      selectedIntent ? `intent:${stringValue(selectedIntent.id) ?? stringValue(selectedIntent.label) ?? "selected"}` : null,
      target && typeof target.allowed === "boolean" ? `target:${target.allowed}` : null,
      observation && typeof observation.responseHash === "string" ? `proof:${observation.responseHash}` : null,
      controls && typeof controls.canPersistMemory === "boolean" ? `persist:${controls.canPersistMemory}` : null,
      controls && typeof controls.canAdjustProbabilities === "boolean" ? `adjust:${controls.canAdjustProbabilities}` : null,
      controls && typeof controls.canPublishPicks === "boolean" ? `publish:${controls.canPublishPicks}` : null,
      controls && typeof controls.canTrainModels === "boolean" ? `train:${controls.canTrainModels}` : null,
      controls && typeof controls.canStake === "boolean" ? `stake:${controls.canStake}` : null
    ])
  };
}

async function fetchJsonText(url: string, fetchImpl: DecisionFetch): Promise<DecisionShadowLoopReflectionObservation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    const summary = summarizePayload(parsed);

    return {
      attempted: true,
      ok: response.ok,
      statusCode: response.status,
      contentType: response.headers.get("content-type"),
      responseHash: stableHash(text),
      bodyBytes: text.length,
      success: summary.success,
      mode: summary.mode,
      statusLabel: summary.statusLabel,
      summary: summary.summary,
      signals: summary.signals,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      attempted: true,
      ok: false,
      statusCode: null,
      contentType: null,
      responseHash: null,
      bodyBytes: 0,
      success: null,
      mode: null,
      statusLabel: null,
      summary: null,
      signals: [],
      error: error instanceof Error ? error.message : "Shadow loop reflection receipt fetch failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function statusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionShadowLoopReflectionReceiptTarget;
  observation: DecisionShadowLoopReflectionObservation;
}): DecisionShadowLoopReflectionReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "verified";
}

function summaryFor(
  status: DecisionShadowLoopReflectionReceiptStatus,
  reflection: DecisionShadowLoopReflection,
  target: DecisionShadowLoopReflectionReceiptTarget,
  observation: DecisionShadowLoopReflectionObservation
): string {
  if (status === "verified") return `Shadow loop reflection receipt observed ${reflection.nextMove.label} with response ${observation.responseHash ?? "unhashed"}.`;
  if (status === "observed-warning") return "Shadow loop reflection receipt observed the selected move, but the response needs review.";
  if (status === "failed") return `Shadow loop reflection receipt attempted the selected move and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `Shadow loop reflection receipt is blocked: ${target.reason}`;
  return `Shadow loop reflection receipt is ready to observe ${reflection.nextMove.label} when run=1 is requested.`;
}

export function buildDecisionShadowLoopReflectionReceipt({
  reflection,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  reflection: DecisionShadowLoopReflection;
  runRequested?: boolean;
  observation?: DecisionShadowLoopReflectionObservation;
  origin?: string;
  now?: Date;
}): DecisionShadowLoopReflectionReceipt {
  const target = resolveDecisionShadowLoopReflectionReceiptTarget({ reflection, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const move = reflection.nextMove;
  const receiptHash = stableHash({
    date: reflection.date,
    sport: reflection.sport,
    reflection: reflection.reflectionHash,
    status,
    runRequested,
    selectedMove: [move.id, move.safeToRun, move.verifyUrl],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.mode, observed.statusLabel]
  });

  return {
    generatedAt: now.toISOString(),
    date: reflection.date,
    sport: reflection.sport,
    mode: "decision-shadow-loop-reflection-receipt",
    status,
    receiptHash,
    reflectionHash: reflection.reflectionHash,
    summary: summaryFor(status, reflection, target, observed),
    selectedMove: {
      id: move.id,
      label: move.label,
      verifyUrl: move.verifyUrl,
      safeToRun: move.safeToRun,
      reason: move.reason
    },
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "The reflection-selected proof route returns a JSON success envelope.",
        "The receipt records response hash, status, mode, selected move, and public signals.",
        "Observation does not execute shell, persist memory, train, publish picks, stake, adjust probabilities, upgrade public action, or expose hidden chain-of-thought."
      ],
      failureSignals: ["HTTP failure", "unsafe reflection proof URL", "recursive receipt target", "write flag", "non-success envelope"],
      fallbackAction: "Keep the shadow loop reflection in read-only hold and inspect the selected move manually."
    },
    controls: {
      canObserveSelectedMove: target.allowed,
      canExecuteShell: false,
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/shadow-loop-reflection-receipt",
      "/api/sports/decision/shadow-loop-reflection",
      target.path,
      ...reflection.proofUrls
    ]),
    locks: unique([
      "Shadow loop reflection receipt observes one reflection-approved local GET route only.",
      "It never executes shell commands and cannot persist, train, publish, stake, adjust probability, raise confidence, or upgrade public action.",
      "Nested run=1 is allowed only for the reflection-selected loop receipt or governor refresh move.",
      "Observed output is a public response hash and signal list, not private reasoning.",
      ...reflection.locks
    ])
  };
}

export async function observeDecisionShadowLoopReflectionReceipt({
  reflection,
  runRequested = false,
  origin,
  fetchImpl = fetch as DecisionFetch,
  now = new Date()
}: {
  reflection: DecisionShadowLoopReflection;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: DecisionFetch;
  now?: Date;
}): Promise<DecisionShadowLoopReflectionReceipt> {
  const preview = buildDecisionShadowLoopReflectionReceipt({ reflection, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;
  const observation = await fetchJsonText(preview.target.url, fetchImpl);
  return buildDecisionShadowLoopReflectionReceipt({ reflection, runRequested, observation, origin, now });
}
