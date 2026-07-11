import type { DecisionOperatorEpisode } from "@/lib/sports/prediction/decisionOperatorEpisode";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";
import { extractOutputText } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

export type DecisionAIReasoningGatewayStatus = "ready-to-submit" | "needs-config" | "reviewed" | "fallback" | "provider-error" | "invalid-response" | "blocked";
export type DecisionAIReasoningRunStatus = "not-requested" | "not-configured" | "reviewed" | "provider-error" | "invalid-response";
export type DecisionAIReasoningProvider = "openai" | "deterministic";
export type DecisionAIReasoningPhase = "observe" | "frame" | "challenge" | "decide" | "verify" | "learn";
export type DecisionAIReasoningStepStatus = "pass" | "watch" | "block";
export type DecisionAIReasoningVerdict = "agree" | "downgrade" | "needs-evidence" | "block";
export type DecisionAIReasoningOperatorAction = "advance-read-only" | "hold" | "repair" | "block";

export type DecisionAIReasoningEvidenceItem = {
  id: string;
  source: string;
  label: string;
  status: string;
  detail: string;
};

export type DecisionAIReasoningTraceStep = {
  phase: DecisionAIReasoningPhase;
  status: DecisionAIReasoningStepStatus;
  finding: string;
  citedEvidenceIds: string[];
};

export type DecisionAIReasoningSafetyGate = {
  id: string;
  label: string;
  status: DecisionAIReasoningStepStatus;
  reason: string;
};

export type DecisionAIReasoningReview = {
  reviewVerdict: DecisionAIReasoningVerdict;
  operatorAction: DecisionAIReasoningOperatorAction;
  confidencePatch: "raise-shadow" | "keep-capped" | "lower";
  trustPatch: "advance-shadow-proof" | "hold" | "reduce";
  summary: string;
  publicReasoningTrace: DecisionAIReasoningTraceStep[];
  riskFlags: string[];
  dataGaps: string[];
  falsifiers: string[];
  nextSafeCommand: string;
  memoryCandidate: {
    label: string;
    content: string;
    canPersist: false;
  };
  safetyGates: DecisionAIReasoningSafetyGate[];
  unsupportedClaims: string[];
};

export type DecisionAIReasoningReviewAudit = {
  status: DecisionAIReasoningStepStatus;
  activeSource: DecisionAIReasoningProvider;
  summary: string;
  phaseCoverage: {
    required: DecisionAIReasoningPhase[];
    present: DecisionAIReasoningPhase[];
    missing: DecisionAIReasoningPhase[];
  };
  citationCoverage: {
    traceSteps: number;
    citedTraceSteps: number;
    uncitedTraceSteps: number;
    citedEvidenceIds: string[];
    invalidCitations: number;
  };
  unsupportedClaims: {
    count: number;
    items: string[];
  };
  safetyGateCounts: {
    pass: number;
    watch: number;
    block: number;
    blockers: string[];
  };
  decision: {
    canUseReview: boolean;
    mustUseFallback: boolean;
    reason: string;
  };
};

export type DecisionAIReasoningGateway = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "responses-api-operator-reasoning";
  status: DecisionAIReasoningGatewayStatus;
  gatewayHash: string;
  summary: string;
  openAiConfigured: boolean;
  model: string;
  episode: {
    episodeHash: string;
    status: DecisionOperatorEpisode["status"];
    objective: string;
    proofHash: string | null;
  };
  evidence: {
    totalAvailable: number;
    included: number;
    ids: string[];
    items: DecisionAIReasoningEvidenceItem[];
  };
  requestPreview: ReturnType<typeof buildOpenAIOperatorReasoningPayload>;
  deterministicFallback: DecisionAIReasoningReview;
  review: DecisionAIReasoningReview | null;
  reviewAudit: DecisionAIReasoningReviewAudit;
  latestRun: {
    requested: boolean;
    provider: DecisionAIReasoningProvider;
    status: DecisionAIReasoningRunStatus;
    model: string | null;
    reviewHash: string | null;
    reason: string | null;
    safeNoPersistence: true;
  };
  permissions: {
    canSubmitToOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
  };
  locks: string[];
  proofUrls: string[];
};

const aiReasoningReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: ["agree", "downgrade", "needs-evidence", "block"] },
    operatorAction: { type: "string", enum: ["advance-read-only", "hold", "repair", "block"] },
    confidencePatch: { type: "string", enum: ["raise-shadow", "keep-capped", "lower"] },
    trustPatch: { type: "string", enum: ["advance-shadow-proof", "hold", "reduce"] },
    summary: { type: "string" },
    publicReasoningTrace: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          phase: { type: "string", enum: ["observe", "frame", "challenge", "decide", "verify", "learn"] },
          status: { type: "string", enum: ["pass", "watch", "block"] },
          finding: { type: "string" },
          citedEvidenceIds: { type: "array", items: { type: "string" } }
        },
        required: ["phase", "status", "finding", "citedEvidenceIds"]
      }
    },
    riskFlags: { type: "array", items: { type: "string" } },
    dataGaps: { type: "array", items: { type: "string" } },
    falsifiers: { type: "array", items: { type: "string" } },
    nextSafeCommand: { type: "string" },
    memoryCandidate: {
      type: "object",
      additionalProperties: false,
      properties: {
        label: { type: "string" },
        content: { type: "string" },
        canPersist: { type: "boolean", enum: [false] }
      },
      required: ["label", "content", "canPersist"]
    },
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
    unsupportedClaims: { type: "array", items: { type: "string" } }
  },
  required: [
    "reviewVerdict",
    "operatorAction",
    "confidencePatch",
    "trustPatch",
    "summary",
    "publicReasoningTrace",
    "riskFlags",
    "dataGaps",
    "falsifiers",
    "nextSafeCommand",
    "memoryCandidate",
    "safetyGates",
    "unsupportedClaims"
  ]
};

const REQUIRED_REASONING_PHASES: DecisionAIReasoningPhase[] = ["observe", "frame", "challenge", "decide", "verify", "learn"];

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

function unique(values: Array<string | null | undefined>, limit = 16): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function boundedText(value: unknown, maxLength = 360): string {
  return typeof value === "string" ? compact(value, maxLength) : "";
}

function boundedList(value: unknown, maxItems: number, maxLength = 240): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function isStepStatus(value: unknown): value is DecisionAIReasoningStepStatus {
  return value === "pass" || value === "watch" || value === "block";
}

function isPhase(value: unknown): value is DecisionAIReasoningPhase {
  return value === "observe" || value === "frame" || value === "challenge" || value === "decide" || value === "verify" || value === "learn";
}

function isVerdict(value: unknown): value is DecisionAIReasoningVerdict {
  return value === "agree" || value === "downgrade" || value === "needs-evidence" || value === "block";
}

function isOperatorAction(value: unknown): value is DecisionAIReasoningOperatorAction {
  return value === "advance-read-only" || value === "hold" || value === "repair" || value === "block";
}

function isConfidencePatch(value: unknown): value is DecisionAIReasoningReview["confidencePatch"] {
  return value === "raise-shadow" || value === "keep-capped" || value === "lower";
}

function isTrustPatch(value: unknown): value is DecisionAIReasoningReview["trustPatch"] {
  return value === "advance-shadow-proof" || value === "hold" || value === "reduce";
}

function normalizeTrace(value: unknown): DecisionAIReasoningTraceStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const phase = isPhase(record.phase) ? record.phase : null;
      const status = isStepStatus(record.status) ? record.status : null;
      const finding = boundedText(record.finding, 420);
      if (!phase || !status || !finding) return null;
      return {
        phase,
        status,
        finding,
        citedEvidenceIds: boundedList(record.citedEvidenceIds, 8, 120)
      };
    })
    .filter((item): item is DecisionAIReasoningTraceStep => Boolean(item))
    .slice(0, 8);
}

function normalizeSafetyGates(value: unknown): DecisionAIReasoningSafetyGate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = boundedText(record.label, 140);
      const reason = boundedText(record.reason, 360);
      const status = isStepStatus(record.status) ? record.status : null;
      if (!label || !reason || !status) return null;
      return {
        id: boundedText(record.id, 90) || `ai-reasoning-gate-${index + 1}`,
        label,
        status,
        reason
      };
    })
    .filter((item): item is DecisionAIReasoningSafetyGate => Boolean(item))
    .slice(0, 8);
}

