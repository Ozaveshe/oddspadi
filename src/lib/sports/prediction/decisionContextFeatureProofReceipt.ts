import type {
  DecisionContextFeatureProofRequirement,
  DecisionContextFeatureProofSelector
} from "@/lib/sports/prediction/decisionContextFeatureProofSelector";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionContextFeatureProofReceiptStatus =
  | "not-run"
  | "verified"
  | "observed-blocker"
  | "observed-warning"
  | "blocked"
  | "failed";

export type DecisionContextFeatureProofBlocker = "provider-keys" | "storage-evidence" | "admin-review" | "manual-provider-proof" | "unsafe" | "none";

export type DecisionContextFeatureProofObservation = {
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

export type DecisionContextFeatureProofTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionContextFeatureProofReceipt = {
  generatedAt: string;
  date: string;
  sport: DecisionContextFeatureProofSelector["sport"];
  mode: "decision-context-feature-proof-receipt";
  status: DecisionContextFeatureProofReceiptStatus;
  receiptHash: string;
  selectorHash: string;
  summary: string;
  selectedRequirement: {
    id: DecisionContextFeatureProofRequirement["id"] | null;
    label: string | null;
    state: DecisionContextFeatureProofRequirement["state"] | null;
    proofUrl: string | null;
    safeToInspect: boolean;
  };
  target: DecisionContextFeatureProofTarget;
  observation: DecisionContextFeatureProofObservation;
  interpretation: {
    blocker: DecisionContextFeatureProofBlocker;
    blockerDetail: string;
    canAdvanceRequirement: boolean;
    nextRequirement: {
      id: DecisionContextFeatureProofRequirement["id"] | null;
      label: string | null;
      proofUrl: string | null;
      state: DecisionContextFeatureProofRequirement["state"] | null;
    };
    evidenceUse: "none" | "blocker-proof" | "manual-context-proof";
  };
  verification: {
    requested: boolean;
    successCriteria: string[];
    failureSignals: string[];
    fallbackAction: string;
  };
  controls: {
    canObserveSelectedProof: boolean;
    canAdvanceReadOnlyRequirement: boolean;
    canExecuteShell: false;
    canPersistMemory: false;
    canPersistDecisions: false;
    canWriteFixtures: false;
    canWriteProviderRows: false;
    canWriteFeatureSnapshots: false;
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
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

export function resolveDecisionContextFeatureProofTarget({
  selector,
  origin = decisionSiteOrigin()
}: {
  selector: DecisionContextFeatureProofSelector;
  origin?: string;
}): DecisionContextFeatureProofTarget {
  const selected = selector.selectedRequirement;
  if (!selected) {
    return {
      allowed: false,
      method: null,
      path: null,
      url: null,
      reason: "No context feature requirement is selected."
    };
  }
  if (!selector.nextTurn.safeToRun || !selected.safeToInspect) {
    return {
      allowed: false,
      method: null,
      path: selected.proofUrl,
      url: null,
      reason: "The selected context feature proof is not currently safe to inspect."
    };
  }

  const path = normalizePath(selected.proofUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: selected.proofUrl,
      url: null,
      reason: "The selected context feature proof does not expose a local proof URL."
    };
  }
  if (!path.startsWith("/api/sports/decision/") || path.includes("/context-feature-proof-receipt")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes can be observed by the context feature receipt."
    };
  }
  if (hasUnsafeQuery(path)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The selected context proof contains a write, AI-run, persistence, publishing, training, staking, or unsafe run flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only context feature proof route."
  };
}

function defaultObservation(): DecisionContextFeatureProofObservation {
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

function summarizePayload(payload: unknown): Pick<DecisionContextFeatureProofObservation, "success" | "mode" | "statusLabel" | "summary" | "signals"> {
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
  const featureIntake = data.featureIntake && typeof data.featureIntake === "object" ? (data.featureIntake as Record<string, unknown>) : null;
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
      featureIntake && typeof featureIntake.status === "string" ? `featureIntake:${featureIntake.status}` : null,
      controls && typeof controls.canRunProviderDryRun === "boolean" ? `providerDryRun:${controls.canRunProviderDryRun}` : null,
      controls && typeof controls.canWriteFixtures === "boolean" ? `writeFixtures:${controls.canWriteFixtures}` : null,
      controls && typeof controls.canWriteProviderRows === "boolean" ? `writeProvider:${controls.canWriteProviderRows}` : null,
      controls && typeof controls.canWriteFeatureSnapshots === "boolean" ? `writeFeatures:${controls.canWriteFeatureSnapshots}` : null,
      controls && typeof controls.canTrainModels === "boolean" ? `train:${controls.canTrainModels}` : null,
      controls && typeof controls.canPublishPicks === "boolean" ? `publish:${controls.canPublishPicks}` : null,
      controls && typeof controls.canStake === "boolean" ? `stake:${controls.canStake}` : null
    ])
  };
}

