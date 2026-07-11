import type { DecisionAIContextDossier } from "@/lib/sports/prediction/decisionAIContextDossier";
import type { DecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import type { DecisionAIReasoningGateway } from "@/lib/sports/prediction/decisionAIReasoningGateway";
import type { DecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import type { DecisionMvpRequirementAudit } from "@/lib/sports/prediction/decisionMvpRequirementAudit";
import type { DecisionAction, Sport } from "@/lib/sports/types";
import { extractOutputText } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

export type DecisionAISessionStatus = "ready-to-run" | "reviewed" | "fallback" | "needs-config" | "blocked";
export type DecisionAISessionReviewStatus = "not-requested" | "not-configured" | "reviewed" | "provider-error" | "invalid-response";
export type DecisionAISessionTraceStatus = "pass" | "watch" | "block";
export type DecisionAISessionMetareasoningStatus = "ready-shadow" | "hold" | "repair" | "blocked";
export type DecisionAISessionTrustCeiling = "candidate" | "monitor" | "shadow" | "none";

export type DecisionAISessionRun = {
  id: "context-dossier" | "operator-reasoning" | "slate-council";
  label: string;
  requested: boolean;
  provider: "openai" | "deterministic";
  status: DecisionAISessionReviewStatus;
  model: string | null;
  verdict: string | null;
  reviewHash: string | null;
  reason: string | null;
  safeNoPersistence: true;
};

export type DecisionAISessionTrace = {
  id: string;
  phase: "observe" | "model" | "market" | "data" | "challenge" | "decide" | "verify" | "learn";
  status: DecisionAISessionTraceStatus;
  finding: string;
  evidence: string[];
};

export type DecisionAISessionThought = {
  id: "consensus" | "evidence-debt" | "contradictions" | "action-pressure" | "trust-ceiling";
  label: string;
  status: DecisionAISessionTraceStatus;
  score: number;
  finding: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAISessionMetareasoning = {
  status: DecisionAISessionMetareasoningStatus;
  trustCeiling: DecisionAISessionTrustCeiling;
  consensusScore: number;
  evidenceDebt: number;
  contradictionCount: number;
  actionPressure: number;
  canAdvanceReadOnly: boolean;
  summary: string;
  workingHypothesis: string;
  strongestObjection: string;
  requiredEvidence: string[];
  thoughtTrace: DecisionAISessionThought[];
};

export type DecisionAISessionReviewVerdict = "agree" | "downgrade" | "needs-evidence" | "block";
export type DecisionAISessionEvidenceFindingStatus = "supports" | "challenges" | "missing";

export type DecisionAISessionEvidenceItem = {
  id: string;
  source: string;
  label: string;
  status: string;
  detail: string;
};

export type DecisionAISessionEvidenceFinding = {
  evidenceId: string;
  status: DecisionAISessionEvidenceFindingStatus;
  finding: string;
};

export type DecisionAISessionSafetyGate = {
  id: string;
  label: string;
  status: DecisionAISessionTraceStatus;
  reason: string;
};

export type DecisionAISessionReview = {
  reviewVerdict: DecisionAISessionReviewVerdict;
  recommendedAction: DecisionAction;
  trustPatch: "keep-ceiling" | "lower-ceiling" | "repair-first" | "block";
  summary: string;
  evidenceFindings: DecisionAISessionEvidenceFinding[];
  riskFlags: string[];
  dataGaps: string[];
  falsifiers: string[];
  requiredEvidence: string[];
  safetyGates: DecisionAISessionSafetyGate[];
  unsupportedClaims: string[];
  publishPermission: "never";
  persistencePermission: "never";
  trainingPermission: "never";
  publicActionUpgradePermission: "never";
};

export type DecisionAISession = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-decision-session";
  status: DecisionAISessionStatus;
  sessionHash: string;
  summary: string;
  activeDecision: {
    matchId: string | null;
    match: string | null;
    baselineAction: DecisionAction | null;
    authorityAction: DecisionAction;
    sessionAction: DecisionAction;
    publicPosture: DecisionAuthority["activeDecision"]["publicPosture"];
    confidence: DecisionAuthority["activeDecision"]["confidence"];
    risk: DecisionAuthority["activeDecision"]["risk"];
    reason: string;
  };
  runRequested: boolean;
  openAiConfigured: boolean;
  runs: DecisionAISessionRun[];
  trace: DecisionAISessionTrace[];
  metareasoning: DecisionAISessionMetareasoning;
  evidencePacket: DecisionAISessionEvidenceItem[];
  requestPreview: ReturnType<typeof buildOpenAISessionReviewPayload>;
  deterministicFallback: DecisionAISessionReview;
  review: DecisionAISessionReview | null;
  latestRun: {
    requested: boolean;
    provider: "openai" | "deterministic";
    status: DecisionAISessionReviewStatus;
    model: string | null;
    reviewHash: string | null;
    reason: string | null;
    safeNoPersistence: true;
  };
  blockers: string[];
  nextSafeAction: string;
  controls: {
    canSubmitToOpenAI: boolean;
    canApplyAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
};

type DecisionAISessionPayloadInput = Omit<DecisionAISession, "requestPreview" | "deterministicFallback" | "review" | "latestRun">;

const aiSessionReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: ["agree", "downgrade", "needs-evidence", "block"] },
    recommendedAction: { type: "string", enum: ["consider", "monitor", "avoid"] },
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

function unique(values: Array<string | null | undefined>, limit = 14): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function formatProbability(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "n/a";
  return `${round(value * 100, 1)}%`;
}

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function safestAction(current: DecisionAction, proposed: DecisionAction): DecisionAction {
  return actionRank(proposed) <= actionRank(current) ? proposed : current;
}

function actionFromContext(dossier: DecisionAIContextDossier): DecisionAction {
  const review = dossier.review ?? dossier.deterministicFallback;
  if (review.reviewVerdict === "block") return "avoid";
  if (review.reviewVerdict === "downgrade" || review.reviewVerdict === "needs-evidence") return "monitor";
  return dossier.target.action ?? "avoid";
}

function actionFromReasoning(gateway: DecisionAIReasoningGateway): DecisionAction {
  const review = gateway.review ?? gateway.deterministicFallback;
  if (review.operatorAction === "block" || review.operatorAction === "repair") return "avoid";
  if (review.operatorAction === "hold" || review.operatorAction === "advance-read-only") return "monitor";
  return "avoid";
}

function statusFromScore(score: number, highPass: number, lowBlock: number): DecisionAISessionTraceStatus {
  if (score >= highPass) return "pass";
  if (score <= lowBlock) return "block";
  return "watch";
}

function debtStatus(score: number): DecisionAISessionTraceStatus {
  if (score >= 64) return "block";
  if (score >= 28) return "watch";
  return "pass";
}

function contradictionStatus(count: number): DecisionAISessionTraceStatus {
  if (count >= 3) return "block";
  if (count > 0) return "watch";
  return "pass";
}

function isSafeReadOnlyCommand(command: string): boolean {
  const lower = command.toLowerCase();
  return (
    lower.includes("curl.exe") &&
    !lower.includes("-x post") &&
    !lower.includes("persist=1") &&
    !lower.includes("persist=true") &&
    !lower.includes("publish=1") &&
    !lower.includes("publish=true") &&
    !lower.includes("dryrun=0")
  );
}

function boundedText(value: unknown, maxLength = 360): string {
  return typeof value === "string" ? compact(value, maxLength) : "";
}

function boundedList(value: unknown, maxItems: number, maxLength = 260): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function isAction(value: unknown): value is DecisionAction {
  return value === "consider" || value === "monitor" || value === "avoid";
}

function isReviewVerdict(value: unknown): value is DecisionAISessionReviewVerdict {
  return value === "agree" || value === "downgrade" || value === "needs-evidence" || value === "block";
}

function isTrustPatch(value: unknown): value is DecisionAISessionReview["trustPatch"] {
  return value === "keep-ceiling" || value === "lower-ceiling" || value === "repair-first" || value === "block";
}

function isFindingStatus(value: unknown): value is DecisionAISessionEvidenceFindingStatus {
  return value === "supports" || value === "challenges" || value === "missing";
}

function isTraceStatus(value: unknown): value is DecisionAISessionTraceStatus {
  return value === "pass" || value === "watch" || value === "block";
}

function normalizeEvidenceFindings(value: unknown): DecisionAISessionEvidenceFinding[] {
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
    .filter((item): item is DecisionAISessionEvidenceFinding => Boolean(item))
    .slice(0, 14);
}

function normalizeSafetyGates(value: unknown): DecisionAISessionSafetyGate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const label = boundedText(record.label, 140);
      const reason = boundedText(record.reason, 420);
      const status = isTraceStatus(record.status) ? record.status : null;
      if (!label || !reason || !status) return null;
      return {
        id: boundedText(record.id, 100) || `session-review-gate-${index + 1}`,
        label,
        status,
        reason
      };
    })
    .filter((item): item is DecisionAISessionSafetyGate => Boolean(item))
    .slice(0, 8);
}

