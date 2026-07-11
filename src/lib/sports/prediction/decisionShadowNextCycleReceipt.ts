import type { DecisionShadowNextCyclePlanner } from "@/lib/sports/prediction/decisionShadowNextCyclePlanner";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionShadowNextCycleReceiptStatus = "not-run" | "verified" | "observed-warning" | "blocked" | "failed";

export type DecisionShadowNextCycleReceiptTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionShadowNextCycleObservation = {
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

export type DecisionShadowNextCycleReceipt = {
  generatedAt: string;
  date: string;
  sport: DecisionShadowNextCyclePlanner["sport"];
  mode: "decision-shadow-next-cycle-receipt";
  status: DecisionShadowNextCycleReceiptStatus;
  receiptHash: string;
  plannerHash: string;
  summary: string;
  selectedStep: {
    id: string | null;
    label: string | null;
    source: string | null;
    question: string | null;
    proofUrl: string | null;
    safeToRun: boolean;
  };
  target: DecisionShadowNextCycleReceiptTarget;
  observation: DecisionShadowNextCycleObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canObserveSelectedStep: boolean;
    canExecuteShell: false;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    lower.includes("enhance=1") ||
    lower.includes("publish=1") ||
    lower.includes("train=1") ||
    lower.includes("stake=1")
  );
}

export function resolveDecisionShadowNextCycleReceiptTarget({
  planner,
  origin = decisionSiteOrigin()
}: {
  planner: DecisionShadowNextCyclePlanner;
  origin?: string;
}): DecisionShadowNextCycleReceiptTarget {
  const step = planner.selectedStep;
  if (!step) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No shadow next-cycle step is selected."
    };
  }

  if (!planner.controls.canRunNextSafeCommand || !step.safeToRun) {
    return {
      allowed: false,
      method: null,
      path: step.proofUrl,
      url: null,
      reason: "The selected shadow next-cycle step is not currently safe to observe."
    };
  }

  const path = normalizePath(step.proofUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: step.proofUrl,
      url: null,
      reason: "The selected step does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/shadow-next-cycle-receipt")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes can be observed by the shadow next-cycle receipt."
    };
  }

  if (hasUnsafeQuery(path)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The proof URL contains a write, AI-run, persistence, publishing, training, staking, or unsafe run flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only shadow next-cycle proof route."
  };
}

function defaultObservation(): DecisionShadowNextCycleObservation {
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

function summarizePayload(payload: unknown): Pick<DecisionShadowNextCycleObservation, "success" | "mode" | "statusLabel" | "summary" | "signals"> {
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
  const totals = data.totals && typeof data.totals === "object" ? (data.totals as Record<string, unknown>) : null;
  const selectedStep = data.selectedStep && typeof data.selectedStep === "object" ? (data.selectedStep as Record<string, unknown>) : null;
  const controls = data.controls && typeof data.controls === "object" ? (data.controls as Record<string, unknown>) : null;
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
      selectedStep ? `selected:${stringValue(selectedStep.label) ?? stringValue(selectedStep.id) ?? "step"}` : null,
      controls && typeof controls.canPersistMemory === "boolean" ? `persist:${controls.canPersistMemory}` : null,
      controls && typeof controls.canAdjustProbabilities === "boolean" ? `adjust:${controls.canAdjustProbabilities}` : null,
      totals ? `totals:${Object.entries(totals).map(([key, value]) => `${key}=${value}`).join(",")}` : null
    ])
  };
}

async function fetchJsonText(url: string, fetchImpl: DecisionFetch): Promise<DecisionShadowNextCycleObservation> {
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
      error: error instanceof Error ? error.message : "Shadow next-cycle proof fetch failed."
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
  target: DecisionShadowNextCycleReceiptTarget;
  observation: DecisionShadowNextCycleObservation;
}): DecisionShadowNextCycleReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "verified";
}

function summaryFor(status: DecisionShadowNextCycleReceiptStatus, planner: DecisionShadowNextCyclePlanner, target: DecisionShadowNextCycleReceiptTarget, observation: DecisionShadowNextCycleObservation): string {
  if (status === "verified") return `Shadow next-cycle receipt observed ${planner.selectedStep?.label ?? "the selected step"} with response ${observation.responseHash ?? "unhashed"}.`;
  if (status === "observed-warning") return "Shadow next-cycle receipt observed the selected step, but the response needs review.";
  if (status === "failed") return `Shadow next-cycle receipt attempted the selected step and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `Shadow next-cycle receipt is blocked: ${target.reason}`;
  return `Shadow next-cycle receipt is ready to observe ${planner.selectedStep?.label ?? "the selected step"} when run=1 is requested.`;
}

export function buildDecisionShadowNextCycleReceipt({
  planner,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  planner: DecisionShadowNextCyclePlanner;
  runRequested?: boolean;
  observation?: DecisionShadowNextCycleObservation;
  origin?: string;
  now?: Date;
}): DecisionShadowNextCycleReceipt {
  const target = resolveDecisionShadowNextCycleReceiptTarget({ planner, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const selectedStep = planner.selectedStep;
  const receiptHash = stableHash({
    date: planner.date,
    sport: planner.sport,
    planner: planner.plannerHash,
    status,
    runRequested,
    selectedStep: selectedStep ? [selectedStep.id, selectedStep.status, selectedStep.safeToRun, selectedStep.proofUrl] : null,
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.mode, observed.statusLabel]
  });

  return {
    generatedAt: now.toISOString(),
    date: planner.date,
    sport: planner.sport,
    mode: "decision-shadow-next-cycle-receipt",
    status,
    receiptHash,
    plannerHash: planner.plannerHash,
    summary: summaryFor(status, planner, target, observed),
    selectedStep: {
      id: selectedStep?.id ?? null,
      label: selectedStep?.label ?? null,
      source: selectedStep?.source ?? null,
      question: selectedStep?.question ?? null,
      proofUrl: selectedStep?.proofUrl ?? null,
      safeToRun: selectedStep?.safeToRun ?? false
    },
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "The selected proof route returns a JSON success envelope.",
        "The receipt records response hash, status, mode, and public signals.",
        "Observation does not execute shell, persist memory, train, publish picks, stake, adjust probabilities, or expose hidden chain-of-thought."
      ],
      failureSignals: ["HTTP failure", "unsafe proof URL", "run/review/write flag", "missing selected step", "non-success envelope"],
      fallbackAction: "Keep the next-cycle planner in read-only mode and inspect the selected proof route manually."
    },
    controls: {
      canObserveSelectedStep: target.allowed,
      canExecuteShell: false,
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique(["/api/sports/decision/shadow-next-cycle-receipt", "/api/sports/decision/shadow-next-cycle-planner", target.path, ...planner.proofUrls]),
    locks: unique([
      "Shadow next-cycle receipt observes one approved local GET route only.",
      "It never executes shell commands and cannot persist, train, publish, stake, adjust probability, raise confidence, or expose hidden chain-of-thought.",
      "Observed output is a public receipt hash and signal list, not private reasoning.",
      ...planner.locks
    ])
  };
}

export async function observeDecisionShadowNextCycleReceipt({
  planner,
  runRequested = false,
  origin,
  fetchImpl = fetch as DecisionFetch,
  now = new Date()
}: {
  planner: DecisionShadowNextCyclePlanner;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: DecisionFetch;
  now?: Date;
}): Promise<DecisionShadowNextCycleReceipt> {
  const preview = buildDecisionShadowNextCycleReceipt({ planner, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;
  const observation = await fetchJsonText(preview.target.url, fetchImpl);
  return buildDecisionShadowNextCycleReceipt({ planner, runRequested, observation, origin, now });
}
