import type { DecisionHistoricalDiagnosisLadder, DecisionHistoricalDiagnosisLadderStep } from "@/lib/sports/prediction/decisionHistoricalDiagnosisLadder";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionHistoricalDiagnosisLadderReceiptStatus = "not-run" | "verified" | "observed-warning" | "blocked" | "failed";

export type DecisionHistoricalDiagnosisLadderReceiptTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionHistoricalDiagnosisLadderObservation = {
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

export type DecisionHistoricalDiagnosisLadderReceipt = {
  generatedAt: string;
  date: string;
  sport: DecisionHistoricalDiagnosisLadder["sport"];
  mode: "decision-historical-diagnosis-ladder-receipt";
  status: DecisionHistoricalDiagnosisLadderReceiptStatus;
  receiptHash: string;
  ladderHash: string;
  summary: string;
  selectedStep: {
    id: DecisionHistoricalDiagnosisLadderStep["id"] | null;
    label: string | null;
    state: DecisionHistoricalDiagnosisLadderStep["state"] | null;
    proofUrl: string | null;
    safeToRun: boolean;
  };
  target: DecisionHistoricalDiagnosisLadderReceiptTarget;
  observation: DecisionHistoricalDiagnosisLadderObservation;
  advanced: {
    observedStep: {
      id: DecisionHistoricalDiagnosisLadderStep["id"] | null;
      label: string | null;
      proofHash: string | null;
    };
    nextStep: {
      id: DecisionHistoricalDiagnosisLadderStep["id"] | null;
      label: string | null;
      proofUrl: string | null;
      state: DecisionHistoricalDiagnosisLadderStep["state"] | "manual";
      safeToRun: boolean;
      reason: string;
    };
    canContinueAutomatically: boolean;
  };
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canObserveSelectedStep: boolean;
    canContinueReadOnly: boolean;
    canExecuteShell: false;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteOddsSnapshots: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
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

export function resolveDecisionHistoricalDiagnosisLadderReceiptTarget({
  ladder,
  origin = decisionSiteOrigin()
}: {
  ladder: DecisionHistoricalDiagnosisLadder;
  origin?: string;
}): DecisionHistoricalDiagnosisLadderReceiptTarget {
  const step = ladder.selectedStep;
  if (!step) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No diagnosis ladder step is selected."
    };
  }
  if (!step.safeToRun || !ladder.nextTurn.safeToRun) {
    return {
      allowed: false,
      method: null,
      path: step.proofUrl,
      url: null,
      reason: "The selected diagnosis ladder proof is manual, blocked, or not currently safe to observe."
    };
  }

  const path = normalizePath(step.proofUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: step.proofUrl,
      url: null,
      reason: "The selected diagnosis ladder proof does not expose a local proof URL."
    };
  }
  if (!path.startsWith("/api/sports/decision/") || path.includes("/historical-diagnosis-ladder-receipt")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes can be observed by the diagnosis ladder receipt."
    };
  }
  if (hasUnsafeQuery(path) || path.includes("/training/")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The selected proof contains an unsafe flag or training namespace and must stay manual."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only diagnosis ladder proof route."
  };
}

function defaultObservation(): DecisionHistoricalDiagnosisLadderObservation {
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

function summarizePayload(payload: unknown): Pick<DecisionHistoricalDiagnosisLadderObservation, "success" | "mode" | "statusLabel" | "summary" | "signals"> {
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
      controls && typeof controls.canPersistMemory === "boolean" ? `persist:${controls.canPersistMemory}` : null,
      controls && typeof controls.canWriteOddsSnapshots === "boolean" ? `writeOdds:${controls.canWriteOddsSnapshots}` : null,
      controls && typeof controls.canWriteTrainingRows === "boolean" ? `writeTraining:${controls.canWriteTrainingRows}` : null,
      controls && typeof controls.canTrainModels === "boolean" ? `train:${controls.canTrainModels}` : null,
      controls && typeof controls.canAdjustProbabilities === "boolean" ? `adjust:${controls.canAdjustProbabilities}` : null,
      controls && typeof controls.canPublishPicks === "boolean" ? `publish:${controls.canPublishPicks}` : null,
      controls && typeof controls.canStake === "boolean" ? `stake:${controls.canStake}` : null
    ])
  };
}