export function safeParseAISessionReview(text: string): DecisionAISessionReview | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isReviewVerdict(parsed.reviewVerdict)) return null;
    if (!isAction(parsed.recommendedAction)) return null;
    if (!isTrustPatch(parsed.trustPatch)) return null;
    if (
      parsed.publishPermission !== "never" ||
      parsed.persistencePermission !== "never" ||
      parsed.trainingPermission !== "never" ||
      parsed.publicActionUpgradePermission !== "never"
    ) {
      return null;
    }

    const summary = boundedText(parsed.summary, 640);
    const evidenceFindings = normalizeEvidenceFindings(parsed.evidenceFindings);
    const safetyGates = normalizeSafetyGates(parsed.safetyGates);
    if (!summary || !evidenceFindings.length || !safetyGates.length) return null;

    return {
      reviewVerdict: parsed.reviewVerdict,
      recommendedAction: parsed.recommendedAction,
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

function normalizeRunStatus(status: string): DecisionAISessionReviewStatus {
  if (status === "reviewed") return "reviewed";
  if (status === "not-configured") return "not-configured";
  if (status === "provider-error") return "provider-error";
  if (status === "invalid-response") return "invalid-response";
  return "not-requested";
}

function sessionRunFromContext(dossier: DecisionAIContextDossier): DecisionAISessionRun {
  const review = dossier.review ?? dossier.deterministicFallback;
  return {
    id: "context-dossier",
    label: "AI context dossier",
    requested: dossier.latestRun.requested,
    provider: dossier.latestRun.provider,
    status: normalizeRunStatus(dossier.latestRun.status),
    model: dossier.latestRun.model,
    verdict: review.reviewVerdict,
    reviewHash: dossier.latestRun.reviewHash,
    reason: dossier.latestRun.reason,
    safeNoPersistence: true
  };
}

function sessionRunFromReasoning(gateway: DecisionAIReasoningGateway): DecisionAISessionRun {
  const review = gateway.review ?? gateway.deterministicFallback;
  return {
    id: "operator-reasoning",
    label: "Operator reasoning",
    requested: gateway.latestRun.requested,
    provider: gateway.latestRun.provider,
    status: normalizeRunStatus(gateway.latestRun.status),
    model: gateway.latestRun.model,
    verdict: review.reviewVerdict,
    reviewHash: gateway.latestRun.reviewHash,
    reason: gateway.latestRun.reason,
    safeNoPersistence: true
  };
}

function sessionRunFromCouncil(council: DecisionAICouncil): DecisionAISessionRun {
  return {
    id: "slate-council",
    label: "Slate AI council",
    requested: council.reviewStatus !== "not-requested",
    provider: council.reviewStatus === "reviewed" ? "openai" : "deterministic",
    status: normalizeRunStatus(council.reviewStatus),
    model: council.model,
    verdict: council.aiReview?.reviewVerdict ?? council.finalAction,
    reviewHash: council.aiReview ? stableHash(council.aiReview) : null,
    reason: council.reviewFailureReason,
    safeNoPersistence: true
  };
}

function statusFromTrace(statuses: DecisionAISessionTraceStatus[]): DecisionAISessionTraceStatus {
  if (statuses.includes("block")) return "block";
  if (statuses.includes("watch")) return "watch";
  return "pass";
}

function traceItem(input: DecisionAISessionTrace): DecisionAISessionTrace {
  return {
    ...input,
    finding: compact(input.finding, 420),
    evidence: unique(input.evidence, 6)
  };
}

function evidenceValues(...values: Array<string | null | undefined>): string[] {
  return unique(values, 6);
}

function buildTrace({
  council,
  contextDossier,
  reasoningGateway,
  authority,
  mvpAudit
}: {
  council: DecisionAICouncil;
  contextDossier: DecisionAIContextDossier;
  reasoningGateway: DecisionAIReasoningGateway;
  authority: DecisionAuthority;
  mvpAudit: DecisionMvpRequirementAudit;
}): DecisionAISessionTrace[] {
  const contextReview = contextDossier.review ?? contextDossier.deterministicFallback;
  const reasoningReview = reasoningGateway.review ?? reasoningGateway.deterministicFallback;
  const modelStatus: DecisionAISessionTraceStatus = contextDossier.modelContext.baseProbability === null ? "block" : "pass";
  const marketStatus: DecisionAISessionTraceStatus =
    contextDossier.marketContext.actionableSelections > 0 ? "pass" : contextDossier.marketContext.totalSelections > 0 ? "watch" : "block";
  const dataStatus: DecisionAISessionTraceStatus =
    contextDossier.dataContext.missingSignals > 0 || contextDossier.dataContext.mockSignals > 0 ? "watch" : "pass";

  return [
    traceItem({
      id: "observe-target",
      phase: "observe",
      status: authority.status === "blocked" ? "block" : "watch",
      finding: authority.summary,
      evidence: evidenceValues(authority.authorityHash, authority.activeDecision.matchId, authority.activeDecision.source)
    }),
    traceItem({
      id: "model-belief",
      phase: "model",
      status: modelStatus,
      finding: `Model ${contextDossier.modelContext.modelVersion ?? "unknown"} sees ${contextDossier.target.selection ?? "no selection"} with posterior ${
        formatProbability(contextDossier.modelContext.posteriorProbability)
      }.`,
      evidence: ["model-probability", contextDossier.dossierHash]
    }),
    traceItem({
      id: "market-edge",
      phase: "market",
      status: marketStatus,
      finding: `${contextDossier.marketContext.actionableSelections} actionable selection(s), ${contextDossier.marketContext.totalSelections} priced selection(s), best ${contextDossier.marketContext.bestSelection ?? "none"}.`,
      evidence: evidenceValues("market-value", contextDossier.marketContext.status)
    }),
    traceItem({
      id: "data-gates",
      phase: "data",
      status: dataStatus,
      finding: `${contextDossier.dataContext.providerBackedSignals} provider-backed, ${contextDossier.dataContext.mockSignals} mock, ${contextDossier.dataContext.missingSignals} missing signal(s).`,
      evidence: evidenceValues("data-coverage", contextDossier.dataContext.nextProviderTask)
    }),
    traceItem({
      id: "challenge-review",
      phase: "challenge",
      status: statusFromTrace([
        contextReview.reviewVerdict === "block" ? "block" : contextReview.reviewVerdict === "agree" ? "pass" : "watch",
        reasoningReview.reviewVerdict === "block" ? "block" : reasoningReview.reviewVerdict === "agree" ? "pass" : "watch",
        council.finalAction === "avoid" ? "block" : council.finalAction === "monitor" ? "watch" : "pass"
      ]),
      finding: `${contextReview.summary} Council: ${council.summary}`,
      evidence: ["context-dossier", "operator-reasoning", "slate-council"]
    }),
    traceItem({
      id: "safe-decision",
      phase: "decide",
      status: authority.activeDecision.authorizedAction === "avoid" ? "block" : authority.activeDecision.authorizedAction === "monitor" ? "watch" : "pass",
      finding: authority.activeDecision.reason,
      evidence: [authority.activeDecision.source, authority.activeDecision.publicPosture]
    }),
    traceItem({
      id: "activation-proof",
      phase: "verify",
      status: mvpAudit.status === "ready" ? "pass" : mvpAudit.status === "partial" ? "watch" : "block",
      finding: mvpAudit.launchBlockers[0]?.nextAction ?? mvpAudit.summary,
      evidence: evidenceValues(mvpAudit.auditHash, mvpAudit.safeNextCommand?.label)
    }),
    traceItem({
      id: "learning-lock",
      phase: "learn",
      status: "watch",
      finding: "Learning remains shadow-only until real outcomes, Supabase schema proof, and backtests pass.",
      evidence: ["no-persistence", "no-training", "real-corpus-required"]
    })
  ];
}

function evidenceDebtScore({
  contextDossier,
  runs,
  authority,
  mvpAudit,
  openAiConfigured,
  blockers
}: {
  contextDossier: DecisionAIContextDossier;
  runs: DecisionAISessionRun[];
  authority: DecisionAuthority;
  mvpAudit: DecisionMvpRequirementAudit;
  openAiConfigured: boolean;
  blockers: string[];
}): number {
  const runPenalty = runs.reduce((sum, run) => {
    if (run.status === "provider-error" || run.status === "invalid-response") return sum + 14;
    if (run.status === "not-configured") return sum + 5;
    return sum;
  }, 0);
  const score =
    mvpAudit.counts.block * 16 +
    mvpAudit.counts.watch * 5 +
    contextDossier.dataContext.missingSignals * 8 +
    contextDossier.dataContext.mockSignals * 4 +
    contextDossier.dataContext.staleSignals * 6 +
    contextDossier.dataContext.missingEnv.length * 3 +
    contextDossier.aiReadiness.blockers.length * 5 +
    blockers.length * 4 +
    runPenalty +
    (authority.status === "blocked" ? 18 : 0) +
    (openAiConfigured ? 0 : 8);
  return round(clamp(score, 0, 100));
}

function actionPressureScore({
  contextDossier,
  authority,
  sessionAction
}: {
  contextDossier: DecisionAIContextDossier;
  authority: DecisionAuthority;
  sessionAction: DecisionAction;
}): number {
  const targetAction = contextDossier.target.action ?? authority.activeDecision.baselineAction ?? "avoid";
  const edge = Math.max(0, contextDossier.modelContext.valueEdge ?? 0);
  const ev = Math.max(0, contextDossier.modelContext.expectedValue ?? 0);
  const market = contextDossier.marketContext.actionableSelections > 0 ? 18 : contextDossier.marketContext.totalSelections > 0 ? 8 : 0;
  const actionBase = targetAction === "consider" ? 32 : targetAction === "monitor" ? 16 : 0;
  const downgradePressure = actionRank(targetAction) > actionRank(sessionAction) ? 20 : 0;
  return round(clamp(actionBase + market + Math.min(18, edge * 220) + Math.min(18, ev * 120) + downgradePressure, 0, 100));
}

function contradictionCount({
  actions,
  trace,
  runs,
  authority
}: {
  actions: DecisionAction[];
  trace: DecisionAISessionTrace[];
  runs: DecisionAISessionRun[];
  authority: DecisionAuthority;
}): number {
  const actionSpread = new Set(actions).size - 1;
  const blockedTrace = trace.filter((item) => item.status === "block").length;
  const badRuns = runs.filter((run) => run.status === "provider-error" || run.status === "invalid-response").length;
  const authoritySpread =
    authority.activeDecision.baselineAction && authority.activeDecision.baselineAction !== authority.activeDecision.authorizedAction ? 1 : 0;
  return actionSpread + blockedTrace + badRuns + authoritySpread;
}

function trustCeilingFor({
  sessionAction,
  trace,
  authority,
  mvpAudit,
  openAiConfigured,
  runs
}: {
  sessionAction: DecisionAction;
  trace: DecisionAISessionTrace[];
  authority: DecisionAuthority;
  mvpAudit: DecisionMvpRequirementAudit;
  openAiConfigured: boolean;
  runs: DecisionAISessionRun[];
}): DecisionAISessionTrustCeiling {
  if (authority.status === "blocked" || mvpAudit.counts.block > 0 || trace.some((item) => item.status === "block") || sessionAction === "avoid") {
    return "none";
  }
  if (!openAiConfigured || !runs.some((run) => run.status === "reviewed")) return "shadow";
  if (sessionAction === "monitor") return "monitor";
  return "candidate";
}

function metareasoningStatus({
  trustCeiling,
  evidenceDebt,
  contradictions
}: {
  trustCeiling: DecisionAISessionTrustCeiling;
  evidenceDebt: number;
  contradictions: number;
}): DecisionAISessionMetareasoningStatus {
  if (trustCeiling === "none") return "blocked";
  if (evidenceDebt >= 64 || contradictions >= 3) return "repair";
  if (trustCeiling === "shadow" || trustCeiling === "monitor") return "hold";
  return "ready-shadow";
}

function strongestObjection(trace: DecisionAISessionTrace[], blockers: string[]): string {
  return trace.find((item) => item.status === "block")?.finding ?? blockers[0] ?? trace.find((item) => item.status === "watch")?.finding ?? "No hard objection is visible in the current session trace.";
}

function requiredEvidence({
  contextDossier,
  trace,
  blockers,
  mvpAudit
}: {
  contextDossier: DecisionAIContextDossier;
  trace: DecisionAISessionTrace[];
  blockers: string[];
  mvpAudit: DecisionMvpRequirementAudit;
}): string[] {
  return unique(
    [
      ...blockers,
      ...contextDossier.dataContext.missingEnv.map((key) => `Configure ${key}.`),
      ...trace.filter((item) => item.status === "block").map((item) => item.finding),
      ...mvpAudit.launchBlockers.map((item) => item.nextAction),
      contextDossier.deterministicFallback.nextSafeAction
    ],
    10
  );
}

function thought(input: DecisionAISessionThought): DecisionAISessionThought {
  return {
    ...input,
    finding: compact(input.finding, 380),
    nextAction: compact(input.nextAction, 240),
    evidence: unique(input.evidence, 6)
  };
}

function buildMetareasoning({
  council,
  contextDossier,
  reasoningGateway,
  authority,
  mvpAudit,
  runs,
  trace,
  blockers,
  sessionAction,
  openAiConfigured,
  nextSafeAction
}: {
  council: DecisionAICouncil;
  contextDossier: DecisionAIContextDossier;
  reasoningGateway: DecisionAIReasoningGateway;
  authority: DecisionAuthority;
  mvpAudit: DecisionMvpRequirementAudit;
  runs: DecisionAISessionRun[];
  trace: DecisionAISessionTrace[];
  blockers: string[];
  sessionAction: DecisionAction;
  openAiConfigured: boolean;
  nextSafeAction: string;
}): DecisionAISessionMetareasoning {
  const actions = [authority.activeDecision.authorizedAction, council.finalAction, actionFromContext(contextDossier), actionFromReasoning(reasoningGateway)];
  const supportingActions = actions.filter((action) => action === sessionAction).length;
  const hardTraceBlocks = trace.filter((item) => item.status === "block").length;
  const badRuns = runs.filter((run) => run.status === "provider-error" || run.status === "invalid-response").length;
  const consensusScore = round(clamp((supportingActions / actions.length) * 100 - hardTraceBlocks * 8 - badRuns * 12, 0, 100));
  const evidenceDebt = evidenceDebtScore({ contextDossier, runs, authority, mvpAudit, openAiConfigured, blockers });
  const contradictions = contradictionCount({ actions, trace, runs, authority });
  const actionPressure = actionPressureScore({ contextDossier, authority, sessionAction });
  const trustCeiling = trustCeilingFor({ sessionAction, trace, authority, mvpAudit, openAiConfigured, runs });
  const status = metareasoningStatus({ trustCeiling, evidenceDebt, contradictions });
  const objection = strongestObjection(trace, blockers);
  const required = requiredEvidence({ contextDossier, trace, blockers, mvpAudit });
  const canAdvanceReadOnly = status === "ready-shadow" && isSafeReadOnlyCommand(nextSafeAction);
  const target = authority.activeDecision.match ?? contextDossier.target.match ?? council.activeCandidate?.match ?? "the active slate";
  const workingHypothesis =
    sessionAction === "avoid"
      ? `${target} is not allowed to move beyond avoid until the blocked proof, data, or governance evidence changes.`
      : `${target} can remain ${sessionAction} only inside the ${trustCeiling} trust ceiling.`;

  return {
    status,
    trustCeiling,
    consensusScore,
    evidenceDebt,
    contradictionCount: contradictions,
    actionPressure,
    canAdvanceReadOnly,
    summary:
      status === "blocked"
        ? `Metareasoning blocks action: consensus ${consensusScore}/100, evidence debt ${evidenceDebt}/100, contradictions ${contradictions}.`
        : status === "repair"
          ? `Metareasoning routes to repair before trust can rise: evidence debt ${evidenceDebt}/100 and contradictions ${contradictions}.`
          : status === "hold"
            ? `Metareasoning holds the engine inside the ${trustCeiling} ceiling until configured review and stronger evidence arrive.`
            : "Metareasoning allows only read-only shadow advance after cross-checking consensus, evidence debt, and contradictions.",
    workingHypothesis,
    strongestObjection: objection,
    requiredEvidence: required,
    thoughtTrace: [
      thought({
        id: "consensus",
        label: "Cross-check consensus",
        status: statusFromScore(consensusScore, 70, 34),
        score: consensusScore,
        finding: `${supportingActions}/${actions.length} action lanes agree with the safest session action ${sessionAction}.`,
        evidence: actions.map((action, index) => `lane-${index + 1}:${action}`),
        nextAction: consensusScore >= 70 ? "Keep checking whether evidence changes before action." : "Inspect the disagreeing action lanes before trust rises."
      }),
      thought({
        id: "evidence-debt",
        label: "Evidence debt",
        status: debtStatus(evidenceDebt),
        score: evidenceDebt,
        finding: `Evidence debt is ${evidenceDebt}/100 from provider gaps, mock/stale signals, launch blockers, and review status.`,
        evidence: unique(["data-coverage", "mvp-audit", "review-runs", ...contextDossier.dataContext.missingEnv.slice(0, 3)]),
        nextAction: required[0] ?? "Refresh provider-backed evidence before raising trust."
      }),
      thought({
        id: "contradictions",
        label: "Contradiction pressure",
        status: contradictionStatus(contradictions),
        score: clamp(100 - contradictions * 22, 0, 100),
        finding: `${contradictions} contradiction pressure point(s) were found across action lanes, blocked trace phases, review runs, and authority downgrades.`,
        evidence: unique(["authority", "session-trace", "review-runs", ...trace.filter((item) => item.status === "block").map((item) => item.id)]),
        nextAction: contradictions ? "Resolve the highest-pressure blocked trace before applying AI output." : "No contradiction repair is needed before the next read-only check."
      }),
      thought({
        id: "action-pressure",
        label: "Action pressure",
        status: actionPressure >= 70 && trustCeiling === "none" ? "block" : actionPressure >= 45 ? "watch" : "pass",
        score: actionPressure,
        finding: `Action pressure is ${actionPressure}/100 from baseline action, market edge, EV, and downgrade distance.`,
        evidence: unique(["model-edge", "market-value", contextDossier.target.action, authority.activeDecision.baselineAction]),
        nextAction: actionPressure >= 45 ? "Keep public posture conservative while the attractive edge is untrusted." : "No strong action pressure is competing with the safety decision."
      }),
      thought({
        id: "trust-ceiling",
        label: "Trust ceiling",
        status: trustCeiling === "none" ? "block" : trustCeiling === "candidate" ? "pass" : "watch",
        score: trustCeiling === "candidate" ? 100 : trustCeiling === "monitor" ? 66 : trustCeiling === "shadow" ? 42 : 0,
        finding: `Current trust ceiling is ${trustCeiling}; read-only advance is ${canAdvanceReadOnly ? "allowed" : "not allowed"}.`,
        evidence: unique([authority.status, mvpAudit.status, openAiConfigured ? "openai-configured" : "openai-missing"]),
        nextAction: canAdvanceReadOnly ? nextSafeAction : objection
      })
    ]
  };
}

function evidenceItem(input: DecisionAISessionEvidenceItem): DecisionAISessionEvidenceItem {
  return {
    ...input,
    detail: compact(input.detail, 520)
  };
}

function buildSessionEvidencePacket({
  sessionHash,
  activeDecision,
  runs,
  trace,
  metareasoning,
  blockers,
  nextSafeAction,
  controls
}: {
  sessionHash: string;
  activeDecision: DecisionAISession["activeDecision"];
  runs: DecisionAISessionRun[];
  trace: DecisionAISessionTrace[];
  metareasoning: DecisionAISessionMetareasoning;
  blockers: string[];
  nextSafeAction: string;
  controls: DecisionAISession["controls"];
}): DecisionAISessionEvidenceItem[] {
  return [
    evidenceItem({
      id: "active-decision",
      source: "session-authority",
      label: activeDecision.match ?? "Active decision",
      status: activeDecision.sessionAction,
      detail: `${activeDecision.reason} Session ${sessionHash}; authority ${activeDecision.authorityAction}; posture ${activeDecision.publicPosture}.`
    }),
    evidenceItem({
      id: "metareasoning",
      source: "session-metareasoning",
      label: "Metareasoning summary",
      status: metareasoning.status,
      detail: `${metareasoning.summary} Hypothesis: ${metareasoning.workingHypothesis} Objection: ${metareasoning.strongestObjection}`
    }),
    evidenceItem({
      id: "controls",
      source: "session-controls",
      label: "Control locks",
      status: controls.canApplyAI ? "apply-ai-open" : "apply-ai-locked",
      detail: `OpenAI submit ${controls.canSubmitToOpenAI}; apply ${controls.canApplyAI}; persist ${controls.canPersist}; publish ${controls.canPublish}; train ${controls.canTrain}; upgrade ${controls.canUpgradePublicAction}.`
    }),
    evidenceItem({
      id: "blockers",
      source: "session-blockers",
      label: "Session blockers",
      status: blockers.length ? "blocked" : "clear",
      detail: blockers.join(" ") || "No blockers were reported."
    }),
    evidenceItem({
      id: "next-safe-action",
      source: "session-runbook",
      label: "Next safe action",
      status: isSafeReadOnlyCommand(nextSafeAction) ? "read-only" : "inspect-only",
      detail: nextSafeAction
    }),
    ...runs.map((run) =>
      evidenceItem({
        id: `run-${run.id}`,
        source: "session-review-run",
        label: run.label,
        status: run.status,
        detail: `Requested ${run.requested}; provider ${run.provider}; verdict ${run.verdict ?? "pending"}; reason ${run.reason ?? "none"}.`
      })
    ),
    ...trace.map((item) =>
      evidenceItem({
        id: `trace-${item.id}`,
        source: `session-trace-${item.phase}`,
        label: item.id.replaceAll("-", " "),
        status: item.status,
        detail: `${item.finding} Evidence: ${item.evidence.join(", ") || "none"}.`
      })
    ),
    ...metareasoning.thoughtTrace.map((item) =>
      evidenceItem({
        id: `thought-${item.id}`,
        source: "session-thought",
        label: item.label,
        status: item.status,
        detail: `${item.finding} Score ${item.score}/100. Next: ${item.nextAction}`
      })
    )
  ];
}

function deterministicSessionReview(session: DecisionAISessionPayloadInput): DecisionAISessionReview {
  const verdict: DecisionAISessionReviewVerdict =
    session.metareasoning.status === "blocked"
      ? "block"
      : session.metareasoning.status === "repair" || session.metareasoning.status === "hold"
        ? "needs-evidence"
        : "agree";
  const blockingEvidence = session.evidencePacket.filter((item) => item.status === "block" || item.status === "blocked");
  const watchEvidence = session.evidencePacket.filter((item) => item.status === "watch" || item.status === "not-configured" || item.status === "inspect-only");

  return {
    reviewVerdict: verdict,
    recommendedAction: session.activeDecision.sessionAction,
    trustPatch:
      verdict === "block"
        ? "block"
        : session.metareasoning.status === "repair"
          ? "repair-first"
          : session.metareasoning.trustCeiling === "none"
            ? "lower-ceiling"
            : "keep-ceiling",
    summary:
      verdict === "agree"
        ? "Deterministic session review agrees with the metareasoning packet and keeps the same no-write session action."
        : verdict === "needs-evidence"
          ? "Deterministic session review requires stronger evidence before the session can move beyond the current trust ceiling."
          : "Deterministic session review blocks the session because authority, proof, data, or governance evidence remains unsafe.",
    evidenceFindings: [
      {
        evidenceId: "active-decision",
        status: session.activeDecision.sessionAction === "avoid" ? "challenges" : "supports",
        finding: session.activeDecision.reason
      },
      {
        evidenceId: "metareasoning",
        status: verdict === "agree" ? "supports" : "challenges",
        finding: session.metareasoning.summary
      },
      {
        evidenceId: "controls",
        status: "supports",
        finding: "The session keeps persistence, publishing, training, and public-action upgrades locked."
      },
      {
        evidenceId: "blockers",
        status: session.blockers.length ? "missing" : "supports",
        finding: session.blockers[0] ?? "No blockers are present."
      }
    ],
    riskFlags: unique([session.metareasoning.strongestObjection, ...blockingEvidence.slice(0, 4).map((item) => item.detail)], 8),
    dataGaps: unique([...session.metareasoning.requiredEvidence, ...watchEvidence.slice(0, 4).map((item) => item.detail)], 8),
    falsifiers: unique(
      [
        "A provider-backed evidence refresh clears the strongest objection.",
        "A reviewed OpenAI session critique returns cited agreement without blocker gates.",
        "The authority gate changes from blocked to supervised or authorized.",
        "The launch audit reports zero hard blockers."
      ],
      8
    ),
    requiredEvidence: session.metareasoning.requiredEvidence,
    safetyGates: [
      {
        id: "no-publish",
        label: "No publish",
        status: "pass",
        reason: "The session reviewer cannot publish or present a stronger public pick."
      },
      {
        id: "no-persistence",
        label: "No persistence",
        status: "pass",
        reason: "The session reviewer cannot persist memory, decisions, or training artifacts."
      },
      {
        id: "no-training",
        label: "No training",
        status: "pass",
        reason: "The session reviewer cannot train or activate learned guardrails."
      },
      {
        id: "trust-ceiling",
        label: "Trust ceiling",
        status: session.metareasoning.trustCeiling === "none" ? "block" : session.metareasoning.trustCeiling === "candidate" ? "pass" : "watch",
        reason: `Trust ceiling is ${session.metareasoning.trustCeiling}.`
      },
      {
        id: "evidence-debt",
        label: "Evidence debt",
        status: debtStatus(session.metareasoning.evidenceDebt),
        reason: `Evidence debt is ${session.metareasoning.evidenceDebt}/100.`
      }
    ],
    unsupportedClaims: [],
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never",
    publicActionUpgradePermission: "never"
  };
}

function sanitizeSessionReview(review: DecisionAISessionReview, session: DecisionAISession): DecisionAISessionReview {
  const allowedIds = new Set(session.evidencePacket.map((item) => item.id));
  const evidenceFindings = review.evidenceFindings.filter((finding) => allowedIds.has(finding.evidenceId)).slice(0, 14);
  return {
    ...review,
    recommendedAction: safestAction(session.activeDecision.sessionAction, review.recommendedAction),
    evidenceFindings: evidenceFindings.length ? evidenceFindings : session.deterministicFallback.evidenceFindings,
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never",
    publicActionUpgradePermission: "never"
  };
}

export function buildOpenAISessionReviewPayload({
  session,
  model
}: {
  session: DecisionAISessionPayloadInput;
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
          "You are OddsPadi's top-level AI decision-session reviewer. Use only the supplied JSON evidence IDs. Return public reasoning only, not hidden chain-of-thought. You may agree, downgrade, request evidence, or block. You must not invent injuries, lineups, weather, news, odds, scores, events, or private facts. You must not publish, persist, train, stake, or upgrade the current session action. The recommendedAction must be the same or safer than the current session action."
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          date: session.date,
          sport: session.sport,
          status: session.status,
          summary: session.summary,
          activeDecision: session.activeDecision,
          runs: session.runs,
          trace: session.trace,
          metareasoning: session.metareasoning,
          blockers: session.blockers,
          nextSafeAction: session.nextSafeAction,
          controls: session.controls,
          evidencePacket: session.evidencePacket,
          outputRules: {
            allowedEvidenceIds: session.evidencePacket.map((item) => item.id),
            currentSessionAction: session.activeDecision.sessionAction,
            actionRank: { avoid: 0, monitor: 1, consider: 2 },
            publicReasoningOnly: true,
            noPersistence: true,
            noPublishing: true,
            noTraining: true,
            noPublicActionUpgrade: true
          }
        })
      }
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "OddsPadiAISessionReview",
        strict: true,
        schema: aiSessionReviewSchema
      }
    },
    max_output_tokens: 1600
  };
}

