import type { DecisionAICognitiveLoop } from "@/lib/sports/prediction/decisionAICognitiveLoop";
import type { DecisionAIControlPacket } from "@/lib/sports/prediction/decisionAIControlPacket";
import type { DecisionAIDeliberation } from "@/lib/sports/prediction/decisionAIDeliberation";
import type { DecisionAIExperimentEpisode } from "@/lib/sports/prediction/decisionAIExperimentEpisode";
import type { DecisionAISession } from "@/lib/sports/prediction/decisionAISession";
import type { DecisionCapabilityContract } from "@/lib/sports/prediction/decisionCapabilityContract";
import type { DecisionMind } from "@/lib/sports/prediction/decisionMind";
import type { DecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import type { DecisionReasoningAlignment } from "@/lib/sports/prediction/decisionReasoningAlignment";
import type { DecisionSupabaseProjectIsolation } from "@/lib/sports/prediction/decisionSupabaseProjectIsolation";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionAction, Sport } from "@/lib/sports/types";
import { extractOutputText } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

export type DecisionAIExecutiveStatus = "ready-readonly" | "ready-ai-review" | "needs-proof" | "repair" | "blocked";
export type DecisionAIExecutivePhaseStatus = "pass" | "watch" | "block";
export type DecisionAIExecutiveDirectiveAction = "run-readonly-proof" | "run-dry-run-proof" | "ask-ai-review" | "hold" | "repair" | "block";
export type DecisionAIExecutivePhaseId = "observe" | "align" | "orient" | "deliberate" | "decide" | "act" | "verify" | "remember";
export type DecisionAIExecutiveReviewStatus = "not-requested" | "not-configured" | "reviewed" | "provider-error" | "invalid-response";
export type DecisionAIExecutiveReviewVerdict = "agree" | "downgrade" | "needs-evidence" | "repair" | "block";
export type DecisionAIExecutiveTrustPatch = "keep-ceiling" | "lower-ceiling" | "repair-first" | "block";
export type DecisionAIExecutiveProofObservationStatus = "not-run" | "observed" | "observed-warning" | "blocked" | "failed";
export type DecisionAIExecutivePolicyStatus = "approved-readonly" | "watch-proof" | "repair-first" | "blocked";
export type DecisionAIExecutivePolicyAction = "observe-proof" | "repair-evidence" | "hold" | "block";

export type DecisionAIExecutiveCommand = {
  label: string;
  command: string | null;
  verifyUrl: string | null;
  expectedEvidence: string;
  source: string;
  runMode: "read-only" | "dry-run" | "manual-only";
  safeToRun: boolean;
};

export type DecisionAIExecutivePhase = {
  id: DecisionAIExecutivePhaseId;
  label: string;
  status: DecisionAIExecutivePhaseStatus;
  signal: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAIExecutiveConflict = {
  id: string;
  status: "resolved" | "watch" | "block";
  label: string;
  detail: string;
  effect: string;
};

export type DecisionAIExecutiveEvidenceItem = {
  id: string;
  source: string;
  label: string;
  status: string;
  detail: string;
};

export type DecisionAIExecutivePolicy = {
  policyHash: string;
  status: DecisionAIExecutivePolicyStatus;
  action: DecisionAIExecutivePolicyAction;
  thesis: string;
  decisionRule: string;
  selectedProof: {
    label: string;
    source: string;
    runMode: DecisionAIExecutiveCommand["runMode"];
    safeToRun: boolean;
    verifyUrl: string | null;
    expectedEvidence: string;
  };
  confidenceBudget: {
    score: number;
    ceiling: DecisionAISession["metareasoning"]["trustCeiling"];
    drivers: Array<{
      id: string;
      label: string;
      status: DecisionAIExecutivePhaseStatus;
      impact: number;
      reason: string;
    }>;
  };
  vetoes: string[];
  requiredProof: string[];
  safeOperatingMode: DecisionAIExecutiveCommand["runMode"];
  proofUrl: string | null;
  canEscalatePublicAction: false;
  canPersist: false;
  canPublish: false;
  canTrain: false;
};

export type DecisionAIExecutiveProofTarget = {
  allowed: boolean;
  method: "GET" | null;
  path: string | null;
  url: string | null;
  reason: string;
};

export type DecisionAIExecutiveProofObservation = {
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

export type DecisionAIExecutiveProofReceipt = {
  requested: boolean;
  status: DecisionAIExecutiveProofObservationStatus;
  receiptHash: string;
  summary: string;
  target: DecisionAIExecutiveProofTarget;
  observation: DecisionAIExecutiveProofObservation;
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
  safeNoPersistence: true;
};

export type DecisionAIExecutiveEvidenceFinding = {
  evidenceId: string;
  status: "supports" | "challenges" | "missing";
  finding: string;
};

export type DecisionAIExecutiveSafetyGate = {
  id: string;
  label: string;
  status: DecisionAIExecutivePhaseStatus;
  reason: string;
};

export type DecisionAIExecutiveReview = {
  reviewVerdict: DecisionAIExecutiveReviewVerdict;
  recommendedAction: DecisionAction;
  recommendedDirective: DecisionAIExecutiveDirectiveAction;
  trustPatch: DecisionAIExecutiveTrustPatch;
  summary: string;
  evidenceFindings: DecisionAIExecutiveEvidenceFinding[];
  riskFlags: string[];
  dataGaps: string[];
  falsifiers: string[];
  requiredEvidence: string[];
  safetyGates: DecisionAIExecutiveSafetyGate[];
  unsupportedClaims: string[];
  publishPermission: "never";
  persistencePermission: "never";
  trainingPermission: "never";
  publicActionUpgradePermission: "never";
};

export type DecisionAIExecutive = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-executive-decision";
  status: DecisionAIExecutiveStatus;
  executiveHash: string;
  summary: string;
  activeDecision: {
    matchId: string | null;
    match: string | null;
    baselineAction: DecisionAction | null;
    authorityAction: DecisionAction;
    sessionAction: DecisionAction;
    executiveAction: DecisionAction;
    publicStance: DecisionAIDeliberation["finalResolution"]["stance"];
    publicPosture: DecisionAISession["activeDecision"]["publicPosture"];
    trustCeiling: DecisionAISession["metareasoning"]["trustCeiling"];
    canShowAsPick: false;
  };
  laneStates: {
    mind: DecisionMind["status"];
    cognitiveLoop: DecisionAICognitiveLoop["status"];
    session: DecisionAISession["status"];
    metareasoning: DecisionAISession["metareasoning"]["status"];
    deliberation: DecisionAIDeliberation["status"];
    control: DecisionAIControlPacket["status"];
    experiment: DecisionAIExperimentEpisode["status"];
    capability: DecisionCapabilityContract["status"];
    reasoningAlignment: DecisionReasoningAlignment["status"] | "not-attached";
    supabaseIsolation: DecisionSupabaseProjectIsolation["status"];
    providerIngestion: DecisionProviderIngestionEvidence["status"] | "not-attached";
  };
  phases: DecisionAIExecutivePhase[];
  conflicts: DecisionAIExecutiveConflict[];
  policy: DecisionAIExecutivePolicy;
  finalDirective: {
    action: DecisionAIExecutiveDirectiveAction;
    reason: string;
    command: DecisionAIExecutiveCommand;
    confidenceCeiling: DecisionAISession["metareasoning"]["trustCeiling"];
    trustPatch: DecisionAICognitiveLoop["trustPatch"];
    canAdvanceReadOnly: boolean;
  };
  proofReceipt: DecisionAIExecutiveProofReceipt;
  memoryDraft: {
    label: string;
    content: string;
    evidenceHash: string;
    canPersist: false;
  };
  runRequested: boolean;
  openAiConfigured: boolean;
  evidencePacket: DecisionAIExecutiveEvidenceItem[];
  requestPreview: ReturnType<typeof buildOpenAIExecutiveReviewPayload>;
  deterministicFallback: DecisionAIExecutiveReview;
  review: DecisionAIExecutiveReview | null;
  latestRun: {
    requested: boolean;
    provider: "openai" | "deterministic";
    status: DecisionAIExecutiveReviewStatus;
    model: string | null;
    reviewHash: string | null;
    reason: string | null;
    safeNoPersistence: true;
  };
  controls: {
    canRunReadOnly: boolean;
    canRunDryRun: boolean;
    canAskOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canRaiseTrust: false;
    canUpgradePublicAction: false;
  };
  locks: string[];
  proofUrls: string[];
};

type DecisionAIExecutivePayloadInput = Omit<
  DecisionAIExecutive,
  "requestPreview" | "deterministicFallback" | "review" | "latestRun"
>;

const aiExecutiveReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: ["agree", "downgrade", "needs-evidence", "repair", "block"] },
    recommendedAction: { type: "string", enum: ["consider", "monitor", "avoid"] },
    recommendedDirective: {
      type: "string",
      enum: ["run-readonly-proof", "run-dry-run-proof", "ask-ai-review", "hold", "repair", "block"]
    },
    trustPatch: { type: "string", enum: ["keep-ceiling", "lower-ceiling", "repair-first", "block"] },
    summary: { type: "string" },
    evidenceFindings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidenceId: { type: "string" },
          status: { type: "string", enum: ["supports", "challenges", "missing"] },
          finding: { type: "string" }
        },
        required: ["evidenceId", "status", "finding"]
      }
    },
    riskFlags: { type: "array", items: { type: "string" } },
    dataGaps: { type: "array", items: { type: "string" } },
    falsifiers: { type: "array", items: { type: "string" } },
    requiredEvidence: { type: "array", items: { type: "string" } },
    safetyGates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["pass", "watch", "block"] },
          reason: { type: "string" }
        },
        required: ["id", "label", "status", "reason"]
      }
    },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    publishPermission: { type: "string", enum: ["never"] },
    persistencePermission: { type: "string", enum: ["never"] },
    trainingPermission: { type: "string", enum: ["never"] },
    publicActionUpgradePermission: { type: "string", enum: ["never"] }
  },
  required: [
    "reviewVerdict",
    "recommendedAction",
    "recommendedDirective",
    "trustPatch",
    "summary",
    "evidenceFindings",
    "riskFlags",
    "dataGaps",
    "falsifiers",
    "requiredEvidence",
    "safetyGates",
    "unsupportedClaims",
    "publishPermission",
    "persistencePermission",
    "trainingPermission",
    "publicActionUpgradePermission"
  ]
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