async function fetchJsonText(url: string, fetchImpl: DecisionFetch): Promise<DecisionHistoricalDiagnosisLadderObservation> {
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
      error: error instanceof Error ? error.message : "Diagnosis ladder proof fetch failed."
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
  target: DecisionHistoricalDiagnosisLadderReceiptTarget;
  observation: DecisionHistoricalDiagnosisLadderObservation;
}): DecisionHistoricalDiagnosisLadderReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "verified";
}

function nextStepAfter(ladder: DecisionHistoricalDiagnosisLadder, selectedStep: DecisionHistoricalDiagnosisLadderStep | null): DecisionHistoricalDiagnosisLadderStep | null {
  if (!selectedStep) return null;
  return ladder.steps.filter((item) => item.priority > selectedStep.priority).sort((a, b) => a.priority - b.priority)[0] ?? null;
}

function advancedFor({
  ladder,
  status,
  observation
}: {
  ladder: DecisionHistoricalDiagnosisLadder;
  status: DecisionHistoricalDiagnosisLadderReceiptStatus;
  observation: DecisionHistoricalDiagnosisLadderObservation;
}): DecisionHistoricalDiagnosisLadderReceipt["advanced"] {
  const selectedStep = ladder.selectedStep;
  const observed = status === "verified" ? selectedStep : null;
  const nextStep = status === "verified" ? nextStepAfter(ladder, selectedStep) : selectedStep;
  const nextState =
    nextStep?.proofUrl.includes("/training/") || nextStep?.state === "manual" ? "manual" : (nextStep?.state ?? "manual");
  const canContinueAutomatically = Boolean(status === "verified" && nextStep?.safeToRun && !nextStep.proofUrl.includes("/training/"));

  return {
    observedStep: {
      id: observed?.id ?? null,
      label: observed?.label ?? null,
      proofHash: observed ? observation.responseHash : null
    },
    nextStep: {
      id: nextStep?.id ?? null,
      label: nextStep?.label ?? null,
      proofUrl: nextStep?.proofUrl ?? null,
      state: nextState,
      safeToRun: canContinueAutomatically,
      reason:
        status === "verified" && nextStep
          ? nextStep.proofUrl.includes("/training/")
            ? "Next provider retest proof is training-namespaced, so the ladder stops for manual read-only route selection."
            : nextStep.nextAction
          : status === "verified"
            ? "No remaining provider retest proof is available."
            : "Selected proof must be observed successfully before advancing."
    },
    canContinueAutomatically
  };
}

function summaryFor(
  status: DecisionHistoricalDiagnosisLadderReceiptStatus,
  ladder: DecisionHistoricalDiagnosisLadder,
  target: DecisionHistoricalDiagnosisLadderReceiptTarget,
  advanced: DecisionHistoricalDiagnosisLadderReceipt["advanced"],
  observation: DecisionHistoricalDiagnosisLadderObservation
): string {
  if (status === "verified") {
    return `Diagnosis ladder receipt observed ${advanced.observedStep.label ?? "the selected proof"} with response ${
      observation.responseHash ?? "unhashed"
    }; next proof is ${advanced.nextStep.label ?? "none"}.`;
  }
  if (status === "observed-warning") return "Diagnosis ladder receipt observed the selected proof, but the response needs review.";
  if (status === "failed") return `Diagnosis ladder receipt attempted ${ladder.selectedStep?.label ?? "the selected proof"} and failed: ${observation.error ?? "unknown error"}.`;
  if (status === "blocked") return `Diagnosis ladder receipt is blocked: ${target.reason}`;
  return `Diagnosis ladder receipt is ready to observe ${ladder.selectedStep?.label ?? "the selected proof"} when run=1 is requested.`;
}

