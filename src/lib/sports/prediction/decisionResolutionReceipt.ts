import type { DecisionResolutionPlanner, DecisionResolutionStep } from "@/lib/sports/prediction/decisionResolutionPlanner";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionResolutionReceiptStatus = "not-run" | "verified" | "observed-warning" | "blocked" | "failed";

export type DecisionResolutionReceiptTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionResolutionReceiptObservation = {
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

export type DecisionResolutionReceipt = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-resolution-receipt";
  status: DecisionResolutionReceiptStatus;
  receiptHash: string;
  plannerHash: string;
  summary: string;
  selectedStep: {
    id: string | null;
    label: string | null;
    source: DecisionResolutionStep["source"] | null;
    command: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
  };
  target: DecisionResolutionReceiptTarget;
  observation: DecisionResolutionReceiptObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canObserveSelectedStep: boolean;
    canExecuteShell: false;
    canResolveContradiction: false;
    canRaiseConfidence: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  proofUrls: string[];
  locks: string[];
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, max = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 3).trim()}...` : normalized;
}

function extractUrlFromCommand(command: string | null): string | null {
  if (!command) return null;
  const quoted = command.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  return (
    command
      .split(/\s+/)
      .map((part) => part.trim())
      .find((part) => part.startsWith("http://") || part.startsWith("https://") || part.startsWith("/api/")) ?? null
  );
}

function normalizePath(value: string | null): string | null {
  if (!value) return null;
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

function hasUnsafePath(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("persist=1") ||
    lower.includes("persist=true") ||
    lower.includes("publish=1") ||
    lower.includes("publish=true") ||
    lower.includes("train=1") ||
    lower.includes("train=true") ||
    lower.includes("stake=1") ||
    lower.includes("stake=true") ||
    lower.includes("dryrun=0") ||
    lower.includes("dryrun=false") ||
    lower.includes("/resolution-receipt")
  );
}

export function resolveDecisionResolutionReceiptTarget({
  planner,
  origin = decisionSiteOrigin()
}: {
  planner: DecisionResolutionPlanner;
  origin?: string;
}): DecisionResolutionReceiptTarget {
  const step = planner.nextStep;
  if (!step) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "Resolution planner has no selected step to observe."
    };
  }
  if (!step.safeToRun || !step.command) {
    return {
      allowed: false,
      method: null,
      path: step.verifyUrl,
      url: null,
      reason: "The selected resolution step is not currently safe to observe."
    };
  }

  const path = normalizePath(extractUrlFromCommand(step.command) ?? step.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: step.verifyUrl,
      url: null,
      reason: "The selected resolution step does not expose a local proof URL."
    };
  }
  if (!path.startsWith("/api/sports/decision/")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes can be observed by the resolution receipt."
    };
  }
  if (hasUnsafePath(path)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The proof URL contains a write, publishing, training, staking, receipt recursion, or unsafe dry-run flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only resolution proof route."
  };
}

function defaultObservation(): DecisionResolutionReceiptObservation {
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

function statusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionResolutionReceiptTarget;
  observation: DecisionResolutionReceiptObservation;
}): DecisionResolutionReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "verified";
}

function summaryFor(status: DecisionResolutionReceiptStatus, planner: DecisionResolutionPlanner, target: DecisionResolutionReceiptTarget, observation: DecisionResolutionReceiptObservation): string {
  if (status === "verified") return `Resolution receipt verified ${planner.nextStep?.label ?? "the selected step"} with response ${observation.responseHash ?? "unhashed"}.`;
  if (status === "observed-warning") return "Resolution receipt observed the selected proof route, but the response was not a clean success.";
  if (status === "failed") return `Resolution receipt attempted the selected proof route and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `Resolution receipt is blocked: ${target.reason}`;
  return `Resolution receipt is ready to observe ${planner.nextStep?.label ?? "the selected resolution step"} when run=1 is requested.`;
}