async function fetchJsonText(url: string, fetchImpl: DecisionFetch): Promise<DecisionContextFeatureProofObservation> {
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
      error: error instanceof Error ? error.message : "Context feature proof fetch failed."
    };
  } finally {
    clearTimeout(timeout);
  }
}

function blockerFor({
  selector,
  observation
}: {
  selector: DecisionContextFeatureProofSelector;
  observation: DecisionContextFeatureProofObservation;
}): DecisionContextFeatureProofBlocker {
  const selected = selector.selectedRequirement;
  const label = observation.statusLabel ?? "";
  if (observation.error) return "unsafe";
  if (/waiting-provider-keys/i.test(label) || selector.status === "waiting-provider-keys") return "provider-keys";
  if (/waiting-admin/i.test(label)) return "admin-review";
  if (/waiting-supabase|waiting-provider-evidence|waiting-feature-materialization|waiting-storage/i.test(label) || selector.status === "waiting-storage-evidence") {
    return "storage-evidence";
  }
  if (selected?.state === "manual" || selector.status === "manual-context-selection") return "manual-provider-proof";
  return "none";
}

function nextRequirementFor(selector: DecisionContextFeatureProofSelector, selected: DecisionContextFeatureProofRequirement | null, canAdvance: boolean) {
  if (!canAdvance || !selected) return selected ?? null;
  return selector.requirements.filter((item) => item.priority > selected.priority).sort((a, b) => a.priority - b.priority)[0] ?? null;
}

function statusFor({
  requested,
  target,
  observation,
  blocker
}: {
  requested: boolean;
  target: DecisionContextFeatureProofTarget;
  observation: DecisionContextFeatureProofObservation;
  blocker: DecisionContextFeatureProofBlocker;
}): DecisionContextFeatureProofReceiptStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  if (blocker !== "none" && blocker !== "manual-provider-proof") return "observed-blocker";
  return "verified";
}

function blockerDetailFor(blocker: DecisionContextFeatureProofBlocker, selected: DecisionContextFeatureProofRequirement | null): string {
  if (blocker === "provider-keys") return `Provider key proof is still missing for ${selected?.label ?? "the selected context requirement"}.`;
  if (blocker === "storage-evidence") return `Storage evidence is still missing for ${selected?.label ?? "the selected context requirement"}.`;
  if (blocker === "admin-review") return "The selected context proof requires operator/admin review before write-mode storage.";
  if (blocker === "manual-provider-proof") return "The selected context proof was observed as a manual evidence lane; it can inform the next question only.";
  if (blocker === "unsafe") return "The selected context proof could not be observed safely.";
  return "No blocking signal was observed in the selected context proof.";
}

function summaryFor(status: DecisionContextFeatureProofReceiptStatus, selected: DecisionContextFeatureProofRequirement | null, blocker: DecisionContextFeatureProofBlocker): string {
  if (status === "verified") return `Context feature proof receipt observed ${selected?.label ?? "the selected proof"} as read-only evidence.`;
  if (status === "observed-blocker") return `Context feature proof receipt confirmed a ${blocker.replaceAll("-", " ")} blocker for ${selected?.label ?? "the selected proof"}.`;
  if (status === "observed-warning") return "Context feature proof receipt observed the selected proof, but the response needs review.";
  if (status === "failed") return "Context feature proof receipt attempted the selected proof and failed.";
  if (status === "blocked") return "Context feature proof receipt is blocked before observation.";
  return `Context feature proof receipt is ready to observe ${selected?.label ?? "the selected proof"} when run=1 is requested.`;
}