export function buildDecisionHistoricalDiagnosisLadderReceipt({
  ladder,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  ladder: DecisionHistoricalDiagnosisLadder;
  runRequested?: boolean;
  observation?: DecisionHistoricalDiagnosisLadderObservation;
  origin?: string;
  now?: Date;
}): DecisionHistoricalDiagnosisLadderReceipt {
  const target = resolveDecisionHistoricalDiagnosisLadderReceiptTarget({ ladder, origin });
  const observed = observation ?? defaultObservation();
  const status = statusFor({ requested: runRequested, target, observation: observed });
  const advanced = advancedFor({ ladder, status, observation: observed });
  const selectedStep = ladder.selectedStep;
  const receiptHash = stableHash({
    date: ladder.date,
    sport: ladder.sport,
    ladder: ladder.ladderHash,
    status,
    runRequested,
    selectedStep: selectedStep ? [selectedStep.id, selectedStep.state, selectedStep.safeToRun, selectedStep.proofUrl] : null,
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.mode, observed.statusLabel],
    next: advanced.nextStep
  });

  return {
    generatedAt: now.toISOString(),
    date: ladder.date,
    sport: ladder.sport,
    mode: "decision-historical-diagnosis-ladder-receipt",
    status,
    receiptHash,
    ladderHash: ladder.ladderHash,
    summary: summaryFor(status, ladder, target, advanced, observed),
    selectedStep: {
      id: selectedStep?.id ?? null,
      label: selectedStep?.label ?? null,
      state: selectedStep?.state ?? null,
      proofUrl: selectedStep?.proofUrl ?? null,
      safeToRun: selectedStep?.safeToRun ?? false
    },
    target,
    observation: observed,
    advanced,
    verification: {
      requested: runRequested,
      successCriteria: [
        "The selected diagnosis ladder proof route returns a JSON success envelope.",
        "The receipt records response hash, status, mode, and public safety signals.",
        "A verified receipt advances only to the next provider retest proof and stops at training-namespaced manual routes.",
        "Observation does not execute shell, persist memory, train, write odds snapshots, publish picks, stake, adjust probabilities, or expose hidden chain-of-thought."
      ],
      failureSignals: ["HTTP failure", "unsafe proof URL", "training namespace", "run/review/write flag", "missing selected ladder step", "non-success envelope"],
      fallbackAction: "Keep the historical diagnosis ladder in read-only mode and inspect the selected proof route manually."
    },
    controls: {
      canObserveSelectedStep: target.allowed,
      canContinueReadOnly: advanced.canContinueAutomatically,
      canExecuteShell: false,
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteOddsSnapshots: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/historical-diagnosis-ladder-receipt",
      "/api/sports/decision/historical-diagnosis-ladder",
      target.path,
      advanced.nextStep.proofUrl,
      ...ladder.proofUrls
    ]),
    locks: unique([
      "Diagnosis ladder receipt observes one selected local GET proof route only.",
      "It cannot write odds snapshots, training rows, decisions, memories, public picks, or stake.",
      "Verified receipt evidence can advance the provider retest ladder only, never model authority.",
      "Training-namespaced next proofs remain manual and cannot be auto-run by this receipt.",
      ...ladder.locks
    ])
  };
}

export async function observeDecisionHistoricalDiagnosisLadderReceipt({
  ladder,
  runRequested = false,
  origin,
  fetchImpl = fetch as DecisionFetch,
  now = new Date()
}: {
  ladder: DecisionHistoricalDiagnosisLadder;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: DecisionFetch;
  now?: Date;
}): Promise<DecisionHistoricalDiagnosisLadderReceipt> {
  const preview = buildDecisionHistoricalDiagnosisLadderReceipt({ ladder, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;
  const observation = await fetchJsonText(preview.target.url, fetchImpl);
  return buildDecisionHistoricalDiagnosisLadderReceipt({ ladder, runRequested, observation, origin, now });
}
