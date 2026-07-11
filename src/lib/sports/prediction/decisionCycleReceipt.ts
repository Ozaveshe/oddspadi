import type { DecisionCycleGovernor } from "@/lib/sports/prediction/decisionCycleGovernor";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionCycleReceiptStatus = "not-run" | "verified" | "observed-warning" | "blocked" | "failed";

export type DecisionCycleReceiptTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionCycleReceiptObservation = {
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

export type DecisionCycleReceipt = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-cycle-receipt";
  status: DecisionCycleReceiptStatus;
  receiptHash: string;
  governorHash: string;
  summary: string;
  selectedIntent: {
    id: DecisionCycleGovernor["selectedIntent"]["id"];
    label: string;
    command: string | null;
    verifyUrl: string | null;
    safeToRun: boolean;
  };
  target: DecisionCycleReceiptTarget;
  observation: DecisionCycleReceiptObservation;
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canObserveSelectedIntent: boolean;
    canExecuteShell: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
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

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function extractUrlFromCommand(command: string | null): string | null {
  if (!command) return null;
  const quoted = command.match(/"([^"]+)"/);
  if (quoted?.[1]) return quoted[1];
  const token = command
    .split(/\s+/)
    .map((part) => part.trim())
    .find((part) => part.startsWith("http://") || part.startsWith("https://") || part.startsWith("/api/"));
  return token ?? null;
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

function hasUnsafePath(path: string, intentId: DecisionCycleGovernor["selectedIntent"]["id"]): boolean {
  const lower = path.toLowerCase();
  if (lower.includes("persist=1") || lower.includes("persist=true")) return true;
  if (lower.includes("publish=1") || lower.includes("publish=true")) return true;
  if (lower.includes("train=1") || lower.includes("train=true")) return true;
  if (lower.includes("stake=1") || lower.includes("stake=true")) return true;
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return true;
  if (lower.includes("/cycle-receipt")) return true;
  const asksRun = lower.includes("run=1") || lower.includes("run=true");
  return asksRun && !(intentId === "ask-ai-review" && lower.includes("/brain-review-runner"));
}

export function resolveDecisionCycleReceiptTarget({
  cycleGovernor,
  origin = decisionSiteOrigin()
}: {
  cycleGovernor: DecisionCycleGovernor;
  origin?: string;
}): DecisionCycleReceiptTarget {
  const intent = cycleGovernor.selectedIntent;
  if (!cycleGovernor.controls.canRunSelectedCommand || !intent.safeToRun || !intent.command) {
    return {
      allowed: false,
      method: null,
      path: intent.verifyUrl,
      url: null,
      reason: "The selected cycle intent is not currently safe to observe."
    };
  }

  const path = normalizePath(extractUrlFromCommand(intent.command) ?? intent.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: intent.verifyUrl,
      url: null,
      reason: "The selected cycle intent does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes can be observed by the cycle receipt."
    };
  }

  if (hasUnsafePath(path, intent.id)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The proof URL contains a write, training, publishing, staking, or unsafe run flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only cycle proof route."
  };
}

function defaultObservation(): DecisionCycleReceiptObservation {
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
  target: DecisionCycleReceiptTarget;
  observation: DecisionCycleReceiptObservation;
}): DecisionCycleReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "verified";
}