export function buildDecisionResolutionReceipt({
  planner,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  planner: DecisionResolutionPlanner;
  runRequested?: boolean;
  observation?: DecisionResolutionReceiptObservation;
  origin?: string;
  now?: Date;
}): DecisionResolutionReceipt {
  const target = resolveDecisionResolutionReceiptTarget({ planner, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const step = planner.nextStep;
  const receiptHash = stableHash({
    date: planner.date,
    sport: planner.sport,
    planner: planner.plannerHash,
    step: step?.id ?? null,
    status,
    target: [target.path, target.allowed],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.mode, observed.statusLabel]
  });

  return {
    generatedAt: now.toISOString(),
    date: planner.date,
    sport: planner.sport,
    mode: "decision-resolution-receipt",
    status,
    receiptHash,
    plannerHash: planner.plannerHash,
    summary: summaryFor(status, planner, target, observed),
    selectedStep: {
      id: step?.id ?? null,
      label: step?.label ?? null,
      source: step?.source ?? null,
      command: step?.command ?? null,
      verifyUrl: step?.verifyUrl ?? null,
      safeToRun: step?.safeToRun ?? false
    },
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "Target is a local /api/sports/decision route.",
        "Target is selected by the resolution planner as safeToRun.",
        "Response returns HTTP 2xx and JSON success is not false.",
        "No persistence, publishing, training, staking, shell execution, or unsafe dry-run flag is present."
      ],
      failureSignals: ["unsafe selected step", "HTTP failure", "non-JSON response", "success=false", "non-local URL"],
      fallbackAction: "Keep the contradiction unresolved and inspect the target proof route manually."
    },
    controls: {
      canObserveSelectedStep: target.allowed,
      canExecuteShell: false,
      canResolveContradiction: false,
      canRaiseConfidence: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/resolution-receipt",
      "/api/sports/decision/resolution-planner",
      target.path,
      step?.verifyUrl,
      ...planner.proofUrls
    ]),
    locks: [
      "Resolution receipt observes proof only; it cannot execute shell commands.",
      "Receipt verification cannot mark contradictions resolved, raise confidence, persist, publish, train, stake, or expose hidden reasoning.",
      "Unsafe query flags or non-local URLs keep the receipt blocked."
    ].map((value) => compact(value))
  };
}

export async function observeDecisionResolutionReceipt({
  planner,
  runRequested = false,
  origin,
  fetchImpl = fetch,
  now = new Date()
}: {
  planner: DecisionResolutionPlanner;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionResolutionReceipt> {
  const preview = buildDecisionResolutionReceipt({ planner, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;

  try {
    const response = await fetchImpl(preview.target.url, { method: "GET", headers: { Accept: "application/json" } });
    const contentType = response.headers.get("content-type");
    const text = await response.text();
    let success: boolean | null = null;
    let mode: string | null = null;
    let statusLabel: string | null = null;
    let summary: string | null = null;
    const signals: string[] = [];

    try {
      const json = JSON.parse(text) as { success?: unknown; data?: unknown; error?: unknown };
      success = typeof json.success === "boolean" ? json.success : null;
      if (json.data && typeof json.data === "object") {
        const data = json.data as Record<string, unknown>;
        mode = typeof data.mode === "string" ? data.mode : null;
        statusLabel = typeof data.status === "string" ? data.status : null;
        summary = typeof data.summary === "string" ? compact(data.summary) : null;
        signals.push(...unique([mode, statusLabel]));
      }
      if (typeof json.error === "string") signals.push(compact(json.error));
    } catch {
      signals.push("non-json-response");
    }

    return buildDecisionResolutionReceipt({
      planner,
      runRequested,
      origin,
      now,
      observation: {
        attempted: true,
        ok: response.ok,
        statusCode: response.status,
        contentType,
        responseHash: stableHash(text),
        bodyBytes: text.length,
        success,
        mode,
        statusLabel,
        summary,
        signals: unique(signals, 8),
        error: response.ok ? null : `HTTP ${response.status}`
      }
    });
  } catch (error) {
    return buildDecisionResolutionReceipt({
      planner,
      runRequested,
      origin,
      now,
      observation: {
        ...defaultObservation(),
        attempted: true,
        error: error instanceof Error ? error.message : "Resolution receipt observation failed."
      }
    });
  }
}
