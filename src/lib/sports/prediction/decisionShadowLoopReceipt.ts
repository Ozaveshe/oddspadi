import type { DecisionShadowLoopGovernor, DecisionShadowLoopGovernorIntentId } from "@/lib/sports/prediction/decisionShadowLoopGovernor";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowLoopReceiptStatus = "not-run" | "verified" | "observed-warning" | "blocked" | "failed";

export type DecisionShadowLoopReceiptTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionShadowLoopObservation = {
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

export type DecisionShadowLoopReceipt = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowLoopGovernor["sport"];
  mode: "decision-shadow-loop-receipt";
  status: DecisionShadowLoopReceiptStatus;
  receiptHash: string;
  governorHash: string;
  summary: string;
  selectedIntent: {
    id: DecisionShadowLoopGovernorIntentId | null;
    label: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
    expectedEvidence: string | null;
  };
  target: DecisionShadowLoopReceiptTarget;
  observation: DecisionShadowLoopObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canObserveSelectedIntent: boolean;
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

function hasUnsafeQuery(path: string, selectedIntentId: DecisionShadowLoopGovernorIntentId): boolean {
  const lower = path.toLowerCase();
  const allowsNestedReceiptRun =
    selectedIntentId === "observe-receipt" &&
    lower.includes("/shadow-next-cycle-receipt") &&
    (lower.includes("run=1") || lower.includes("run=true"));

  if (!allowsNestedReceiptRun && (lower.includes("run=1") || lower.includes("run=true"))) return true;

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

export function resolveDecisionShadowLoopReceiptTarget({
  governor,
  origin = decisionSiteOrigin()
}: {
  governor: DecisionShadowLoopGovernor;
  origin?: string;
}): DecisionShadowLoopReceiptTarget {
  const intent = governor.selectedIntent;
  if (!intent) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No shadow loop governor intent is selected."
    };
  }

  if (!governor.controls.canRunSelectedCommand || !intent.safeToRun || !intent.command) {
    return {
      allowed: false,
      method: null,
      path: intent.verifyUrl,
      url: null,
      reason: "The selected shadow loop intent is not currently safe to observe."
    };
  }

  const path = normalizePath(intent.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: intent.verifyUrl,
      url: null,
      reason: "The selected governor intent does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/shadow-loop-receipt")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only non-recursive local sports decision proof routes can be observed by the shadow loop receipt."
    };
  }

  if (hasUnsafeQuery(path, intent.id)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The governor proof URL contains a write, AI-run, persistence, publishing, training, staking, deploy, or unsafe run flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only governor-selected proof route."
  };
}

function defaultObservation(): DecisionShadowLoopObservation {
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

function summarizePayload(payload: unknown): Pick<DecisionShadowLoopObservation, "success" | "mode" | "statusLabel" | "summary" | "signals"> {
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
  const selectedIntent = data.selectedIntent && typeof data.selectedIntent === "object" ? (data.selectedIntent as Record<string, unknown>) : null;
  const selectedStep = data.selectedStep && typeof data.selectedStep === "object" ? (data.selectedStep as Record<string, unknown>) : null;
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
      selectedIntent ? `intent:${stringValue(selectedIntent.id) ?? stringValue(selectedIntent.label) ?? "selected"}` : null,
      selectedStep ? `step:${stringValue(selectedStep.id) ?? stringValue(selectedStep.label) ?? "selected"}` : null,
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

async function fetchJsonText(url: string, fetchImpl: DecisionFetch): Promise<DecisionShadowLoopObservation> {
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
      error: error instanceof Error ? error.message : "Shadow loop receipt fetch failed."
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
  target: DecisionShadowLoopReceiptTarget;
  observation: DecisionShadowLoopObservation;
}): DecisionShadowLoopReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "verified";
}

function summaryFor(
  status: DecisionShadowLoopReceiptStatus,
  governor: DecisionShadowLoopGovernor,
  target: DecisionShadowLoopReceiptTarget,
  observation: DecisionShadowLoopObservation
): string {
  if (status === "verified") return `Shadow loop receipt observed ${governor.selectedIntent.label} with response ${observation.responseHash ?? "unhashed"}.`;
  if (status === "observed-warning") return "Shadow loop receipt observed the governor-selected intent, but the response needs review.";
  if (status === "failed") return `Shadow loop receipt attempted the governor-selected intent and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `Shadow loop receipt is blocked: ${target.reason}`;
  return `Shadow loop receipt is ready to observe ${governor.selectedIntent.label} when run=1 is requested.`;
}

export function buildDecisionShadowLoopReceipt({
  governor,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  governor: DecisionShadowLoopGovernor;
  runRequested?: boolean;
  observation?: DecisionShadowLoopObservation;
  origin?: string;
  now?: Date;
}): DecisionShadowLoopReceipt {
  const target = resolveDecisionShadowLoopReceiptTarget({ governor, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const intent = governor.selectedIntent;
  const receiptHash = stableHash({
    date: governor.date,
    sport: governor.sport,
    governor: governor.governorHash,
    status,
    runRequested,
    selectedIntent: [intent.id, intent.safeToRun, intent.verifyUrl, intent.utility.score],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.mode, observed.statusLabel]
  });

  return {
    generatedAt: now.toISOString(),
    date: governor.date,
    sport: governor.sport,
    mode: "decision-shadow-loop-receipt",
    status,
    receiptHash,
    governorHash: governor.governorHash,
    summary: summaryFor(status, governor, target, observed),
    selectedIntent: {
      id: intent.id,
      label: intent.label,
      verifyUrl: intent.verifyUrl,
      safeToRun: intent.safeToRun,
      expectedEvidence: intent.expectedEvidence
    },
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "The governor-selected proof route returns a JSON success envelope.",
        "The receipt records response hash, status, mode, selected intent, and public signals.",
        "Observation does not execute shell, persist memory, train, publish picks, stake, adjust probabilities, upgrade public action, or expose hidden chain-of-thought."
      ],
      failureSignals: ["HTTP failure", "unsafe governor proof URL", "recursive receipt target", "write flag", "non-success envelope"],
      fallbackAction: "Keep the shadow loop governor in read-only hold and inspect the selected intent manually."
    },
    controls: {
      canObserveSelectedIntent: target.allowed,
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
    proofUrls: unique(["/api/sports/decision/shadow-loop-receipt", "/api/sports/decision/shadow-loop-governor", target.path, ...governor.proofUrls]),
    locks: unique([
      "Shadow loop receipt observes one governor-approved local GET route only.",
      "It never executes shell commands and cannot persist, train, publish, stake, adjust probability, raise confidence, or upgrade public action.",
      "Nested run=1 is allowed only for the selected shadow next-cycle receipt observation intent.",
      "Observed output is a public response hash and signal list, not private reasoning.",
      ...governor.locks
    ])
  };
}

export async function observeDecisionShadowLoopReceipt({
  governor,
  runRequested = false,
  origin,
  fetchImpl = fetch as DecisionFetch,
  now = new Date()
}: {
  governor: DecisionShadowLoopGovernor;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: DecisionFetch;
  now?: Date;
}): Promise<DecisionShadowLoopReceipt> {
  const preview = buildDecisionShadowLoopReceipt({ governor, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;
  const observation = await fetchJsonText(preview.target.url, fetchImpl);
  return buildDecisionShadowLoopReceipt({ governor, runRequested, observation, origin, now });
}