function summaryFor(status: DecisionCycleReceiptStatus, cycleGovernor: DecisionCycleGovernor, target: DecisionCycleReceiptTarget, observation: DecisionCycleReceiptObservation): string {
  if (status === "verified") return `Cycle receipt verified ${cycleGovernor.selectedIntent.label} with response ${observation.responseHash ?? "unhashed"}.`;
  if (status === "observed-warning") return "Cycle receipt observed the selected route, but the response was not a clean success.";
  if (status === "failed") return `Cycle receipt attempted the selected route and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `Cycle receipt is blocked: ${target.reason}`;
  return `Cycle receipt is ready to observe ${cycleGovernor.selectedIntent.label} when run=1 is requested.`;
}

export function buildDecisionCycleReceipt({
  cycleGovernor,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  cycleGovernor: DecisionCycleGovernor;
  runRequested?: boolean;
  observation?: DecisionCycleReceiptObservation;
  origin?: string;
  now?: Date;
}): DecisionCycleReceipt {
  const target = resolveDecisionCycleReceiptTarget({ cycleGovernor, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const receiptHash = stableHash({
    date: cycleGovernor.date,
    sport: cycleGovernor.sport,
    governor: cycleGovernor.governorHash,
    selected: cycleGovernor.selectedIntent.id,
    status,
    target: [target.path, target.allowed],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.statusLabel]
  });

  return {
    generatedAt: now.toISOString(),
    date: cycleGovernor.date,
    sport: cycleGovernor.sport,
    mode: "decision-cycle-receipt",
    status,
    receiptHash,
    governorHash: cycleGovernor.governorHash,
    summary: summaryFor(status, cycleGovernor, target, observed),
    selectedIntent: {
      id: cycleGovernor.selectedIntent.id,
      label: cycleGovernor.selectedIntent.label,
      command: cycleGovernor.selectedIntent.command,
      verifyUrl: cycleGovernor.selectedIntent.verifyUrl,
      safeToRun: cycleGovernor.selectedIntent.safeToRun
    },
    target,
    observation: observed,
    verification: {
      requested: runRequested,
      successCriteria: [
        "Target is a local /api/sports/decision route.",
        "Response returns HTTP 2xx.",
        "Response body parses as JSON and does not report success=false.",
        "No persistence, publishing, training, staking, shell execution, or unsafe dry-run flag is present."
      ],
      failureSignals: ["HTTP failure", "non-JSON response", "success=false", "unsafe query flag", "non-local URL"],
      fallbackAction: "Keep the cycle governor in supervised mode and inspect the selected proof route manually."
    },
    controls: {
      canObserveSelectedIntent: target.allowed,
      canExecuteShell: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    locks: unique([
      "Cycle receipt uses fetch against approved local API routes only; it never executes shell commands.",
      "Cycle receipt cannot persist, publish, train, stake, or upgrade public action.",
      "run=1 is allowed only for the guarded brain-review-runner selected by the governor.",
      ...cycleGovernor.locks
    ], 20),
    proofUrls: unique(["/api/sports/decision/cycle-receipt", "/api/sports/decision/cycle-governor", ...cycleGovernor.proofUrls], 20)
  };
}

export async function observeDecisionCycleReceipt({
  cycleGovernor,
  runRequested = false,
  origin,
  fetchImpl = fetch,
  now = new Date()
}: {
  cycleGovernor: DecisionCycleGovernor;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionCycleReceipt> {
  const preview = buildDecisionCycleReceipt({ cycleGovernor, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;

  try {
    const response = await fetchImpl(preview.target.url, { method: "GET", headers: { Accept: "application/json" } });
    const contentType = response.headers.get("content-type");
    const text = await response.text();
    let success: boolean | null = null;
    let statusLabel: string | null = null;
    let summary: string | null = null;
    const signals: string[] = [];

    try {
      const json = JSON.parse(text) as { success?: unknown; data?: unknown; error?: unknown };
      success = typeof json.success === "boolean" ? json.success : null;
      if (json.data && typeof json.data === "object") {
        const data = json.data as Record<string, unknown>;
        statusLabel = typeof data.status === "string" ? data.status : null;
        summary = typeof data.summary === "string" ? compact(data.summary) : null;
        signals.push(...unique([typeof data.mode === "string" ? data.mode : null, typeof data.status === "string" ? data.status : null]));
      }
      if (typeof json.error === "string") signals.push(compact(json.error));
    } catch {
      signals.push("non-json-response");
    }

    return buildDecisionCycleReceipt({
      cycleGovernor,
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
        statusLabel,
        summary,
        signals: unique(signals, 8),
        error: response.ok ? null : `HTTP ${response.status}`
      }
    });
  } catch (error) {
    return buildDecisionCycleReceipt({
      cycleGovernor,
      runRequested,
      origin,
      now,
      observation: {
        ...defaultObservation(),
        attempted: true,
        error: error instanceof Error ? error.message : "Cycle receipt observation failed."
      }
    });
  }
}