export function safeParseAIReasoningReview(text: string): DecisionAIReasoningReview | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isVerdict(parsed.reviewVerdict)) return null;
    if (!isOperatorAction(parsed.operatorAction)) return null;
    if (!isConfidencePatch(parsed.confidencePatch)) return null;
    if (!isTrustPatch(parsed.trustPatch)) return null;
    const summary = boundedText(parsed.summary, 560);
    const publicReasoningTrace = normalizeTrace(parsed.publicReasoningTrace);
    const safetyGates = normalizeSafetyGates(parsed.safetyGates);
    const memory = parsed.memoryCandidate && typeof parsed.memoryCandidate === "object" ? (parsed.memoryCandidate as Record<string, unknown>) : null;
    const memoryLabel = boundedText(memory?.label, 120);
    const memoryContent = boundedText(memory?.content, 420);
    const nextSafeCommand = boundedText(parsed.nextSafeCommand, 260);
    if (!summary || !publicReasoningTrace.length || !safetyGates.length || !memoryLabel || !memoryContent || !nextSafeCommand) return null;

    return {
      reviewVerdict: parsed.reviewVerdict,
      operatorAction: parsed.operatorAction,
      confidencePatch: parsed.confidencePatch,
      trustPatch: parsed.trustPatch,
      summary,
      publicReasoningTrace,
      riskFlags: boundedList(parsed.riskFlags, 8),
      dataGaps: boundedList(parsed.dataGaps, 8),
      falsifiers: boundedList(parsed.falsifiers, 8),
      nextSafeCommand,
      memoryCandidate: {
        label: memoryLabel,
        content: memoryContent,
        canPersist: false
      },
      safetyGates,
      unsupportedClaims: boundedList(parsed.unsupportedClaims, 8)
    };
  } catch {
    return null;
  }
}

function sanitizeReview(review: DecisionAIReasoningReview, allowedEvidenceIds: Set<string>): DecisionAIReasoningReview {
  return {
    ...review,
    publicReasoningTrace: review.publicReasoningTrace.map((step) => ({
      ...step,
      citedEvidenceIds: step.citedEvidenceIds.filter((id) => allowedEvidenceIds.has(id)).slice(0, 8)
    })),
    memoryCandidate: {
      ...review.memoryCandidate,
      canPersist: false
    }
  };
}

function evidenceItems(episode: DecisionOperatorEpisode, limit = 44): DecisionAIReasoningEvidenceItem[] {
  const timelineItems = episode.timeline.flatMap((item) => [
    {
      id: `timeline-${item.id}`,
      source: "operator-timeline",
      label: item.label,
      status: item.status,
      detail: `${item.detail} Next: ${item.nextAction}`
    },
    ...item.evidence.slice(0, 4).map((evidence, index) => ({
      id: `timeline-${item.id}-evidence-${index + 1}`,
      source: `operator-${item.id}`,
      label: `${item.label} evidence ${index + 1}`,
      status: item.status,
      detail: evidence
    }))
  ]);

  return [
    {
      id: "episode-status",
      source: "operator-episode",
      label: "Episode status",
      status: episode.status,
      detail: episode.summary
    },
    {
      id: "episode-objective",
      source: "operator-episode",
      label: episode.objective.label,
      status: episode.finalPatch.action,
      detail: episode.objective.reason
    },
    {
      id: "episode-final-patch",
      source: "operator-state",
      label: "Final trust and action patch",
      status: episode.finalPatch.trust,
      detail: `Confidence ${episode.finalPatch.confidence}; action ${episode.finalPatch.action}; posture ${episode.finalPatch.posture}; read-only advance ${episode.finalPatch.canAdvanceReadOnly}.`
    },
    {
      id: "episode-proof-hash",
      source: "operator-receipt",
      label: "Observed proof hash",
      status: episode.chain.proofHash ? "observed" : "pending",
      detail: episode.chain.proofHash ?? "No proof hash has been observed yet."
    },
    ...timelineItems,
    {
      id: "operator-narrative-decision",
      source: "operator-narrative",
      label: "Operator decision narrative",
      status: episode.finalPatch.action,
      detail: episode.operatorNarrative.decision
    },
    {
      id: "operator-narrative-risk",
      source: "operator-narrative",
      label: "Operator risk narrative",
      status: episode.status === "blocked" || episode.status === "needs-repair" ? "block" : "watch",
      detail: episode.operatorNarrative.risk
    },
    {
      id: "operator-memory-draft",
      source: "operator-memory",
      label: episode.memoryDraft.label,
      status: episode.memoryDraft.canPersist ? "pass" : "watch",
      detail: episode.memoryDraft.content
    }
  ].slice(0, limit);
}