function compact(value: string, maxLength = 320): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function clampNumber(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function boundedText(value: unknown, maxLength = 360): string {
  return typeof value === "string" ? compact(value, maxLength) : "";
}

function normalizeProofPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
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

function hasUnsafeProofQuery(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.includes("persist=1") ||
    lower.includes("persist=true") ||
    lower.includes("publish=1") ||
    lower.includes("publish=true") ||
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

function defaultProofObservation(): DecisionAIExecutiveProofObservation {
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

function proofTargetForDirective({
  finalDirective,
  origin = decisionSiteOrigin()
}: {
  finalDirective: DecisionAIExecutive["finalDirective"];
  origin?: string;
}): DecisionAIExecutiveProofTarget {
  const commandItem = finalDirective.command;
  if (!commandItem.safeToRun || commandItem.runMode === "manual-only") {
    return {
      allowed: false,
      method: null,
      path: commandItem.verifyUrl,
      url: null,
      reason: "The selected executive command is not currently safe to observe."
    };
  }

  const path = normalizeProofPath(commandItem.verifyUrl);
  if (!path) {
    return {
      allowed: false,
      method: null,
      path: commandItem.verifyUrl,
      url: null,
      reason: "The selected executive command does not expose a local proof URL."
    };
  }

  if (!path.startsWith("/api/sports/decision/") || path.includes("/ai-executive")) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "Only local sports decision proof routes outside the executive route can be observed."
    };
  }

  if (hasUnsafeProofQuery(path)) {
    return {
      allowed: false,
      method: null,
      path,
      url: null,
      reason: "The proof URL contains a write, AI-run, persistence, publish, or unsafe dry-run flag."
    };
  }

  return {
    allowed: true,
    method: "GET",
    path,
    url: new URL(path, origin).toString(),
    reason: "Approved local read-only executive proof route."
  };
}

function proofStatusFor({
  requested,
  target,
  observation
}: {
  requested: boolean;
  target: DecisionAIExecutiveProofTarget;
  observation: DecisionAIExecutiveProofObservation;
}): DecisionAIExecutiveProofObservationStatus {
  if (!target.allowed) return "blocked";
  if (!requested) return "not-run";
  if (!observation.attempted) return "blocked";
  if (observation.error || !observation.ok) return "failed";
  if (observation.success === false) return "observed-warning";
  return "observed";
}

function proofSummary({
  status,
  finalDirective,
  target,
  observation
}: {
  status: DecisionAIExecutiveProofObservationStatus;
  finalDirective: DecisionAIExecutive["finalDirective"];
  target: DecisionAIExecutiveProofTarget;
  observation: DecisionAIExecutiveProofObservation;
}): string {
  if (status === "observed") return `Executive proof observed ${finalDirective.command.label} with response ${observation.responseHash ?? "unhashed"}.`;
  if (status === "observed-warning") return `Executive proof observed ${finalDirective.command.label}, but the response was not a clean success.`;
  if (status === "failed") return `Executive proof attempted ${finalDirective.command.label} and failed: ${observation.error ?? `HTTP ${observation.statusCode ?? "unknown"}`}.`;
  if (status === "blocked") return `Executive proof observation is blocked: ${target.reason}`;
  return `Executive proof is ready to observe ${finalDirective.command.label} when observe=1 is requested.`;
}

function buildExecutiveProofReceipt({
  date,
  sport,
  finalDirective,
  requested = false,
  observation,
  origin,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  finalDirective: DecisionAIExecutive["finalDirective"];
  requested?: boolean;
  observation?: DecisionAIExecutiveProofObservation;
  origin?: string;
  now?: Date;
}): DecisionAIExecutiveProofReceipt {
  const target = proofTargetForDirective({ finalDirective, origin });
  const observed = observation ?? defaultProofObservation();
  const status = proofStatusFor({ requested, target, observation: observed });
  const receiptHash = stableHash({
    date,
    sport,
    directive: finalDirective.action,
    command: finalDirective.command.source,
    status,
    target: [target.path, target.allowed],
    observation: [observed.statusCode, observed.responseHash, observed.success, observed.statusLabel],
    generatedAt: now.toISOString()
  });

  return {
    requested,
    status,
    receiptHash,
    summary: proofSummary({ status, finalDirective, target, observation: observed }),
    target,
    observation: {
      ...observed,
      summary: observed.summary ? compact(observed.summary, 220) : null,
      signals: unique(observed.signals, 10)
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
    safeNoPersistence: true
  };
}

export function summarizeDecisionAIExecutiveProofPayload(
  payload: unknown
): Pick<DecisionAIExecutiveProofObservation, "success" | "statusLabel" | "summary" | "signals"> {
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
  const controls = data.controls && typeof data.controls === "object" ? (data.controls as Record<string, unknown>) : null;
  const supabase = data.supabase && typeof data.supabase === "object" ? (data.supabase as Record<string, unknown>) : null;
  const finalDirective = data.finalDirective && typeof data.finalDirective === "object" ? (data.finalDirective as Record<string, unknown>) : null;
  const nextProviderSignal = data.nextProviderSignal && typeof data.nextProviderSignal === "object" ? (data.nextProviderSignal as Record<string, unknown>) : null;

  const statusLabel =
    typeof data.status === "string"
      ? data.status
      : typeof data.mode === "string"
        ? data.mode
        : typeof record.status === "string"
          ? record.status
          : null;
  const summary = typeof data.summary === "string" ? data.summary : typeof data.reason === "string" ? data.reason : typeof record.error === "string" ? record.error : null;
  const signals = unique([
    typeof record.success === "boolean" ? `success:${record.success}` : null,
    statusLabel ? `status:${statusLabel}` : null,
    typeof data.mode === "string" ? `mode:${data.mode}` : null,
    controls && typeof controls.canRunProviderDryRun === "boolean" ? `providerDryRun:${controls.canRunProviderDryRun}` : null,
    controls && typeof controls.canPersist === "boolean" ? `persist:${controls.canPersist}` : null,
    controls && typeof controls.canPublish === "boolean" ? `publish:${controls.canPublish}` : null,
    controls && typeof controls.canTrain === "boolean" ? `train:${controls.canTrain}` : null,
    supabase && typeof supabase.storageReady === "boolean" ? `storage:${supabase.storageReady}` : null,
    finalDirective && typeof finalDirective.action === "string" ? `directive:${finalDirective.action}` : null,
    nextProviderSignal && typeof nextProviderSignal.label === "string" ? `next:${nextProviderSignal.label}` : null
  ]);

  return {
    success: typeof record.success === "boolean" ? record.success : null,
    statusLabel,
    summary: summary ? compact(summary, 220) : null,
    signals
  };
}

function boundedList(value: unknown, maxItems: number, maxLength = 260): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function isAction(value: unknown): value is DecisionAction {
  return value === "consider" || value === "monitor" || value === "avoid";
}

function isReviewVerdict(value: unknown): value is DecisionAIExecutiveReviewVerdict {
  return value === "agree" || value === "downgrade" || value === "needs-evidence" || value === "repair" || value === "block";
}

function isTrustPatch(value: unknown): value is DecisionAIExecutiveTrustPatch {
  return value === "keep-ceiling" || value === "lower-ceiling" || value === "repair-first" || value === "block";
}

function isDirectiveAction(value: unknown): value is DecisionAIExecutiveDirectiveAction {
  return value === "run-readonly-proof" || value === "run-dry-run-proof" || value === "ask-ai-review" || value === "hold" || value === "repair" || value === "block";
}

function isFindingStatus(value: unknown): value is DecisionAIExecutiveEvidenceFinding["status"] {
  return value === "supports" || value === "challenges" || value === "missing";
}

function isPhaseStatus(value: unknown): value is DecisionAIExecutivePhaseStatus {
  return value === "pass" || value === "watch" || value === "block";
}

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function safestAction(current: DecisionAction, proposed: DecisionAction): DecisionAction {
  return actionRank(proposed) <= actionRank(current) ? proposed : current;
}

function directiveRank(action: DecisionAIExecutiveDirectiveAction): number {
  if (action === "run-readonly-proof") return 5;
  if (action === "run-dry-run-proof") return 4;
  if (action === "ask-ai-review") return 3;
  if (action === "hold") return 2;
  if (action === "repair") return 1;
  return 0;
}

function safestDirective(current: DecisionAIExecutiveDirectiveAction, proposed: DecisionAIExecutiveDirectiveAction): DecisionAIExecutiveDirectiveAction {
  return directiveRank(proposed) <= directiveRank(current) ? proposed : current;
}

function saferAction(actions: Array<DecisionAction | null | undefined>): DecisionAction {
  if (actions.includes("avoid")) return "avoid";
  if (actions.includes("monitor")) return "monitor";
  return "consider";
}

function actionFromStance(stance: DecisionAIDeliberation["finalResolution"]["stance"]): DecisionAction {
  if (stance === "avoid") return "avoid";
  if (stance === "monitor-shadow") return "monitor";
  return "consider";
}

function runMode(command: string | null): DecisionAIExecutiveCommand["runMode"] {
  if (!command) return "manual-only";
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return "manual-only";
  if (lower.includes("persist=1") || lower.includes("publish=1") || lower.includes("dryrun=0") || lower.includes("dryrun=false")) return "manual-only";
  if (lower.includes("-x post") || lower.includes("-xpost") || lower.includes("--request post")) {
    return lower.includes("dryrun=1") || lower.includes("dryrun=true") ? "dry-run" : "manual-only";
  }
  return "read-only";
}

function command(input: Omit<DecisionAIExecutiveCommand, "runMode" | "safeToRun"> & { safeToRun?: boolean }): DecisionAIExecutiveCommand {
  const mode = runMode(input.command);
  return {
    ...input,
    runMode: mode,
    safeToRun: Boolean(input.safeToRun) && mode !== "manual-only"
  };
}

function commandFromControl(control: DecisionAIControlPacket): DecisionAIExecutiveCommand {
  return command({
    label: control.nextMove.label,
    command: control.nextMove.command,
    verifyUrl: control.nextMove.verifyUrl,
    expectedEvidence: control.nextMove.expectedEvidence,
    source: `ai-control:${control.nextMove.source}`,
    safeToRun: control.nextMove.canRunNow
  });
}

function commandFromCognitiveLoop(loop: DecisionAICognitiveLoop): DecisionAIExecutiveCommand {
  return command({
    label: loop.nextOperation.label,
    command: loop.nextOperation.command,
    verifyUrl: loop.nextOperation.verifyUrl,
    expectedEvidence: loop.nextOperation.expectedEvidence,
    source: "ai-cognitive-loop",
    safeToRun: loop.nextOperation.safeToRun
  });
}

function commandFromExperiment(episode: DecisionAIExperimentEpisode): DecisionAIExecutiveCommand {
  const preferred =
    episode.replay.commands.find((item) => item.id === "ai-experiment-observer" && item.safeToRun) ??
    episode.replay.commands.find((item) => item.safeToRun) ??
    episode.replay.commands[0];
  return command({
    label: preferred?.label ?? "Inspect AI experiment episode",
    command: preferred?.command ?? null,
    verifyUrl: "/api/sports/decision/ai-experiment-episode",
    expectedEvidence: episode.experimentNarrative.next,
    source: `ai-experiment-episode:${preferred?.id ?? "none"}`,
    safeToRun: Boolean(preferred?.safeToRun)
  });
}

function commandFromDeliberation(deliberation: DecisionAIDeliberation): DecisionAIExecutiveCommand {
  return command({
    label: deliberation.nextProof.label,
    command: deliberation.nextProof.command,
    verifyUrl: deliberation.nextProof.verifyUrl,
    expectedEvidence: deliberation.nextProof.expectedEvidence,
    source: "ai-deliberation",
    safeToRun: deliberation.nextProof.safeToRun
  });
}

function commandFromCapability(contract: DecisionCapabilityContract): DecisionAIExecutiveCommand | null {
  if (!contract.nextSafeCommand) return null;
  return command({
    label: contract.nextSafeCommand.label,
    command: contract.nextSafeCommand.command,
    verifyUrl: contract.nextSafeCommand.verifyUrl,
    expectedEvidence: contract.nextSafeCommand.expectedEvidence,
    source: `capability-contract:${contract.nextSafeCommand.source}`,
    safeToRun: contract.nextSafeCommand.safeToRun
  });
}

function commandFromProviderIngestion(providerIngestionEvidence: DecisionProviderIngestionEvidence | null): DecisionAIExecutiveCommand | null {
  if (!providerIngestionEvidence?.nextCommand) return null;
  return command({
    label: providerIngestionEvidence.nextCommand.label,
    command: providerIngestionEvidence.nextCommand.command,
    verifyUrl: providerIngestionEvidence.nextCommand.verifyUrl,
    expectedEvidence: providerIngestionEvidence.nextCommand.expectedEvidence,
    source: `provider-ingestion:${providerIngestionEvidence.nextCommand.id}`,
    safeToRun: providerIngestionEvidence.nextCommand.safeToRun
  });
}

function commandFromReasoningAlignment(reasoningAlignment: DecisionReasoningAlignment | null): DecisionAIExecutiveCommand | null {
  if (!reasoningAlignment?.nextAlignment) return null;
  return command({
    label: reasoningAlignment.nextAlignment.label,
    command: reasoningAlignment.nextAlignment.command,
    verifyUrl: reasoningAlignment.nextAlignment.verifyUrl,
    expectedEvidence: reasoningAlignment.nextAlignment.reason,
    source: `reasoning-alignment:${reasoningAlignment.nextAlignment.source ?? reasoningAlignment.status}`,
    safeToRun: reasoningAlignment.nextAlignment.safeToRun
  });
}

function chooseCommand({
  control,
  cognitiveLoop,
  experimentEpisode,
  deliberation,
  capabilityContract,
  reasoningAlignment,
  providerIngestionEvidence
}: {
  control: DecisionAIControlPacket;
  cognitiveLoop: DecisionAICognitiveLoop;
  experimentEpisode: DecisionAIExperimentEpisode;
  deliberation: DecisionAIDeliberation;
  capabilityContract: DecisionCapabilityContract;
  reasoningAlignment?: DecisionReasoningAlignment | null;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
}): DecisionAIExecutiveCommand {
  const candidates = uniqueCommands([
    commandFromReasoningAlignment(reasoningAlignment ?? null),
    commandFromProviderIngestion(providerIngestionEvidence ?? null),
    commandFromControl(control),
    commandFromCognitiveLoop(cognitiveLoop),
    commandFromExperiment(experimentEpisode),
    commandFromDeliberation(deliberation),
    commandFromCapability(capabilityContract)
  ]);

  return (
    candidates.find((item) => item.safeToRun && item.runMode === "read-only") ??
    candidates.find((item) => item.safeToRun && item.runMode === "dry-run") ??
    candidates.find((item) => item.runMode !== "manual-only") ??
    candidates[0] ??
    command({
      label: "Inspect AI executive",
      command: null,
      verifyUrl: "/api/sports/decision/ai-executive",
      expectedEvidence: "A fresh executive packet with public stance, locks, and next proof.",
      source: "ai-executive",
      safeToRun: false
    })
  );
}

function uniqueCommands(values: Array<DecisionAIExecutiveCommand | null>): DecisionAIExecutiveCommand[] {
  const seen = new Set<string>();
  return values.filter((item): item is DecisionAIExecutiveCommand => {
    if (!item) return false;
    const key = `${item.command ?? item.verifyUrl ?? item.label}:${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function statusFromMind(status: DecisionMind["status"]): DecisionAIExecutivePhaseStatus {
  if (status === "blocked") return "block";
  if (status === "waiting-for-evidence") return "watch";
  return "pass";
}

function statusFromLoop(status: DecisionAICognitiveLoop["status"]): DecisionAIExecutivePhaseStatus {
  if (status === "blocked") return "block";
  if (status === "repair" || status === "needs-evidence" || status === "needs-config") return "watch";
  return "pass";
}

function statusFromDeliberation(status: DecisionAIDeliberation["status"]): DecisionAIExecutivePhaseStatus {
  if (status === "blocked") return "block";
  if (status === "needs-proof") return "watch";
  return "pass";
}

function statusFromControl(status: DecisionAIControlPacket["status"]): DecisionAIExecutivePhaseStatus {
  if (status === "blocked") return "block";
  if (status === "manual-proof" || status === "ready-ai-review") return "watch";
  return "pass";
}

function statusFromExperiment(status: DecisionAIExperimentEpisode["status"]): DecisionAIExecutivePhaseStatus {
  if (status === "blocked") return "block";
  if (status === "shadow-recorded") return "pass";
  return "watch";
}

function statusFromReasoningAlignment(status: DecisionReasoningAlignment["status"] | "not-attached"): DecisionAIExecutivePhaseStatus {
  if (status === "blocked" || status === "drift" || status === "not-attached") return "block";
  if (status === "watching") return "watch";
  return "pass";
}

function phase(input: DecisionAIExecutivePhase): DecisionAIExecutivePhase {
  return {
    ...input,
    signal: compact(input.signal, 360),
    evidence: unique(input.evidence, 8),
    nextAction: compact(input.nextAction, 260)
  };
}

function buildPhases({
  mind,
  cognitiveLoop,
  session,
  reasoningAlignment,
  deliberation,
  control,
  experimentEpisode,
  supabaseIsolation,
  selectedCommand
}: {
  mind: DecisionMind;
  cognitiveLoop: DecisionAICognitiveLoop;
  session: DecisionAISession;
  reasoningAlignment?: DecisionReasoningAlignment | null;
  deliberation: DecisionAIDeliberation;
  control: DecisionAIControlPacket;
  experimentEpisode: DecisionAIExperimentEpisode;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  selectedCommand: DecisionAIExecutiveCommand;
}): DecisionAIExecutivePhase[] {
  return [
    phase({
      id: "observe",
      label: "Observe active mind",
      status: statusFromMind(mind.status),
      signal: mind.thinkingTrace.synthesis,
      evidence: [mind.mindHash, mind.thinkingTrace.status, mind.activeDecision.source],
      nextAction: mind.thinkingTrace.nextEvidenceAction
    }),
    phase({
      id: "align",
      label: "Align thought to proof",
      status: statusFromReasoningAlignment(reasoningAlignment?.status ?? "not-attached"),
      signal: reasoningAlignment?.summary ?? "Reasoning alignment is not attached to this executive packet.",
      evidence: [
        reasoningAlignment?.alignmentHash ?? "no-alignment-hash",
        reasoningAlignment?.status ?? "not-attached",
        reasoningAlignment ? `score:${reasoningAlignment.alignmentScore}` : "",
        reasoningAlignment?.nextAlignment?.label ?? ""
      ],
      nextAction:
        reasoningAlignment?.nextAlignment?.reason ??
        reasoningAlignment?.checks.find((item) => item.status !== "pass")?.nextAction ??
        "Attach reasoning alignment before trusting the executive thought trace."
    }),
    phase({
      id: "orient",
      label: "Orient metareasoning",
      status: session.metareasoning.status === "blocked" ? "block" : session.metareasoning.status === "repair" || session.metareasoning.status === "hold" ? "watch" : "pass",
      signal: session.metareasoning.summary,
      evidence: [session.sessionHash, session.metareasoning.status, `debt:${session.metareasoning.evidenceDebt}`, `contradictions:${session.metareasoning.contradictionCount}`],
      nextAction: session.metareasoning.requiredEvidence[0] ?? session.nextSafeAction
    }),
    phase({
      id: "deliberate",
      label: "Deliberate public stance",
      status: statusFromDeliberation(deliberation.status),
      signal: deliberation.finalResolution.publicAnswer,
      evidence: [deliberation.deliberationHash, deliberation.finalResolution.stance, deliberation.activeDecision.trustCeiling],
      nextAction: deliberation.nextProof.expectedEvidence
    }),
    phase({
      id: "decide",
      label: "Reduce control packet",
      status: statusFromControl(control.status),
      signal: control.summary,
      evidence: [control.controlHash, control.status, control.nextMove.runMode],
      nextAction: control.escalation.reason
    }),
    phase({
      id: "act",
      label: "Select bounded proof",
      status: selectedCommand.safeToRun ? "pass" : selectedCommand.runMode !== "manual-only" ? "watch" : "block",
      signal: `${selectedCommand.label} from ${selectedCommand.source}.`,
      evidence: [selectedCommand.runMode, selectedCommand.verifyUrl ?? "manual", selectedCommand.command ?? "no-command"],
      nextAction: selectedCommand.expectedEvidence
    }),
    phase({
      id: "verify",
      label: "Verify experiment episode",
      status: statusFromExperiment(experimentEpisode.status),
      signal: experimentEpisode.summary,
      evidence: [experimentEpisode.episodeHash, experimentEpisode.stability.status, experimentEpisode.chain.responseHash ?? "no-response-hash"],
      nextAction: experimentEpisode.stability.nextAction
    }),
    phase({
      id: "remember",
      label: "Draft memory only",
      status: supabaseIsolation.locks.canWriteDecisionMemory ? "pass" : supabaseIsolation.status.startsWith("blocked") ? "block" : "watch",
      signal: supabaseIsolation.summary,
      evidence: [supabaseIsolation.isolationHash, supabaseIsolation.status, `missing:${supabaseIsolation.env.missing.length}`],
      nextAction: supabaseIsolation.locks.canWriteDecisionMemory ? "Persist only through the dedicated memory route with admin/write approval." : supabaseIsolation.nextAction
    })
  ];
}

function conflict(input: DecisionAIExecutiveConflict): DecisionAIExecutiveConflict {
  return {
    ...input,
    detail: compact(input.detail, 300),
    effect: compact(input.effect, 220)
  };
}

function buildConflicts({
  mind,
  session,
  deliberation,
  control,
  experimentEpisode,
  reasoningAlignment,
  capabilityContract,
  supabaseIsolation,
  providerIngestionEvidence
}: {
  mind: DecisionMind;
  session: DecisionAISession;
  deliberation: DecisionAIDeliberation;
  control: DecisionAIControlPacket;
  experimentEpisode: DecisionAIExperimentEpisode;
  reasoningAlignment?: DecisionReasoningAlignment | null;
  capabilityContract: DecisionCapabilityContract;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
}): DecisionAIExecutiveConflict[] {
  const stanceAction = actionFromStance(deliberation.finalResolution.stance);
  return [
    conflict({
      id: "stance-vs-authority",
      status: stanceAction === mind.activeDecision.authorizedAction || stanceAction === "avoid" ? "resolved" : "watch",
      label: "Public stance versus authority",
      detail: `Deliberation stance maps to ${stanceAction}; authority action is ${mind.activeDecision.authorizedAction}.`,
      effect: "The executive action uses the same-or-safer action across authority, session, and deliberation."
    }),
    conflict({
      id: "metareasoning-pressure",
      status: session.metareasoning.status === "blocked" ? "block" : session.metareasoning.status === "repair" || session.metareasoning.status === "hold" ? "watch" : "resolved",
      label: "Metareasoning pressure",
      detail: `${session.metareasoning.summary} Strongest objection: ${session.metareasoning.strongestObjection}`,
      effect: "High evidence debt or contradictions force repair/hold before trust can rise."
    }),
    conflict({
      id: "reasoning-alignment",
      status:
        !reasoningAlignment || reasoningAlignment.status === "blocked" || reasoningAlignment.status === "drift"
          ? "block"
          : reasoningAlignment.status === "watching"
            ? "watch"
            : "resolved",
      label: "Reasoning alignment",
      detail: reasoningAlignment?.summary ?? "Reasoning alignment is not attached to this executive packet.",
      effect:
        reasoningAlignment?.status === "aligned"
          ? "The active thought trace and information-gain proof ranking agree."
          : reasoningAlignment?.nextAlignment
            ? `${reasoningAlignment.nextAlignment.label} should be made explicit before the executive trusts the thought trace.`
            : "The executive must attach reasoning alignment before trusting the thought trace."
    }),
    conflict({
      id: "capability-lock",
      status: capabilityContract.counts.locked ? "block" : capabilityContract.counts["proof-ready"] || capabilityContract.counts.shadow ? "watch" : "resolved",
      label: "Capability contract",
      detail: `${capabilityContract.summary} Locked capabilities: ${capabilityContract.counts.locked}.`,
      effect: "Locked capabilities prevent live publishing, persistence, and learned-guardrail activation."
    }),
    conflict({
      id: "provider-ingestion",
      status: !providerIngestionEvidence
        ? "watch"
        : providerIngestionEvidence.status === "blocked"
          ? "block"
          : providerIngestionEvidence.status === "ready-dry-run"
            ? "resolved"
            : "watch",
      label: "Provider ingestion evidence",
      detail: providerIngestionEvidence?.summary ?? "Provider ingestion evidence is not attached to this executive packet.",
      effect:
        providerIngestionEvidence?.status === "ready-dry-run"
          ? "Provider evidence can move through supervised dry-runs, while writes and training remain locked."
          : providerIngestionEvidence?.nextProviderSignal
            ? `${providerIngestionEvidence.nextProviderSignal.label} is the next real-data proof before trust can rise.`
            : "The executive should verify provider ingestion readiness before trusting real-data claims."
    }),
    conflict({
      id: "experiment-proof",
      status: experimentEpisode.status === "shadow-recorded" ? "resolved" : experimentEpisode.status === "blocked" ? "block" : "watch",
      label: "Experiment proof",
      detail: experimentEpisode.experimentNarrative.observed,
      effect: "The executive can only advance on observed, stable, read-only proof."
    }),
    conflict({
      id: "database-memory",
      status: supabaseIsolation.locks.canWriteDecisionMemory ? "resolved" : supabaseIsolation.status.startsWith("blocked") ? "block" : "watch",
      label: "Supabase memory lock",
      detail: supabaseIsolation.summary,
      effect: "Memory stays a draft until the OddsPadi project, key, MCP, and schema gates pass."
    }),
    conflict({
      id: "control-side-effects",
      status: control.controls.canPersist || control.controls.canPublish || control.controls.canTrain || control.controls.canUpgradePublicAction ? "block" : "resolved",
      label: "Side-effect controls",
      detail: `Persist ${control.controls.canPersist}; publish ${control.controls.canPublish}; train ${control.controls.canTrain}; upgrade ${control.controls.canUpgradePublicAction}.`,
      effect: "The executive packet must remain read-only/shadow-only."
    })
  ];
}

function normalizeEvidenceFindings(value: unknown): DecisionAIExecutiveEvidenceFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const evidenceId = boundedText(record.evidenceId, 120);
      const status = isFindingStatus(record.status) ? record.status : null;
      const finding = boundedText(record.finding, 420);
      if (!evidenceId || !status || !finding) return null;
      return { evidenceId, status, finding };
    })
    .filter((item): item is DecisionAIExecutiveEvidenceFinding => Boolean(item))
    .slice(0, 16);
}

function normalizeSafetyGates(value: unknown): DecisionAIExecutiveSafetyGate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = boundedText(record.label, 140);
      const reason = boundedText(record.reason, 420);
      const status = isPhaseStatus(record.status) ? record.status : null;
      if (!label || !reason || !status) return null;
      return {
        id: boundedText(record.id, 100) || `executive-review-gate-${index + 1}`,
        label,
        status,
        reason
      };
    })
    .filter((item): item is DecisionAIExecutiveSafetyGate => Boolean(item))
    .slice(0, 10);
}

export function safeParseAIExecutiveReview(text: string): DecisionAIExecutiveReview | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isReviewVerdict(parsed.reviewVerdict)) return null;
    if (!isAction(parsed.recommendedAction)) return null;
    if (!isDirectiveAction(parsed.recommendedDirective)) return null;
    if (!isTrustPatch(parsed.trustPatch)) return null;
    if (
      parsed.publishPermission !== "never" ||
      parsed.persistencePermission !== "never" ||
      parsed.trainingPermission !== "never" ||
      parsed.publicActionUpgradePermission !== "never"
    ) {
      return null;
    }

    const summary = boundedText(parsed.summary, 720);
    const evidenceFindings = normalizeEvidenceFindings(parsed.evidenceFindings);
    const safetyGates = normalizeSafetyGates(parsed.safetyGates);
    if (!summary || !evidenceFindings.length || !safetyGates.length) return null;

    return {
      reviewVerdict: parsed.reviewVerdict,
      recommendedAction: parsed.recommendedAction,
      recommendedDirective: parsed.recommendedDirective,
      trustPatch: parsed.trustPatch,
      summary,
      evidenceFindings,
      riskFlags: boundedList(parsed.riskFlags, 8),
      dataGaps: boundedList(parsed.dataGaps, 8),
      falsifiers: boundedList(parsed.falsifiers, 8),
      requiredEvidence: boundedList(parsed.requiredEvidence, 10),
      safetyGates,
      unsupportedClaims: boundedList(parsed.unsupportedClaims, 8),
      publishPermission: "never",
      persistencePermission: "never",
      trainingPermission: "never",
      publicActionUpgradePermission: "never"
    };
  } catch {
    return null;
  }
}

function executiveStatus({
  session,
  deliberation,
  control,
  cognitiveLoop,
  reasoningAlignment,
  selectedCommand
}: {
  session: DecisionAISession;
  deliberation: DecisionAIDeliberation;
  control: DecisionAIControlPacket;
  cognitiveLoop: DecisionAICognitiveLoop;
  reasoningAlignment?: DecisionReasoningAlignment | null;
  selectedCommand: DecisionAIExecutiveCommand;
}): DecisionAIExecutiveStatus {
  if (
    control.status === "blocked" ||
    deliberation.status === "blocked" ||
    session.metareasoning.status === "blocked" ||
    cognitiveLoop.status === "blocked" ||
    !reasoningAlignment ||
    reasoningAlignment.status === "blocked"
  ) {
    return "blocked";
  }
  if (reasoningAlignment.status === "drift") return "repair";
  if (selectedCommand.safeToRun && selectedCommand.runMode === "read-only") return "ready-readonly";
  if (control.controls.canAskOpenAI || session.controls.canSubmitToOpenAI || cognitiveLoop.permissions.canSubmitToOpenAI) return "ready-ai-review";
  if (cognitiveLoop.status === "repair" || session.metareasoning.status === "repair") return "repair";
  return "needs-proof";
}

function directiveAction({
  status,
  selectedCommand
}: {
  status: DecisionAIExecutiveStatus;
  selectedCommand: DecisionAIExecutiveCommand;
}): DecisionAIExecutiveDirectiveAction {
  if (status === "blocked") return "block";
  if (status === "repair") return "repair";
  if (status === "ready-ai-review") return "ask-ai-review";
  if (selectedCommand.safeToRun && selectedCommand.runMode === "read-only") return "run-readonly-proof";
  if (selectedCommand.safeToRun && selectedCommand.runMode === "dry-run") return "run-dry-run-proof";
  return "hold";
}

function summaryFor(status: DecisionAIExecutiveStatus, commandItem: DecisionAIExecutiveCommand): string {
  if (status === "ready-readonly") return `AI executive can run ${commandItem.label} as the next read-only proof; publish, persist, train, and trust raises remain locked.`;
  if (status === "ready-ai-review") return "AI executive can ask for guarded AI review, but only through citation, firewall, authority, and no-upgrade controls.";
  if (status === "repair") return "AI executive routes the turn to repair before trust can move.";
  if (status === "blocked") return "AI executive is blocked; keep the public stance conservative and clear the highest lock first.";
  return "AI executive is holding for stronger proof before state can advance.";
}

function policyStatusFor({
  status,
  selectedCommand
}: {
  status: DecisionAIExecutiveStatus;
  selectedCommand: DecisionAIExecutiveCommand;
}): DecisionAIExecutivePolicyStatus {
  if (status === "blocked") return "blocked";
  if (status === "repair") return "repair-first";
  if (selectedCommand.safeToRun && selectedCommand.runMode === "read-only") return "approved-readonly";
  return "watch-proof";
}

function policyActionFor(status: DecisionAIExecutivePolicyStatus, selectedCommand: DecisionAIExecutiveCommand): DecisionAIExecutivePolicyAction {
  if (status === "blocked") return "block";
  if (status === "repair-first") return "repair-evidence";
  if (selectedCommand.safeToRun) return "observe-proof";
  return "hold";
}

function buildExecutivePolicy({
  status,
  activeDecision,
  finalDirective,
  phases,
  conflicts,
  proofReceipt,
  reasoningAlignment,
  providerIngestionEvidence,
  supabaseIsolation
}: {
  status: DecisionAIExecutiveStatus;
  activeDecision: DecisionAIExecutive["activeDecision"];
  finalDirective: DecisionAIExecutive["finalDirective"];
  phases: DecisionAIExecutivePhase[];
  conflicts: DecisionAIExecutiveConflict[];
  proofReceipt: DecisionAIExecutiveProofReceipt;
  reasoningAlignment?: DecisionReasoningAlignment | null;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
}): DecisionAIExecutivePolicy {
  const policyStatus = policyStatusFor({ status, selectedCommand: finalDirective.command });
  const action = policyActionFor(policyStatus, finalDirective.command);
  const blockingConflicts = conflicts.filter((item) => item.status === "block");
  const watchConflicts = conflicts.filter((item) => item.status === "watch");
  const drivers: DecisionAIExecutivePolicy["confidenceBudget"]["drivers"] = [
    {
      id: "alignment",
      label: "Reasoning alignment",
      status:
        !reasoningAlignment || reasoningAlignment.status === "blocked" || reasoningAlignment.status === "drift"
          ? "block"
          : reasoningAlignment.status === "watching"
            ? "watch"
            : "pass",
      impact: reasoningAlignment?.status === "aligned" ? 12 : reasoningAlignment?.status === "watching" ? -8 : -24,
      reason: reasoningAlignment?.summary ?? "Reasoning alignment is not attached."
    },
    {
      id: "selected-proof",
      label: "Selected proof",
      status: finalDirective.command.safeToRun ? "pass" : finalDirective.command.runMode !== "manual-only" ? "watch" : "block",
      impact: finalDirective.command.safeToRun ? 10 : -18,
      reason: `${finalDirective.command.label} is ${finalDirective.command.runMode} from ${finalDirective.command.source}.`
    },
    {
      id: "conflict-pressure",
      label: "Conflict pressure",
      status: blockingConflicts.length ? "block" : watchConflicts.length ? "watch" : "pass",
      impact: -18 * blockingConflicts.length - 6 * watchConflicts.length,
      reason: `${blockingConflicts.length} blocking and ${watchConflicts.length} watch conflicts remain.`
    },
    {
      id: "provider-ingestion",
      label: "Provider ingestion",
      status: providerIngestionEvidence?.status === "ready-dry-run" ? "pass" : providerIngestionEvidence?.status === "blocked" ? "block" : "watch",
      impact: providerIngestionEvidence?.status === "ready-dry-run" ? 8 : providerIngestionEvidence?.status === "blocked" ? -12 : -4,
      reason: providerIngestionEvidence?.summary ?? "Provider ingestion evidence is not attached."
    },
    {
      id: "memory-isolation",
      label: "Memory isolation",
      status: supabaseIsolation.locks.canWriteDecisionMemory ? "pass" : supabaseIsolation.status.startsWith("blocked") ? "block" : "watch",
      impact: supabaseIsolation.locks.canWriteDecisionMemory ? 8 : -10,
      reason: supabaseIsolation.summary
    },
    {
      id: "proof-receipt",
      label: "Proof receipt",
      status: proofReceipt.status === "observed" ? "pass" : proofReceipt.status === "observed-warning" || proofReceipt.status === "not-run" ? "watch" : "block",
      impact: proofReceipt.status === "observed" ? 10 : proofReceipt.status === "not-run" ? -4 : -12,
      reason: proofReceipt.summary
    }
  ];
  const score = clampNumber(70 + drivers.reduce((total, item) => total + item.impact, 0));
  const vetoes = unique(
    [
      ...blockingConflicts.map((item) => `${item.label}: ${item.effect}`),
      !reasoningAlignment || reasoningAlignment.status === "blocked" || reasoningAlignment.status === "drift"
        ? "Reasoning alignment must be attached and not drifting before the executive can trust the thought trace."
        : null,
      !finalDirective.command.safeToRun ? "Selected proof command is not safe to run." : null,
      supabaseIsolation.locks.canWriteDecisionMemory ? null : "Memory and learning writes remain locked by OddsPadi Supabase isolation."
    ],
    8
  );
  const requiredProof = unique(
    [
      finalDirective.command.expectedEvidence,
      reasoningAlignment?.nextAlignment?.reason ?? null,
      phases.find((item) => item.id === "align" && item.status !== "pass")?.nextAction,
      phases.find((item) => item.status === "block")?.nextAction,
      proofReceipt.target.reason
    ],
    8
  );
  const selectedProof = {
    label: finalDirective.command.label,
    source: finalDirective.command.source,
    runMode: finalDirective.command.runMode,
    safeToRun: finalDirective.command.safeToRun,
    verifyUrl: finalDirective.command.verifyUrl,
    expectedEvidence: finalDirective.command.expectedEvidence
  };
  const policyHash = stableHash({
    status,
    policyStatus,
    action,
    activeDecision: [activeDecision.matchId, activeDecision.executiveAction, activeDecision.trustCeiling],
    selectedProof,
    conflicts: conflicts.map((item) => [item.id, item.status]),
    alignment: reasoningAlignment ? [reasoningAlignment.alignmentHash, reasoningAlignment.status, reasoningAlignment.alignmentScore] : null,
    provider: providerIngestionEvidence ? [providerIngestionEvidence.evidenceHash, providerIngestionEvidence.status] : null,
    supabase: [supabaseIsolation.isolationHash, supabaseIsolation.status],
    proofReceipt: [proofReceipt.status, proofReceipt.target.path]
  });

  return {
    policyHash,
    status: policyStatus,
    action,
    thesis: compact(
      `${activeDecision.match ?? "The active decision"} stays ${activeDecision.executiveAction}; the executive may only ${action.replace("-", " ")} through ${selectedProof.label}.`,
      260
    ),
    decisionRule: compact(
      vetoes.length
        ? `Do not advance public action while ${vetoes[0]}`
        : `Proceed only with ${selectedProof.runMode} proof; keep publish, persist, train, trust raise, and public-action upgrade locked.`,
      320
    ),
    selectedProof,
    confidenceBudget: {
      score,
      ceiling: finalDirective.confidenceCeiling,
      drivers
    },
    vetoes,
    requiredProof,
    safeOperatingMode: selectedProof.runMode,
    proofUrl: proofReceipt.target.path ?? selectedProof.verifyUrl,
    canEscalatePublicAction: false,
    canPersist: false,
    canPublish: false,
    canTrain: false
  };
}

function buildExecutiveEvidencePacket({
  activeDecision,
  laneStates,
  phases,
  conflicts,
  policy,
  finalDirective,
  proofReceipt,
  memoryDraft,
  controls,
  reasoningAlignment = null,
  providerIngestionEvidence = null
}: Pick<DecisionAIExecutivePayloadInput, "activeDecision" | "laneStates" | "phases" | "conflicts" | "policy" | "finalDirective" | "proofReceipt" | "memoryDraft" | "controls"> & {
  reasoningAlignment?: DecisionReasoningAlignment | null;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
}): DecisionAIExecutiveEvidenceItem[] {
  return [
    {
      id: "active-decision",
      source: "ai-executive",
      label: "Active executive decision",
      status: activeDecision.executiveAction,
      detail: `${activeDecision.match ?? "No active match"} uses executive action ${activeDecision.executiveAction}, public stance ${activeDecision.publicStance}, and trust ceiling ${activeDecision.trustCeiling}.`
    },
    {
      id: "lane-states",
      source: "ai-executive",
      label: "Lane states",
      status: Object.values(laneStates).join("|"),
      detail: JSON.stringify(laneStates)
    },
    {
      id: "reasoning-alignment-status",
      source: "reasoning-alignment",
      label: "Reasoning alignment",
      status: reasoningAlignment?.status ?? "not-attached",
      detail: reasoningAlignment
        ? `${reasoningAlignment.summary} Score ${reasoningAlignment.alignmentScore}; drift ${reasoningAlignment.driftScore}; target ${reasoningAlignment.nextAlignment?.label ?? "none"}.`
        : "Reasoning alignment is not attached to this executive packet."
    },
    ...(reasoningAlignment
      ? [
          {
            id: "reasoning-alignment-checks",
            source: "reasoning-alignment",
            label: "Reasoning alignment checks",
            status: reasoningAlignment.checks.find((item) => item.status === "block")?.status ?? reasoningAlignment.checks.find((item) => item.status === "watch")?.status ?? "pass",
            detail: reasoningAlignment.checks
              .slice()
              .sort((a, b) => a.score - b.score)
              .slice(0, 3)
              .map((item) => `${item.label}: ${item.status} ${item.score}/100`)
              .join("; ")
          }
        ]
      : []),
    policyEvidenceItem(policy),
    {
      id: "final-directive",
      source: "ai-executive",
      label: "Final directive",
      status: finalDirective.action,
      detail: `${finalDirective.reason} Selected command: ${finalDirective.command.label}; run mode ${finalDirective.command.runMode}; safe ${finalDirective.command.safeToRun}.`
    },
    {
      id: "executive-proof-receipt",
      source: "ai-executive-proof",
      label: "Executive proof receipt",
      status: proofReceipt.status,
      detail: `${proofReceipt.summary} Target: ${proofReceipt.target.path ?? "none"}; observed ${proofReceipt.observation.responseHash ?? "not-observed"}; shell ${proofReceipt.controls.canExecuteShell}; persist ${proofReceipt.controls.canPersist}.`
    },
    {
      id: "controls",
      source: "ai-executive",
      label: "Side-effect controls",
      status: controls.canPersist || controls.canPublish || controls.canTrain || controls.canUpgradePublicAction ? "block" : "locked",
      detail: `Read-only ${controls.canRunReadOnly}; dry-run ${controls.canRunDryRun}; ask OpenAI ${controls.canAskOpenAI}; persist ${controls.canPersist}; publish ${controls.canPublish}; train ${controls.canTrain}; raise trust ${controls.canRaiseTrust}; upgrade action ${controls.canUpgradePublicAction}.`
    },
    {
      id: "memory-draft",
      source: "ai-executive",
      label: "Memory draft",
      status: memoryDraft.canPersist ? "persistable" : "draft-only",
      detail: `${memoryDraft.label}: ${memoryDraft.content}`
    },
    ...(providerIngestionEvidence
      ? [
          {
            id: "provider-ingestion-status",
            source: "provider-ingestion-evidence",
            label: "Provider ingestion status",
            status: providerIngestionEvidence.status,
            detail: `${providerIngestionEvidence.summary} Dry-run ${providerIngestionEvidence.controls.canRunProviderDryRun}; storage ${providerIngestionEvidence.supabase.storageReady}; next signal ${providerIngestionEvidence.nextProviderSignal?.label ?? "none"}.`
          },
          {
            id: "provider-ingestion-supabase",
            source: "provider-ingestion-evidence",
            label: "Provider ingestion Supabase proof",
            status: providerIngestionEvidence.supabase.storageReady ? "storage-ready" : "storage-held",
            detail: `Expected ${providerIngestionEvidence.supabase.expectedProjectRef}; configured ${providerIngestionEvidence.supabase.configuredProjectRef ?? "missing"}; schema ${providerIngestionEvidence.supabase.verifiedTableCount}/${providerIngestionEvidence.supabase.expectedTableCount}; missing ${providerIngestionEvidence.supabase.missingForStorage.join(", ") || "none"}.`
          },
          {
            id: "provider-ingestion-corpus",
            source: "provider-ingestion-evidence",
            label: "Provider ingestion corpus",
            status: providerIngestionEvidence.corpus.status,
            detail: `${providerIngestionEvidence.corpus.seasonFrom}-${providerIngestionEvidence.corpus.seasonTo}; ${providerIngestionEvidence.corpus.plannedJobs}/${providerIngestionEvidence.corpus.totalCandidateJobs} dry-run jobs; ${providerIngestionEvidence.training.realFinishedFixtures}/${providerIngestionEvidence.training.minimumRecommendedFixtures} real fixtures; latest backtest ${providerIngestionEvidence.training.latestBacktestStatus}.`
          }
        ]
      : []),
    ...phases.map((item) => ({
      id: `phase-${item.id}`,
      source: "ai-executive-phase",
      label: item.label,
      status: item.status,
      detail: `${item.signal} Next action: ${item.nextAction}`
    })),
    ...conflicts.map((item) => ({
      id: `conflict-${item.id}`,
      source: "ai-executive-conflict",
      label: item.label,
      status: item.status,
      detail: `${item.detail} Effect: ${item.effect}`
    }))
  ].slice(0, 28);
}

function deterministicExecutiveReview(executive: DecisionAIExecutivePayloadInput): DecisionAIExecutiveReview {
  const blockingConflicts = executive.conflicts.filter((item) => item.status === "block");
  const watchConflicts = executive.conflicts.filter((item) => item.status === "watch");
  const reviewVerdict: DecisionAIExecutiveReviewVerdict =
    executive.status === "blocked" || blockingConflicts.length ? "block" : executive.status === "repair" ? "repair" : watchConflicts.length ? "needs-evidence" : "agree";
  return {
    reviewVerdict,
    recommendedAction: executive.activeDecision.executiveAction,
    recommendedDirective: executive.finalDirective.action,
    trustPatch: reviewVerdict === "block" ? "block" : reviewVerdict === "repair" ? "repair-first" : watchConflicts.length ? "lower-ceiling" : "keep-ceiling",
    summary:
      reviewVerdict === "agree"
        ? "Deterministic executive review agrees with the current bounded proof directive."
        : `Deterministic executive review keeps the executive conservative because ${blockingConflicts[0]?.label ?? watchConflicts[0]?.label ?? "proof gates"} still needs proof.`,
    evidenceFindings: executive.evidencePacket.slice(0, 12).map((item) => ({
      evidenceId: item.id,
      status: item.status === "block" || item.status === "blocked" ? "challenges" : item.status === "missing" ? "missing" : "supports",
      finding: compact(item.detail, 360)
    })),
    riskFlags: unique([...blockingConflicts.map((item) => item.label), ...watchConflicts.map((item) => item.label)], 8),
    dataGaps: unique(
      [
        ...executive.policy.vetoes,
        executive.conflicts.find((item) => item.id === "database-memory")?.detail,
        executive.phases.find((item) => item.id === "remember")?.nextAction,
        executive.phases.find((item) => item.status === "block")?.nextAction
      ],
      8
    ),
    falsifiers: unique(
      [
        "A proof route contradicts the selected read-only command.",
        "Supabase project isolation remains blocked for OddsPadi memory.",
        "Evidence debt or capability locks remain at block status."
      ],
      8
    ),
    requiredEvidence: unique([executive.finalDirective.command.expectedEvidence, ...executive.policy.requiredProof, ...executive.phases.filter((item) => item.status !== "pass").map((item) => item.nextAction)], 10),
    safetyGates: [
      {
        id: "same-or-safer-action",
        label: "Same-or-safer action",
        status: executive.activeDecision.executiveAction === "avoid" ? "pass" : "watch",
        reason: `Executive action is ${executive.activeDecision.executiveAction}.`
      },
      {
        id: "bounded-command",
        label: "Bounded command",
        status: executive.finalDirective.command.safeToRun ? "pass" : "block",
        reason: `Selected command run mode is ${executive.finalDirective.command.runMode}.`
      },
      {
        id: "side-effects",
        label: "Side effects locked",
        status: executive.controls.canPersist || executive.controls.canPublish || executive.controls.canTrain || executive.controls.canUpgradePublicAction ? "block" : "pass",
        reason: "Persist, publish, train, raise trust, and public-action upgrade permissions remain false."
      },
      {
        id: "memory-isolation",
        label: "Memory isolation",
        status: executive.memoryDraft.canPersist ? "watch" : "block",
        reason: "Memory is draft-only until OddsPadi Supabase isolation passes."
      }
    ],
    unsupportedClaims: [],
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never",
    publicActionUpgradePermission: "never"
  };
}

function sanitizeExecutiveReview(review: DecisionAIExecutiveReview, executive: DecisionAIExecutive): DecisionAIExecutiveReview {
  const allowedEvidenceIds = new Set(executive.evidencePacket.map((item) => item.id));
  const evidenceFindings = review.evidenceFindings.filter((finding) => allowedEvidenceIds.has(finding.evidenceId)).slice(0, 16);
  return {
    ...review,
    recommendedAction: safestAction(executive.activeDecision.executiveAction, review.recommendedAction),
    recommendedDirective: safestDirective(executive.finalDirective.action, review.recommendedDirective),
    evidenceFindings: evidenceFindings.length ? evidenceFindings : executive.deterministicFallback.evidenceFindings,
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never",
    publicActionUpgradePermission: "never"
  };
}

export function buildOpenAIExecutiveReviewPayload({
  executive,
  model
}: {
  executive: DecisionAIExecutivePayloadInput | DecisionAIExecutive;
  model: string;
}) {
  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system" as const,
        content:
          "You are OddsPadi's AI executive reviewer. Use only supplied JSON evidence IDs. Return public reasoning only, not hidden chain-of-thought. You may agree, downgrade, request evidence, repair, or block. You must not invent injuries, lineups, suspensions, weather, news, odds, scores, match events, bookmaker movement, or private facts. You must not publish, persist, train, stake, raise trust, or upgrade the current public action. recommendedAction and recommendedDirective must be the same or safer than the current executive decision."
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          date: executive.date,
          sport: executive.sport,
          status: executive.status,
          summary: executive.summary,
          activeDecision: executive.activeDecision,
          laneStates: executive.laneStates,
          phases: executive.phases,
          conflicts: executive.conflicts,
          policy: executive.policy,
          finalDirective: executive.finalDirective,
          proofReceipt: executive.proofReceipt,
          memoryDraft: executive.memoryDraft,
          controls: executive.controls,
          locks: executive.locks,
          evidencePacket: executive.evidencePacket,
          outputRules: {
            allowedEvidenceIds: executive.evidencePacket.map((item) => item.id),
            currentExecutiveAction: executive.activeDecision.executiveAction,
            currentDirective: executive.finalDirective.action,
            actionRank: { avoid: 0, monitor: 1, consider: 2 },
            directiveRank: { block: 0, repair: 1, hold: 2, "ask-ai-review": 3, "run-dry-run-proof": 4, "run-readonly-proof": 5 },
            publicReasoningOnly: true,
            noPersistence: true,
            noPublishing: true,
            noTraining: true,
            noTrustRaise: true,
            noPublicActionUpgrade: true
          }
        })
      }
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "OddsPadiAIExecutiveReview",
        strict: true,
        schema: aiExecutiveReviewSchema
      }
    },
    max_output_tokens: 1700
  };
}

export function buildDecisionAIExecutive({
  mind,
  cognitiveLoop,
  session,
  deliberation,
  control,
  experimentEpisode,
  capabilityContract,
  reasoningAlignment = null,
  supabaseIsolation,
  providerIngestionEvidence = null,
  runRequested = false,
  env = process.env,
  model = getDecisionOpenAIModel(env),
  now = new Date()
}: {
  mind: DecisionMind;
  cognitiveLoop: DecisionAICognitiveLoop;
  session: DecisionAISession;
  deliberation: DecisionAIDeliberation;
  control: DecisionAIControlPacket;
  experimentEpisode: DecisionAIExperimentEpisode;
  capabilityContract: DecisionCapabilityContract;
  reasoningAlignment?: DecisionReasoningAlignment | null;
  supabaseIsolation: DecisionSupabaseProjectIsolation;
  providerIngestionEvidence?: DecisionProviderIngestionEvidence | null;
  runRequested?: boolean;
  env?: Record<string, string | undefined>;
  model?: string;
  now?: Date;
}): DecisionAIExecutive {
  const selectedCommand = chooseCommand({ control, cognitiveLoop, experimentEpisode, deliberation, capabilityContract, reasoningAlignment, providerIngestionEvidence });
  const phases = buildPhases({ mind, cognitiveLoop, session, reasoningAlignment, deliberation, control, experimentEpisode, supabaseIsolation, selectedCommand });
  const conflicts = buildConflicts({ mind, session, deliberation, control, experimentEpisode, reasoningAlignment, capabilityContract, supabaseIsolation, providerIngestionEvidence });
  const status = executiveStatus({ session, deliberation, control, cognitiveLoop, reasoningAlignment, selectedCommand });
  const executiveAction = saferAction([mind.activeDecision.authorizedAction, session.activeDecision.sessionAction, actionFromStance(deliberation.finalResolution.stance)]);
  const directive = directiveAction({ status, selectedCommand });
  const executiveHash = stableHash({
    mind: mind.mindHash,
    loop: cognitiveLoop.loopHash,
    session: session.sessionHash,
    deliberation: deliberation.deliberationHash,
    control: control.controlHash,
    experiment: experimentEpisode.episodeHash,
    reasoningAlignment: reasoningAlignment?.alignmentHash ?? null,
    capability: capabilityContract.contractHash,
    supabase: supabaseIsolation.isolationHash,
    providerIngestion: providerIngestionEvidence?.evidenceHash ?? null,
    status,
    action: executiveAction,
    command: selectedCommand.command,
    phases: phases.map((item) => [item.id, item.status]),
    conflicts: conflicts.map((item) => [item.id, item.status])
  });
  const controls = {
    canRunReadOnly: selectedCommand.safeToRun && selectedCommand.runMode === "read-only",
    canRunDryRun: selectedCommand.safeToRun && selectedCommand.runMode === "dry-run",
    canAskOpenAI: status === "ready-ai-review",
    canPersist: false as const,
    canPublish: false as const,
    canTrain: false as const,
    canRaiseTrust: false as const,
    canUpgradePublicAction: false as const
  };
  const conflictBlocker = conflicts.find((item) => item.status === "block") ?? conflicts.find((item) => item.status === "watch");
  const activeDecision = {
    matchId: session.activeDecision.matchId,
    match: session.activeDecision.match,
    baselineAction: session.activeDecision.baselineAction,
    authorityAction: session.activeDecision.authorityAction,
    sessionAction: session.activeDecision.sessionAction,
    executiveAction,
    publicStance: deliberation.finalResolution.stance,
    publicPosture: session.activeDecision.publicPosture,
    trustCeiling: session.metareasoning.trustCeiling,
    canShowAsPick: false as const
  };
  const laneStates: DecisionAIExecutivePayloadInput["laneStates"] = {
    mind: mind.status,
    cognitiveLoop: cognitiveLoop.status,
    session: session.status,
    metareasoning: session.metareasoning.status,
    deliberation: deliberation.status,
    control: control.status,
    experiment: experimentEpisode.status,
    capability: capabilityContract.status,
    reasoningAlignment: reasoningAlignment?.status ?? "not-attached",
    supabaseIsolation: supabaseIsolation.status,
    providerIngestion: providerIngestionEvidence?.status ?? "not-attached"
  };
  const finalDirective = {
    action: directive,
    reason: conflictBlocker?.effect ?? selectedCommand.expectedEvidence,
    command: selectedCommand,
    confidenceCeiling: session.metareasoning.trustCeiling,
    trustPatch: cognitiveLoop.trustPatch,
    canAdvanceReadOnly: controls.canRunReadOnly
  };
  const proofReceipt = buildExecutiveProofReceipt({
    date: session.date,
    sport: session.sport,
    finalDirective,
    requested: false,
    origin: decisionSiteOrigin(env),
    now
  });
  const memoryDraft = {
    label: `${session.activeDecision.match ?? "Active decision"} executive state`,
    content: compact(
      `${summaryFor(status, selectedCommand)} ${session.metareasoning.summary} ${deliberation.finalResolution.reason} ${providerIngestionEvidence?.summary ?? ""}`,
      420
    ),
    evidenceHash: executiveHash,
    canPersist: false as const
  };
  const policy = buildExecutivePolicy({
    status,
    activeDecision,
    finalDirective,
    phases,
    conflicts,
    proofReceipt,
    reasoningAlignment,
    providerIngestionEvidence,
    supabaseIsolation
  });
  const locks = unique(
    [
      "Do not publish, persist, train, stake, raise trust, or upgrade public action from the executive packet.",
      "Do not trust the executive thought trace while reasoning alignment is missing, blocked, or drifting.",
      "Run only the selected read-only or explicit dry-run proof command.",
      ...control.forbiddenActions,
      ...experimentEpisode.locks,
      ...supabaseIsolation.proof.forbiddenActions,
      ...(providerIngestionEvidence?.controls.forbiddenActions ?? [])
    ],
    24
  );
  const proofUrls = unique(
    [
      "/api/sports/decision/ai-executive",
      "/api/sports/decision/mind",
      "/api/sports/decision/ai-cognitive-loop",
      "/api/sports/decision/ai-decision-session",
      "/api/sports/decision/ai-deliberation",
      "/api/sports/decision/ai-control",
      "/api/sports/decision/ai-experiment-episode",
      "/api/sports/decision/capability-contract",
      "/api/sports/decision/reasoning-alignment",
      "/api/sports/decision/supabase-project-isolation",
      "/api/sports/decision/provider-ingestion-evidence",
      ...mind.proofUrls,
      ...cognitiveLoop.proofUrls,
      ...session.proofUrls,
      ...control.proofUrls,
      ...experimentEpisode.proofUrls,
      ...(reasoningAlignment?.proofUrls ?? []),
      ...(providerIngestionEvidence?.proofUrls ?? [])
    ],
    30
  );
  const evidencePacket = buildExecutiveEvidencePacket({
    activeDecision,
    laneStates,
    phases,
    conflicts,
    policy,
    finalDirective,
    proofReceipt,
    memoryDraft,
    controls,
    reasoningAlignment,
    providerIngestionEvidence
  });
  const executiveBase: DecisionAIExecutivePayloadInput = {
    generatedAt: now.toISOString(),
    date: session.date,
    sport: session.sport,
    mode: "ai-executive-decision",
    status,
    executiveHash,
    summary: summaryFor(status, selectedCommand),
    activeDecision,
    laneStates,
    phases,
    conflicts,
    policy,
    finalDirective,
    proofReceipt,
    memoryDraft,
    runRequested,
    openAiConfigured: Boolean(env.OPENAI_API_KEY?.trim()),
    evidencePacket,
    controls,
    locks,
    proofUrls
  };
  const deterministicFallback = deterministicExecutiveReview(executiveBase);

  return {
    ...executiveBase,
    requestPreview: buildOpenAIExecutiveReviewPayload({ executive: executiveBase, model }),
    deterministicFallback,
    review: null,
    latestRun: {
      requested: false,
      provider: "deterministic",
      status: "not-requested",
      model: null,
      reviewHash: null,
      reason: null,
      safeNoPersistence: true
    }
  };
}

function withExecutiveReview({
  executive,
  provider,
  status,
  review,
  model,
  reason = null,
  requestPreview = executive.requestPreview
}: {
  executive: DecisionAIExecutive;
  provider: "openai" | "deterministic";
  status: DecisionAIExecutiveReviewStatus;
  review: DecisionAIExecutiveReview;
  model: string | null;
  reason?: string | null;
  requestPreview?: DecisionAIExecutive["requestPreview"];
}): DecisionAIExecutive {
  const sanitized = sanitizeExecutiveReview(review, executive);
  return {
    ...executive,
    summary:
      status === "reviewed"
        ? `${executive.summary} Executive AI review returned ${sanitized.reviewVerdict}.`
        : status === "not-configured"
          ? `${executive.summary} Executive AI review used deterministic fallback because OpenAI is not configured.`
          : status === "not-requested"
            ? executive.summary
            : `${executive.summary} Executive AI review fell back after ${status}.`,
    activeDecision: {
      ...executive.activeDecision,
      executiveAction: sanitized.recommendedAction,
      canShowAsPick: false
    },
    finalDirective: {
      ...executive.finalDirective,
      action: sanitized.recommendedDirective,
      reason: sanitized.summary
    },
    requestPreview,
    review: sanitized,
    latestRun: {
      requested: true,
      provider,
      status,
      model,
      reviewHash: stableHash(sanitized),
      reason,
      safeNoPersistence: true
    },
    controls: {
      ...executive.controls,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    }
  };
}

function proofReceiptEvidenceItem(proofReceipt: DecisionAIExecutiveProofReceipt): DecisionAIExecutiveEvidenceItem {
  return {
    id: "executive-proof-receipt",
    source: "ai-executive-proof",
    label: "Executive proof receipt",
    status: proofReceipt.status,
    detail: `${proofReceipt.summary} Target: ${proofReceipt.target.path ?? "none"}; observed ${proofReceipt.observation.responseHash ?? "not-observed"}; shell ${proofReceipt.controls.canExecuteShell}; persist ${proofReceipt.controls.canPersist}.`
  };
}

function policyEvidenceItem(policy: DecisionAIExecutivePolicy): DecisionAIExecutiveEvidenceItem {
  return {
    id: "executive-policy",
    source: "ai-executive-policy",
    label: "Executive policy",
    status: policy.status,
    detail: `${policy.thesis} Rule: ${policy.decisionRule} Budget ${policy.confidenceBudget.score}/100; proof ${policy.selectedProof.label}.`
  };
}

function updatePolicyProofReceipt(policy: DecisionAIExecutivePolicy, proofReceipt: DecisionAIExecutiveProofReceipt): DecisionAIExecutivePolicy {
  const proofDriverStatus: DecisionAIExecutivePhaseStatus =
    proofReceipt.status === "observed" ? "pass" : proofReceipt.status === "observed-warning" || proofReceipt.status === "not-run" ? "watch" : "block";
  const proofDriverImpact = proofReceipt.status === "observed" ? 10 : proofReceipt.status === "not-run" ? -4 : -12;
  const drivers = policy.confidenceBudget.drivers.map((item) =>
    item.id === "proof-receipt"
      ? {
          ...item,
          status: proofDriverStatus,
          impact: proofDriverImpact,
          reason: proofReceipt.summary
        }
      : item
  );
  const score = clampNumber(70 + drivers.reduce((total, item) => total + item.impact, 0));
  const nextPolicy = {
    ...policy,
    proofUrl: proofReceipt.target.path ?? policy.proofUrl,
    confidenceBudget: {
      ...policy.confidenceBudget,
      score,
      drivers
    }
  };
  return {
    ...nextPolicy,
    policyHash: stableHash({
      previous: policy.policyHash,
      proofReceipt: [proofReceipt.status, proofReceipt.receiptHash, proofReceipt.target.path],
      score
    })
  };
}

function withExecutiveProofReceipt(executive: DecisionAIExecutive, proofReceipt: DecisionAIExecutiveProofReceipt): DecisionAIExecutive {
  const policy = updatePolicyProofReceipt(executive.policy, proofReceipt);
  let evidencePacket = executive.evidencePacket.some((item) => item.id === "executive-proof-receipt")
    ? executive.evidencePacket.map((item) => (item.id === "executive-proof-receipt" ? proofReceiptEvidenceItem(proofReceipt) : item))
    : [proofReceiptEvidenceItem(proofReceipt), ...executive.evidencePacket];
  evidencePacket = evidencePacket.some((item) => item.id === "executive-policy")
    ? evidencePacket.map((item) => (item.id === "executive-policy" ? policyEvidenceItem(policy) : item))
    : [policyEvidenceItem(policy), ...evidencePacket];
  const updatedBase: DecisionAIExecutivePayloadInput = {
    generatedAt: executive.generatedAt,
    date: executive.date,
    sport: executive.sport,
    mode: executive.mode,
    status: executive.status,
    executiveHash: executive.executiveHash,
    summary: executive.summary,
    activeDecision: executive.activeDecision,
    laneStates: executive.laneStates,
    phases: executive.phases,
    conflicts: executive.conflicts,
    policy,
    finalDirective: executive.finalDirective,
    proofReceipt,
    memoryDraft: executive.memoryDraft,
    runRequested: executive.runRequested,
    openAiConfigured: executive.openAiConfigured,
    evidencePacket,
    controls: executive.controls,
    locks: executive.locks,
    proofUrls: executive.proofUrls
  };
  const model = executive.requestPreview.model;

  return {
    ...executive,
    policy,
    proofReceipt,
    evidencePacket,
    requestPreview: buildOpenAIExecutiveReviewPayload({ executive: updatedBase, model }),
    deterministicFallback: deterministicExecutiveReview(updatedBase),
    latestRun: {
      ...executive.latestRun,
      safeNoPersistence: true
    },
    controls: {
      ...executive.controls,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canRaiseTrust: false,
      canUpgradePublicAction: false
    }
  };
}

async function fetchExecutiveProofObservation(url: string, fetchImpl: typeof fetch): Promise<DecisionAIExecutiveProofObservation> {
  try {
    const response = await fetchImpl(url);
    const text = await response.text();
    const contentType = response.headers.get("content-type");
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    const summary = summarizeDecisionAIExecutiveProofPayload(parsed);

    return {
      attempted: true,
      ok: response.ok,
      statusCode: response.status,
      contentType,
      responseHash: stableHash(text),
      bodyBytes: new TextEncoder().encode(text).length,
      success: summary.success,
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
      statusLabel: null,
      summary: null,
      signals: [],
      error: error instanceof Error ? error.message : "Executive proof observation failed."
    };
  }
}

export async function runDecisionAIExecutiveProofObservation({
  executive,
  observeRequested = false,
  origin = decisionSiteOrigin(),
  fetchImpl = fetch,
  now = new Date()
}: {
  executive: DecisionAIExecutive;
  observeRequested?: boolean;
  origin?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionAIExecutive> {
  if (!observeRequested) return executive;

  const target = proofTargetForDirective({ finalDirective: executive.finalDirective, origin });
  const observation = target.allowed && target.url ? await fetchExecutiveProofObservation(target.url, fetchImpl) : undefined;
  const proofReceipt = buildExecutiveProofReceipt({
    date: executive.date,
    sport: executive.sport,
    finalDirective: executive.finalDirective,
    requested: true,
    observation,
    origin,
    now
  });

  return withExecutiveProofReceipt(executive, proofReceipt);
}

export async function runDecisionAIExecutiveReview({
  executive,
  runRequested = false,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  fetchImpl = fetch
}: {
  executive: DecisionAIExecutive;
  runRequested?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<DecisionAIExecutive> {
  if (!runRequested) return executive;

  const requestPreview = buildOpenAIExecutiveReviewPayload({ executive, model });
  if (!apiKey) {
    return withExecutiveReview({
      executive,
      provider: "deterministic",
      status: "not-configured",
      review: executive.deterministicFallback,
      model: null,
      reason: "OPENAI_API_KEY is not configured.",
      requestPreview
    });
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(requestPreview)
    });

    if (!response.ok) {
      return withExecutiveReview({
        executive,
        provider: "openai",
        status: "provider-error",
        review: executive.deterministicFallback,
        model,
        reason: `OpenAI Responses API returned HTTP ${response.status}.`,
        requestPreview
      });
    }

    const outputText = extractOutputText((await response.json()) as unknown);
    if (!outputText) {
      return withExecutiveReview({
        executive,
        provider: "openai",
        status: "invalid-response",
        review: executive.deterministicFallback,
        model,
        reason: "OpenAI response did not include output text.",
        requestPreview
      });
    }

    const parsed = safeParseAIExecutiveReview(outputText);
    if (!parsed) {
      return withExecutiveReview({
        executive,
        provider: "openai",
        status: "invalid-response",
        review: executive.deterministicFallback,
        model,
        reason: "OpenAI response did not match the AI executive review schema.",
        requestPreview
      });
    }

    return withExecutiveReview({
      executive,
      provider: "openai",
      status: "reviewed",
      review: parsed,
      model,
      requestPreview
    });
  } catch {
    return withExecutiveReview({
      executive,
      provider: "openai",
      status: "provider-error",
      review: executive.deterministicFallback,
      model,
      reason: "OpenAI executive review failed before a valid response was received.",
      requestPreview
    });
  }
}