function statusFor({
  runRequested,
  openAiConfigured,
  runs,
  authority,
  mvpAudit
}: {
  runRequested: boolean;
  openAiConfigured: boolean;
  runs: DecisionAISessionRun[];
  authority: DecisionAuthority;
  mvpAudit: DecisionMvpRequirementAudit;
}): DecisionAISessionStatus {
  if (authority.status === "blocked" || mvpAudit.counts.block > 0) return "blocked";
  if (runRequested && runs.some((run) => run.status === "reviewed")) return "reviewed";
  if (runRequested && runs.some((run) => run.status === "not-configured" || run.provider === "deterministic")) return "fallback";
  if (!openAiConfigured) return "needs-config";
  return "ready-to-run";
}

function summaryFor(status: DecisionAISessionStatus, action: DecisionAction, match: string | null): string {
  const target = match ?? "the active slate";
  if (status === "reviewed") return `AI decision session reviewed ${target} and kept the safe session action at ${action}.`;
  if (status === "fallback") return `AI decision session used deterministic fallback review for ${target}; safe action is ${action}.`;
  if (status === "needs-config") return `AI decision session is wired for ${target}, but OPENAI_API_KEY is needed for live review.`;
  if (status === "blocked") return `AI decision session blocks ${target}; safe action is ${action} until proof, data, or governance gates clear.`;
  return `AI decision session is ready to run a no-write AI review for ${target}.`;
}