function fallbackAction(episode: DecisionOperatorEpisode): DecisionAIReasoningOperatorAction {
  if (episode.status === "advance-shadow" && episode.finalPatch.canAdvanceReadOnly) return "advance-read-only";
  if (episode.status === "blocked") return "block";
  if (episode.status === "needs-repair") return "repair";
  return "hold";
}

function fallbackVerdict(action: DecisionAIReasoningOperatorAction, episode: DecisionOperatorEpisode): DecisionAIReasoningVerdict {
  if (action === "block") return "block";
  if (action === "repair" || episode.status === "ready-to-observe") return "needs-evidence";
  if (action === "advance-read-only") return "agree";
  return "needs-evidence";
}

function firstReplayCommand(episode: DecisionOperatorEpisode): string {
  const receipt = episode.replay.commands.find((item) => item.id === "operator-receipt")?.command;
  return (
    receipt ??
    episode.replay.commands[0]?.command ??
    decisionCurlCommand(`/api/sports/decision/operator-episode?date=${encodeURIComponent(episode.date)}&sport=${encodeURIComponent(episode.sport)}&run=1`)
  );
}

function deterministicFallbackReview(episode: DecisionOperatorEpisode, evidenceIds: string[]): DecisionAIReasoningReview {
  const action = fallbackAction(episode);
  const verdict = fallbackVerdict(action, episode);
  const proofStatus: DecisionAIReasoningStepStatus =
    episode.status === "blocked" || episode.status === "needs-repair" ? "block" : episode.chain.proofHash ? "pass" : "watch";
  const trustStatus: DecisionAIReasoningStepStatus = episode.finalPatch.trust === "advance-shadow-proof" ? "pass" : episode.finalPatch.trust === "reduce" ? "block" : "watch";
  const cite = (id: string) => (evidenceIds.includes(id) ? [id] : []);

  return {
    reviewVerdict: verdict,
    operatorAction: action,
    confidencePatch: action === "advance-read-only" ? "raise-shadow" : proofStatus === "block" ? "lower" : "keep-capped",
    trustPatch: action === "advance-read-only" ? "advance-shadow-proof" : proofStatus === "block" ? "reduce" : "hold",
    summary:
      action === "advance-read-only"
        ? "Deterministic fallback agrees the operator can advance only in read-only shadow mode."
        : action === "repair"
          ? "Deterministic fallback routes the operator to repair because the episode still has proof or blocker pressure."
          : action === "block"
            ? "Deterministic fallback blocks the operator because the current proof path is unsafe or unavailable."
            : "Deterministic fallback holds trust until the operator observes stronger proof.",
    publicReasoningTrace: [
      {
        phase: "observe",
        status: proofStatus,
        finding: episode.chain.proofHash ? `Observed proof ${episode.chain.proofHash}.` : "No observed proof hash is available yet.",
        citedEvidenceIds: cite("episode-proof-hash")
      },
      {
        phase: "frame",
        status: episode.status === "advance-shadow" ? "pass" : "watch",
        finding: `Objective is ${episode.objective.label}; final action patch is ${episode.finalPatch.action}.`,
        citedEvidenceIds: unique([...cite("episode-objective"), ...cite("episode-final-patch")], 3)
      },
      {
        phase: "challenge",
        status: trustStatus,
        finding: episode.operatorNarrative.risk,
        citedEvidenceIds: cite("operator-narrative-risk")
      },
      {
        phase: "decide",
        status: action === "block" || action === "repair" ? "block" : action === "hold" ? "watch" : "pass",
        finding: `Operator action is ${action}; publish, persist, train, and public-action upgrade remain locked.`,
        citedEvidenceIds: cite("episode-final-patch")
      },
      {
        phase: "verify",
        status: episode.replay.commands.every((item) => item.safeToRun) ? "pass" : "block",
        finding: `Next safe replay command is ${firstReplayCommand(episode)}.`,
        citedEvidenceIds: cite("timeline-next")
      },
      {
        phase: "learn",
        status: "watch",
        finding: "Memory remains a draft until Supabase write gates and operator approval are available.",
        citedEvidenceIds: cite("operator-memory-draft")
      }
    ],
    riskFlags: unique([episode.operatorNarrative.risk, ...episode.locks], 6),
    dataGaps: unique([
      episode.chain.proofHash ? null : "Observed proof hash is still missing.",
      episode.finalPatch.canPersist ? null : "Supabase memory persistence is still locked.",
      episode.finalPatch.canTrain ? null : "Training writes are still locked."
    ], 6),
    falsifiers: unique([
      "A proof receipt returns failed, stale, or contradictory evidence.",
      "A safety gate reports blocker pressure.",
      "The next command stops being read-only.",
      "The model proposes a stronger public action than the deterministic baseline."
    ]),
    nextSafeCommand: firstReplayCommand(episode),
    memoryCandidate: {
      label: "AI reasoning fallback",
      content: `Episode ${episode.episodeHash} resolved to ${action} with trust ${episode.finalPatch.trust}.`,
      canPersist: false
    },
    safetyGates: [
      {
        id: "no-persistence",
        label: "No persistence",
        status: "pass",
        reason: "The gateway always returns canPersist=false until explicit write gates pass."
      },
      {
        id: "no-publish",
        label: "No publish",
        status: "pass",
        reason: "The gateway never publishes or promotes picks."
      },
      {
        id: "proof-state",
        label: "Proof state",
        status: proofStatus,
        reason: episode.chain.proofHash ? `Proof hash ${episode.chain.proofHash} is present.` : "Proof observation is pending."
      },
      {
        id: "no-upgrade",
        label: "No public-action upgrade",
        status: "pass",
        reason: "The gateway can only hold, repair, block, or advance read-only shadow state."
      }
    ],
    unsupportedClaims: []
  };
}