export function buildDecisionContextFeatureProofReceipt({
  selector,
  runRequested = false,
  observation,
  origin,
  now = new Date()
}: {
  selector: DecisionContextFeatureProofSelector;
  runRequested?: boolean;
  observation?: DecisionContextFeatureProofObservation;
  origin?: string;
  now?: Date;
}): DecisionContextFeatureProofReceipt {
  const selected = selector.selectedRequirement;
  const target = resolveDecisionContextFeatureProofTarget({ selector, origin });
  const observed = observation ?? defaultObservation();
  const blocker = blockerFor({ selector, observation: observed });
  const canAdvanceRequirement = runRequested && observed.attempted && observed.ok && observed.success !== false && blocker === "manual-provider-proof";
  const nextRequirement = nextRequirementFor(selector, selected, canAdvanceRequirement);
  const status = statusFor({ requested: runRequested, target, observation: observed, blocker });
  const receiptHash = stableHash({
    selector: selector.selectorHash,
    selected: selected ? [selected.id, selected.state, selected.proofUrl] : null,
    runRequested,
    status,
    blocker,
    observation: [observed.statusCode, observed.responseHash, observed.mode, observed.statusLabel]
  });

  return {
    generatedAt: now.toISOString(),
    date: selector.date,
    sport: selector.sport,
    mode: "decision-context-feature-proof-receipt",
    status,
    receiptHash,
    selectorHash: selector.selectorHash,
    summary: summaryFor(status, selected, blocker),
    selectedRequirement: {
      id: selected?.id ?? null,
      label: selected?.label ?? null,
      state: selected?.state ?? null,
      proofUrl: selected?.proofUrl ?? null,
      safeToInspect: selected?.safeToInspect ?? false
    },
    target,
    observation: observed,
    interpretation: {
      blocker,
      blockerDetail: blockerDetailFor(blocker, selected),
      canAdvanceRequirement,
      nextRequirement: {
        id: nextRequirement?.id ?? null,
        label: nextRequirement?.label ?? null,
        proofUrl: nextRequirement?.proofUrl ?? null,
        state: nextRequirement?.state ?? null
      },
      evidenceUse: status === "observed-blocker" ? "blocker-proof" : status === "verified" ? "manual-context-proof" : "none"
    },
    verification: {
      requested: runRequested,
      successCriteria: [
        "The selected context proof route returns a JSON success envelope.",
        "The receipt records response hash, status, mode, and public safety signals.",
        "Provider key, storage, admin, and manual-proof blockers are classified without changing model authority.",
        "Observation does not execute shell, persist memory, write provider rows, write feature snapshots, train, publish, stake, adjust probabilities, or expose hidden chain-of-thought."
      ],
      failureSignals: ["HTTP failure", "unsafe proof URL", "run/write/train/publish flag", "missing selected requirement", "non-success envelope"],
      fallbackAction: "Keep context feature proof selection read-only and resolve the named provider-key, storage, admin, or manual evidence blocker."
    },
    controls: {
      canObserveSelectedProof: target.allowed,
      canAdvanceReadOnlyRequirement: canAdvanceRequirement,
      canExecuteShell: false,
      canPersistMemory: false,
      canPersistDecisions: false,
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canWriteFeatureSnapshots: false,
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
      "/api/sports/decision/context-feature-proof-receipt",
      "/api/sports/decision/context-feature-proof-selector",
      target.path,
      nextRequirement?.proofUrl,
      ...selector.proofUrls
    ]),
    locks: unique([
      "Context feature proof receipt observes one selected local GET route only.",
      "It cannot write fixtures, provider rows, feature snapshots, training rows, decisions, memories, public picks, or stake.",
      "Observed context evidence can update the next question only; it cannot raise confidence, adjust probability, or publish.",
      ...selector.locks
    ])
  };
}

export async function observeDecisionContextFeatureProofReceipt({
  selector,
  runRequested = false,
  origin,
  fetchImpl = fetch as DecisionFetch,
  now = new Date()
}: {
  selector: DecisionContextFeatureProofSelector;
  runRequested?: boolean;
  origin?: string;
  fetchImpl?: DecisionFetch;
  now?: Date;
}): Promise<DecisionContextFeatureProofReceipt> {
  const preview = buildDecisionContextFeatureProofReceipt({ selector, runRequested, origin, now });
  if (!runRequested || !preview.target.allowed || !preview.target.url) return preview;
  const observation = await fetchJsonText(preview.target.url, fetchImpl);
  return buildDecisionContextFeatureProofReceipt({ selector, runRequested, observation, origin, now });
}