export function buildDecisionAISession({
  date,
  sport,
  council,
  contextDossier,
  reasoningGateway,
  authority,
  mvpAudit,
  runRequested = false,
  model = getDecisionOpenAIModel(),
  now = new Date()
}: {
  date: string;
  sport: Sport;
  council: DecisionAICouncil;
  contextDossier: DecisionAIContextDossier;
  reasoningGateway: DecisionAIReasoningGateway;
  authority: DecisionAuthority;
  mvpAudit: DecisionMvpRequirementAudit;
  runRequested?: boolean;
  model?: string;
  now?: Date;
}): DecisionAISession {
  const runs = [sessionRunFromContext(contextDossier), sessionRunFromReasoning(reasoningGateway), sessionRunFromCouncil(council)];
  const sessionAction = [authority.activeDecision.authorizedAction, council.finalAction, actionFromContext(contextDossier), actionFromReasoning(reasoningGateway)].reduce(
    safestAction
  );
  const openAiConfigured = contextDossier.aiReadiness.modelConfigured || reasoningGateway.openAiConfigured || council.reviewStatus === "reviewed";
  const status = statusFor({ runRequested, openAiConfigured, runs, authority, mvpAudit });
  const blockers = unique(
    [
      ...contextDossier.aiReadiness.blockers,
      ...mvpAudit.launchBlockers.map((item) => item.nextAction),
      authority.status === "blocked" ? authority.summary : null,
      openAiConfigured ? null : "OPENAI_API_KEY is not configured."
    ],
    10
  );
  const trace = buildTrace({ council, contextDossier, reasoningGateway, authority, mvpAudit });
  const nextSafeAction =
    authority.control.nextSafeCommand ??
    mvpAudit.safeNextCommand?.command ??
    contextDossier.agentContext.nextOperation ??
    reasoningGateway.deterministicFallback.nextSafeCommand;
  const metareasoning = buildMetareasoning({
    council,
    contextDossier,
    reasoningGateway,
    authority,
    mvpAudit,
    runs,
    trace,
    blockers,
    sessionAction,
    openAiConfigured,
    nextSafeAction
  });
  const sessionHash = stableHash({
    date,
    sport,
    status,
    action: sessionAction,
    authority: authority.authorityHash,
    context: contextDossier.dossierHash,
    reasoning: reasoningGateway.gatewayHash,
    mvp: mvpAudit.auditHash,
    metareasoning: [metareasoning.status, metareasoning.trustCeiling, metareasoning.consensusScore, metareasoning.evidenceDebt],
    runs: runs.map((run) => [run.id, run.status, run.verdict])
  });
  const activeDecision = {
    matchId: authority.activeDecision.matchId ?? contextDossier.target.matchId ?? council.activeCandidate?.matchId ?? null,
    match: authority.activeDecision.match ?? contextDossier.target.match ?? council.activeCandidate?.match ?? null,
    baselineAction: authority.activeDecision.baselineAction,
    authorityAction: authority.activeDecision.authorizedAction,
    sessionAction,
    publicPosture: authority.activeDecision.publicPosture,
    confidence: authority.activeDecision.confidence,
    risk: authority.activeDecision.risk,
    reason:
      sessionAction === authority.activeDecision.authorizedAction
        ? authority.activeDecision.reason
        : "The session lowered the action after combining council, context, and operator reasoning reviews."
  };
  const controls = {
    canSubmitToOpenAI: contextDossier.aiReadiness.canSubmitToOpenAI || reasoningGateway.permissions.canSubmitToOpenAI,
    canApplyAI: authority.control.canApplyAI && metareasoning.trustCeiling !== "none" && runs.some((run) => run.status === "reviewed"),
    canPersist: false as const,
    canPublish: false as const,
    canTrain: false as const,
    canUpgradePublicAction: false as const
  };
  const proofUrls = unique(
    [
      "/api/sports/decision/ai-decision-session",
      "/api/sports/decision/ai-context-dossier",
      "/api/sports/decision/ai-reasoning-gateway",
      "/api/sports/decision/ai-council",
      "/api/sports/decision/authority",
      "/api/sports/decision/mvp-audit",
      ...contextDossier.proofUrls,
      ...reasoningGateway.proofUrls,
      ...mvpAudit.proofUrls
    ],
    18
  );
  const evidencePacket = buildSessionEvidencePacket({
    sessionHash,
    activeDecision,
    runs,
    trace,
    metareasoning,
    blockers,
    nextSafeAction,
    controls
  });
  const sessionBase: DecisionAISessionPayloadInput = {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "ai-decision-session",
    status,
    sessionHash,
    summary: summaryFor(status, sessionAction, authority.activeDecision.match ?? contextDossier.target.match ?? council.activeCandidate?.match ?? null),
    activeDecision,
    runRequested,
    openAiConfigured,
    runs,
    trace,
    metareasoning,
    evidencePacket,
    blockers,
    nextSafeAction,
    controls,
    proofUrls
  };
  const deterministicFallback = deterministicSessionReview(sessionBase);

  return {
    ...sessionBase,
    requestPreview: buildOpenAISessionReviewPayload({ session: sessionBase, model }),
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

function statusAfterSessionReview(session: DecisionAISession, runStatus: DecisionAISessionReviewStatus): DecisionAISessionStatus {
  if (session.status === "blocked") return "blocked";
  if (runStatus === "reviewed") return "reviewed";
  if (runStatus === "not-configured" || runStatus === "provider-error" || runStatus === "invalid-response") return "fallback";
  return session.status;
}

function withSessionReview({
  session,
  provider,
  status,
  review,
  model,
  reason = null,
  requestPreview = session.requestPreview
}: {
  session: DecisionAISession;
  provider: "openai" | "deterministic";
  status: DecisionAISessionReviewStatus;
  review: DecisionAISessionReview;
  model: string | null;
  reason?: string | null;
  requestPreview?: DecisionAISession["requestPreview"];
}): DecisionAISession {
  const sanitized = sanitizeSessionReview(review, session);
  const hasBlockingGate = sanitized.safetyGates.some((gate) => gate.status === "block");
  return {
    ...session,
    status: statusAfterSessionReview(session, status),
    summary:
      status === "reviewed"
        ? `${session.summary} Session-level AI review returned ${sanitized.reviewVerdict}.`
        : status === "not-configured"
          ? `${session.summary} Session-level AI review used deterministic fallback because OpenAI is not configured.`
          : status === "not-requested"
            ? session.summary
            : `${session.summary} Session-level AI review fell back after ${status}.`,
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
    blockers: unique([...session.blockers, ...sanitized.dataGaps, hasBlockingGate ? sanitized.summary : null], 12),
    controls: {
      ...session.controls,
      canApplyAI: session.controls.canApplyAI && status === "reviewed" && !hasBlockingGate && sanitized.reviewVerdict === "agree",
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    }
  };
}

export async function runDecisionAISessionReview({
  session,
  runRequested = false,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  fetchImpl = fetch
}: {
  session: DecisionAISession;
  runRequested?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<DecisionAISession> {
  if (!runRequested) return session;

  const requestPreview = buildOpenAISessionReviewPayload({ session, model });
  if (!apiKey) {
    return withSessionReview({
      session,
      provider: "deterministic",
      status: "not-configured",
      review: session.deterministicFallback,
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
      return withSessionReview({
        session,
        provider: "openai",
        status: "provider-error",
        review: session.deterministicFallback,
        model,
        reason: `OpenAI Responses API returned HTTP ${response.status}.`,
        requestPreview
      });
    }

    const outputText = extractOutputText((await response.json()) as unknown);
    if (!outputText) {
      return withSessionReview({
        session,
        provider: "openai",
        status: "invalid-response",
        review: session.deterministicFallback,
        model,
        reason: "OpenAI response did not include output text.",
        requestPreview
      });
    }

    const parsed = safeParseAISessionReview(outputText);
    if (!parsed) {
      return withSessionReview({
        session,
        provider: "openai",
        status: "invalid-response",
        review: session.deterministicFallback,
        model,
        reason: "OpenAI response did not match the AI session review schema.",
        requestPreview
      });
    }

    return withSessionReview({
      session,
      provider: "openai",
      status: "reviewed",
      review: parsed,
      model,
      requestPreview
    });
  } catch {
    return withSessionReview({
      session,
      provider: "openai",
      status: "provider-error",
      review: session.deterministicFallback,
      model,
      reason: "OpenAI session review failed before a valid response was received.",
      requestPreview
    });
  }
}