function systemPrompt(): string {
  return [
    "You are OddsPadi's operator-level AI reasoning gateway.",
    "Use only the supplied JSON evidence and cited evidence IDs.",
    "Return public reasoning notes, not hidden chain-of-thought.",
    "You may agree, downgrade, request evidence, or block.",
    "You must not invent injuries, lineups, suspensions, weather, news, odds, scores, match events, or bookmaker movement.",
    "You must not publish, persist, train, stake, or upgrade a public action.",
    "The strongest action you may choose is advance-read-only, and only when supplied proof supports it.",
    "Return strict JSON matching the provided schema."
  ].join(" ");
}

export function buildOpenAIOperatorReasoningPayload({
  episode,
  model,
  evidenceLimit = 44
}: {
  episode: DecisionOperatorEpisode;
  model: string;
  evidenceLimit?: number;
}) {
  const evidence = evidenceItems(episode, evidenceLimit);
  const user = {
    date: episode.date,
    sport: episode.sport,
    episode: {
      mode: episode.mode,
      status: episode.status,
      episodeHash: episode.episodeHash,
      chain: episode.chain,
      objective: episode.objective,
      finalPatch: episode.finalPatch,
      operatorNarrative: episode.operatorNarrative,
      memoryDraft: episode.memoryDraft,
      locks: episode.locks
    },
    evidence,
    outputRules: {
      evidenceIds: evidence.map((item) => item.id),
      noPersistence: true,
      noPublish: true,
      noTraining: true,
      noPublicActionUpgrade: true,
      allowedOperatorActions: ["advance-read-only", "hold", "repair", "block"],
      requiredPhases: ["observe", "frame", "challenge", "decide", "verify", "learn"]
    }
  };

  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system" as const,
        content: systemPrompt()
      },
      {
        role: "user" as const,
        content: JSON.stringify(user)
      }
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "OddsPadiOperatorAIReasoningReview",
        strict: true,
        schema: aiReasoningReviewSchema
      }
    },
    max_output_tokens: 1800
  };
}

