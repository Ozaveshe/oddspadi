import type { DecisionShadowLoopContinuity, DecisionShadowLoopContinuityMoveId } from "@/lib/sports/prediction/decisionShadowLoopContinuity";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowLoopContinuityReceiptStatus = "not-run" | "verified" | "observed-warning" | "blocked" | "failed";

export type DecisionShadowLoopContinuityReceiptTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionShadowLoopContinuityObservation = {
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

export type DecisionShadowLoopContinuityReceipt = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopContinuity["sport"];
  mode: "decision-shadow-loop-continuity-receipt";
  status: DecisionShadowLoopContinuityReceiptStatus;
  receiptHash: string;
  continuityHash: string;
  summary: string;
  selectedMove: {
    id: DecisionShadowLoopContinuityMoveId | null;
    label: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
    reason: string | null;
  };
  target: DecisionShadowLoopContinuityReceiptTarget;
  observation: DecisionShadowLoopContinuityObservation;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
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

function allowsRunFlag(path: string, moveId: DecisionShadowLoopContinuityMoveId): boolean {
  const lower = path.toLowerCase();
  if (!lower.includes("run=1") && !lower.includes("run=true")) return true;
  if (moveId === "observe-reflection-receipt") return lower.includes("/shadow-loop-reflection-receipt");
  if (moveId === "reflect-again") return lower.includes("/shadow-loop-reflection");
  return false;
}

function hasUnsafeQuery(path: string, moveId: DecisionShadowLoopContinuityMoveId): boolean {
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

export function resolveDecisionShadowLoopContinuityReceiptTarget({
  continuity,
  origin = decisionSiteOrigin()
}: {
  continuity: DecisionShadowLoopContinuity;
  origin?: string;
}): DecisionShadowLoopContinuityReceiptTarget {
  const move = continuity.nextMove;
  if (!move) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No shadow loop continuity move is selected."
    };
  }

  if (!continuity.controls.canRunNextReadOnlyMove || !move.safeToRun || !move.command) {
    return {
      allowed: false,
      method: null,
      path: move.verifyUrl,
      url: null,
      reason: "The selected continuity move is not currently safe to observe."
    };
  }

  const path = normalizePath(move.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: move.verifyUrl,
      url: null,
      reason: "The selected continuity move does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/shadow-loop-continuity-receipt")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only non-recursive local sports decision proof routes can be observed by the shadow loop continuity receipt."
    };
  }

  if (hasUnsafeQuery(path, move.id)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The continuity proof URL contains a write, AI-run, persistence, publishing, training, staking, deploy, or unsafe run flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only continuity-selected proof route."
  };
}

function defaultObservation(): DecisionShadowLoopContinuityObservation {
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

function summarizePayload(payload: unknown): Pick<DecisionShadowLoopContinuityObservation, "success" | "mode" | "statusLabel" | "summary" | "signals"> {
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
  const nextMove = data.nextMove && typeof data.nextMove === "object" ? (data.nextMove as Record<string, unknown>) : null;
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
      nextMove ? `next:${stringValue(nextMove.id) ?? stringValue(nextMove.label) ?? "selected"}` : null,
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

async function fetchJsonText(url: string, fetchImpl: DecisionFetch): Promise<DecisionShadowLoopContinuityObservation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

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
      error: error instanceof Error ? error.message : "Shadow loop continuity receipt fetch failed."
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
  target: DecisionShadowLoopContinuityReceiptTarget;
  observation: DecisionShadowLoopContinuityObservation;
}): DecisionShadowLoopContinuityReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "verified";
}

function summaryFor(
  status: DecisionShadowLoopContinuityReceiptStatus,
  continuity: DecisionShadowLoopContinuity,
  target: DecisionShadowLoopContinuityReceiptTarget,
  observation: DecisionShadowLoopContinuityObservation
): string {
  if (status === "verified") return `Shadow loop continuity receipt observed ${continuity.nextMove.label} with response ${observation.responseHash ?? "unhashed"}.`;
  if (status === "observed-warning") return "Shadow loop continuity receipt observed the selected move, but the response needs review.";
  if (status === "failed") return `Shadow loop continuity receipt attempted the selected move and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `Shadow loop continuity receipt is blocked: ${target.reason}`;
  return `Shadow loop continuity receipt is ready to observe ${continuity.nextMove.label} when run=1 is requested.`;
}

export function buildDecisionShadowLoopContinuityReceipt({
  continuity,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  continuity: DecisionShadowLoopContinuity;
  runRequested?: boolean;
  observation?: DecisionShadowLoopContinuityObservation;
  origin?: string;
  now?: Date;
}): DecisionShadowLoopContinuityReceipt {
  const target = resolveDecisionShadowLoopContinuityReceiptTarget({ continuity, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const move = continuity.nextMove;
  const receiptHash = stableHash({
    date: continuity.date,
    sport: continuity.sport,
    continuity: continuity.continuityHash,
    status,
    runRequested,
    selectedMove: [move.id, move.safeToRun, move.verifyUrl],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.mode, observed.statusLabel]
  });

  return {
    generatedAt: now.toISOString(),
    date: continuity.date,
    sport: continuity.sport,
    mode: "decision-shadow-loop-continuity-receipt",
    status,
    receiptHash,
    continuityHash: continuity.continuityHash,
    summary: summaryFor(status, continuity, target, observed),
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
        "The continuity-selected proof route returns a JSON success envelope.",
        "The receipt records response hash, status, mode, selected move, target, and public signals.",
        "Observation does not execute shell, persist memory, train, publish picks, stake, adjust probabilities, upgrade public action, or expose hidden chain-of-thought."
      ],
      failureSignals: ["HTTP failure", "unsafe continuity proof URL", "recursive receipt target", "write flag", "non-success envelope"],
      fallbackAction: "Keep the shadow loop continuity in read-only hold and inspect the selected move manually."
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
      "/api/sports/decision/shadow-loop-continuity-receipt",
      "/api/sports/decision/shadow-loop-continuity",
      target.path,
      ...continuity.proofUrls
    ]),
    locks: unique([
      "Shadow loop continuity receipt observes one continuity-approved local GET route only.",
      "It never executes shell commands and cannot persist, train, publish, stake, adjust probability, raise confidence, or upgrade public action.",
      "Nested run=1 is allowed only for the continuity-selected reflection receipt or reflection move.",
      "Observed output is a public response hash and signal list, not private reasoning.",
      ...continuity.locks
    ])
  };
}

export async function observeDecisionShadowLoopContinuityReceipt({
  continuity,
  runRequested = false,
  origin,
  fetchImpl = fetch as DecisionFetch,
  now = new Date()
}: {
  continuity: DecisionShadowLoopContinuity;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: DecisionFetch;
  now?: Date;
}): Promise<DecisionShadowLoopContinuityReceipt> {
  const preview = buildDecisionShadowLoopContinuityReceipt({ continuity, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;
  const observation = await fetchJsonText(preview.target.url, fetchImpl);
  return buildDecisionShadowLoopContinuityReceipt({ continuity, runRequested, observation, origin, now });
}