function statusFor(openAiConfigured: boolean, episode: DecisionOperatorEpisode): DecisionAIReasoningGatewayStatus {
  if (episode.status === "blocked") return "blocked";
  return openAiConfigured ? "ready-to-submit" : "needs-config";
}

function summaryFor(status: DecisionAIReasoningGatewayStatus): string {
  if (status === "reviewed") return "OpenAI returned a structured operator reasoning review; side effects remain locked.";
  if (status === "fallback") return "OpenAI is unavailable, so the gateway returned a deterministic public reasoning trace.";
  if (status === "provider-error") return "OpenAI review failed; deterministic fallback kept the operator state safe.";
  if (status === "invalid-response") return "OpenAI response did not satisfy the schema; deterministic fallback kept the operator state safe.";
  if (status === "blocked") return "AI reasoning gateway is blocked because the operator episode is blocked.";
  if (status === "ready-to-submit") return "AI reasoning gateway is ready to submit a structured, no-persistence OpenAI review.";
  return "AI reasoning gateway is wired but waiting for OPENAI_API_KEY before live review can run.";
}

function auditStatus({
  missingPhases,
  uncitedTraceSteps,
  invalidCitations,
  unsupportedClaims,
  safetyBlocks
}: {
  missingPhases: DecisionAIReasoningPhase[];
  uncitedTraceSteps: number;
  invalidCitations: number;
  unsupportedClaims: number;
  safetyBlocks: number;
}): DecisionAIReasoningStepStatus {
  const missingCritical = missingPhases.some((phase) => phase === "observe" || phase === "decide" || phase === "verify");
  if (invalidCitations > 0 || unsupportedClaims > 0 || missingCritical) return "block";
  if (missingPhases.length > 0 || uncitedTraceSteps > 0 || safetyBlocks > 0) return "watch";
  return "pass";
}

function auditSummary(status: DecisionAIReasoningStepStatus, source: DecisionAIReasoningProvider): string {
  if (status === "pass") return `${source === "openai" ? "OpenAI" : "Deterministic"} reasoning review has full phase coverage, valid citations, and no unsupported claims.`;
  if (status === "watch") return `${source === "openai" ? "OpenAI" : "Deterministic"} reasoning review is usable for audit, but needs operator attention before trust can move.`;
  return `${source === "openai" ? "OpenAI" : "Deterministic"} reasoning review failed a public-audit quality gate; fallback/hold posture remains in charge.`;
}

export function auditDecisionAIReasoningReview({
  review,
  evidenceIds,
  activeSource
}: {
  review: DecisionAIReasoningReview;
  evidenceIds: string[];
  activeSource: DecisionAIReasoningProvider;
}): DecisionAIReasoningReviewAudit {
  const allowedEvidenceIds = new Set(evidenceIds);
  const present = REQUIRED_REASONING_PHASES.filter((phase) => review.publicReasoningTrace.some((step) => step.phase === phase));
  const missing = REQUIRED_REASONING_PHASES.filter((phase) => !present.includes(phase));
  const citedEvidenceIds = unique(review.publicReasoningTrace.flatMap((step) => step.citedEvidenceIds), 30);
  const invalidCitations = citedEvidenceIds.filter((id) => !allowedEvidenceIds.has(id)).length;
  const uncitedTraceSteps = review.publicReasoningTrace.filter((step) => step.citedEvidenceIds.length === 0).length;
  const safetyGateCounts = {
    pass: review.safetyGates.filter((gate) => gate.status === "pass").length,
    watch: review.safetyGates.filter((gate) => gate.status === "watch").length,
    block: review.safetyGates.filter((gate) => gate.status === "block").length,
    blockers: review.safetyGates.filter((gate) => gate.status === "block").map((gate) => `${gate.id}: ${gate.reason}`).slice(0, 6)
  };
  const status = auditStatus({
    missingPhases: missing,
    uncitedTraceSteps,
    invalidCitations,
    unsupportedClaims: review.unsupportedClaims.length,
    safetyBlocks: safetyGateCounts.block
  });
  const mustUseFallback = activeSource === "openai" && status === "block";

  return {
    status,
    activeSource,
    summary: auditSummary(status, activeSource),
    phaseCoverage: {
      required: REQUIRED_REASONING_PHASES,
      present,
      missing
    },
    citationCoverage: {
      traceSteps: review.publicReasoningTrace.length,
      citedTraceSteps: review.publicReasoningTrace.length - uncitedTraceSteps,
      uncitedTraceSteps,
      citedEvidenceIds,
      invalidCitations
    },
    unsupportedClaims: {
      count: review.unsupportedClaims.length,
      items: review.unsupportedClaims.slice(0, 8)
    },
    safetyGateCounts,
    decision: {
      canUseReview: status !== "block",
      mustUseFallback,
      reason: mustUseFallback
        ? "OpenAI review is blocked by audit quality, so deterministic fallback remains authoritative."
        : status === "pass"
          ? "Review can be used as public audit evidence without changing side-effect locks."
          : "Review can inform operator attention, but deterministic side-effect locks remain authoritative."
    }
  };
}

function baseGateway({
  episode,
  env,
  model,
  now
}: {
  episode: DecisionOperatorEpisode;
  env: Record<string, string | undefined>;
  model: string;
  now: Date;
}): DecisionAIReasoningGateway {
  const openAiConfigured = Boolean(env.OPENAI_API_KEY?.trim());
  const evidence = evidenceItems(episode);
  const evidenceIds = evidence.map((item) => item.id);
  const deterministicFallback = deterministicFallbackReview(episode, evidenceIds);
  const reviewAudit = auditDecisionAIReasoningReview({ review: deterministicFallback, evidenceIds, activeSource: "deterministic" });
  const status = statusFor(openAiConfigured, episode);
  const requestPreview = buildOpenAIOperatorReasoningPayload({ episode, model });
  const gatewayHash = stableHash({
    date: episode.date,
    sport: episode.sport,
    episode: episode.episodeHash,
    status,
    model,
    evidenceIds,
    fallback: deterministicFallback.reviewVerdict,
    reviewAudit: reviewAudit.status
  });

  return {
    generatedAt: now.toISOString(),
    date: episode.date,
    sport: episode.sport,
    mode: "responses-api-operator-reasoning",
    status,
    gatewayHash,
    summary: summaryFor(status),
    openAiConfigured,
    model,
    episode: {
      episodeHash: episode.episodeHash,
      status: episode.status,
      objective: episode.objective.label,
      proofHash: episode.chain.proofHash
    },
    evidence: {
      totalAvailable: evidence.length,
      included: evidence.length,
      ids: evidenceIds,
      items: evidence
    },
    requestPreview,
    deterministicFallback,
    review: null,
    reviewAudit,
    latestRun: {
      requested: false,
      provider: "deterministic",
      status: "not-requested",
      model: null,
      reviewHash: null,
      reason: null,
      safeNoPersistence: true
    },
    permissions: {
      canSubmitToOpenAI: openAiConfigured && episode.status !== "blocked",
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    locks: unique(
      [
        ...episode.locks,
        "AI reasoning gateway is no-persistence and no-publish.",
        "AI reasoning output cannot upgrade public action.",
        "AI reasoning memory candidate remains draft-only."
      ],
      20
    ),
    proofUrls: unique(["/api/sports/decision/ai-reasoning-gateway", "/api/sports/decision/operator-episode", ...episode.proofUrls], 18)
  };
}

export function buildDecisionAIReasoningGateway({
  episode,
  env = process.env,
  model = getDecisionOpenAIModel(env),
  now = new Date()
}: {
  episode: DecisionOperatorEpisode;
  env?: Record<string, string | undefined>;
  model?: string;
  now?: Date;
}): DecisionAIReasoningGateway {
  return baseGateway({ episode, env, model, now });
}

function withReview({
  gateway,
  status,
  provider,
  runStatus,
  review,
  activeReviewSource = provider,
  reason = null,
  model
}: {
  gateway: DecisionAIReasoningGateway;
  status: DecisionAIReasoningGatewayStatus;
  provider: DecisionAIReasoningProvider;
  runStatus: DecisionAIReasoningRunStatus;
  review: DecisionAIReasoningReview;
  activeReviewSource?: DecisionAIReasoningProvider;
  reason?: string | null;
  model: string | null;
}): DecisionAIReasoningGateway {
  const reviewAudit = auditDecisionAIReasoningReview({ review, evidenceIds: gateway.evidence.ids, activeSource: activeReviewSource });
  return {
    ...gateway,
    status,
    summary: summaryFor(status),
    review,
    reviewAudit,
    latestRun: {
      requested: true,
      provider,
      status: runStatus,
      model,
      reviewHash: stableHash(review),
      reason,
      safeNoPersistence: true
    },
    permissions: {
      ...gateway.permissions,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    }
  };
}

function rejectedOpenAIReviewReason(audit: DecisionAIReasoningReviewAudit): string {
  const blockers = [
    audit.unsupportedClaims.count > 0 ? `${audit.unsupportedClaims.count} unsupported claim(s)` : null,
    audit.citationCoverage.invalidCitations > 0 ? `${audit.citationCoverage.invalidCitations} invalid citation(s)` : null,
    audit.phaseCoverage.missing.length > 0 ? `missing phase(s): ${audit.phaseCoverage.missing.join(", ")}` : null,
    audit.safetyGateCounts.block > 0 ? `${audit.safetyGateCounts.block} blocked safety gate(s)` : null
  ].filter(Boolean);
  return `OpenAI review failed reasoning audit quality gates${blockers.length > 0 ? `: ${blockers.join("; ")}` : "."}`;
}

export async function runDecisionAIReasoningGateway({
  episode,
  runRequested = false,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}: {
  episode: DecisionOperatorEpisode;
  runRequested?: boolean;
  apiKey?: string;
  model?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionAIReasoningGateway> {
  const gateway = baseGateway({
    episode,
    env: {
      ...env,
      OPENAI_API_KEY: apiKey
    },
    model,
    now
  });
  if (!runRequested) return gateway;

  if (!apiKey) {
    return withReview({
      gateway,
      status: "fallback",
      provider: "deterministic",
      runStatus: "not-configured",
      review: gateway.deterministicFallback,
      reason: "OPENAI_API_KEY is not configured.",
      model: null
    });
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(gateway.requestPreview)
    });

    if (!response.ok) {
      return withReview({
        gateway,
        status: "provider-error",
        provider: "openai",
        runStatus: "provider-error",
        review: gateway.deterministicFallback,
        activeReviewSource: "deterministic",
        reason: `OpenAI Responses API returned HTTP ${response.status}.`,
        model
      });
    }

    const outputText = extractOutputText((await response.json()) as unknown);
    if (!outputText) {
      return withReview({
        gateway,
        status: "invalid-response",
        provider: "openai",
        runStatus: "invalid-response",
        review: gateway.deterministicFallback,
        activeReviewSource: "deterministic",
        reason: "OpenAI response did not include output text.",
        model
      });
    }

    const parsed = safeParseAIReasoningReview(outputText);
    if (!parsed) {
      return withReview({
        gateway,
        status: "invalid-response",
        provider: "openai",
        runStatus: "invalid-response",
        review: gateway.deterministicFallback,
        activeReviewSource: "deterministic",
        reason: "OpenAI response did not match the operator reasoning schema.",
        model
      });
    }

    const review = sanitizeReview(parsed, new Set(gateway.evidence.ids));
    const reviewAudit = auditDecisionAIReasoningReview({ review, evidenceIds: gateway.evidence.ids, activeSource: "openai" });
    if (reviewAudit.status === "block") {
      return withReview({
        gateway,
        status: "reviewed",
        provider: "openai",
        runStatus: "reviewed",
        review,
        activeReviewSource: "openai",
        reason: `${rejectedOpenAIReviewReason(reviewAudit)} The structured review is retained for audit, but deterministic fallback remains authoritative.`,
        model
      });
    }

    return withReview({
      gateway,
      status: "reviewed",
      provider: "openai",
      runStatus: "reviewed",
      review,
      model
    });
  } catch {
    return withReview({
      gateway,
      status: "provider-error",
      provider: "openai",
      runStatus: "provider-error",
      review: gateway.deterministicFallback,
      activeReviewSource: "deterministic",
      reason: "OpenAI operator reasoning review failed before a valid response was received.",
      model
    });
  }
}
