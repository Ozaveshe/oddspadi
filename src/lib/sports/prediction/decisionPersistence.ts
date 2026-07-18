import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import { buildDecisionBrain } from "@/lib/sports/prediction/decisionBrain";
import {
  buildDecisionEvidenceBundle,
  DECISION_EVIDENCE_BUNDLE_SCHEMA_VERSION,
  persistableAiReviewEnvelope,
  type DecisionEvidenceBundle
} from "@/lib/sports/prediction/decisionEvidenceBundle";
import type { DecisionAiAgentResult, DecisionEngineReport, Match, Prediction } from "@/lib/sports/types";

export type DecisionPersistenceStatus = "skipped" | "stored" | "reused" | "failed";

export type DecisionPersistenceResult = {
  requested: boolean;
  status: DecisionPersistenceStatus;
  configured: boolean;
  table: "op_decision_runs";
  id?: string;
  reason?: string;
  evidenceBundle?: DecisionEvidenceBundlePersistenceResult;
};

export type DecisionEvidenceBundlePersistenceResult = {
  status: "stored" | "reused" | "unverified" | "pending-migration" | "failed";
  configured: boolean;
  table: "op_decision_evidence_bundles";
  id?: string;
  reason?: string;
  evidenceHash?: string;
  decisionHash?: string;
};

export type PersistedDecisionRunIdentity = {
  id: string;
  inputHash: string;
  llmEnhanced: boolean;
  llmStatus: string | null;
  verdict: DecisionEngineReport["verdict"];
  action: DecisionEngineReport["action"];
  summary: string;
  recommendedSelection: string | null;
  outcome?: {
    id: string;
    result: string;
    market: string;
    selection: string;
  } | null;
};

export type DecisionRunLookupResult =
  | { status: "found"; run: PersistedDecisionRunIdentity }
  | { status: "not-found" }
  | { status: "unavailable" | "failed"; reason: string };

const AUTONOMOUS_FIXTURE_PROVIDERS = new Set(["api-football", "the-odds-api-events", "api-basketball", "api-tennis"]);

export function isVerifiedProviderDecisionMatch(match: Match): boolean {
  const source = match.dataSource;
  const fixtureProvider = source?.fixtureProvider?.trim().toLowerCase() ?? "";
  const fixtureProviderId = source?.fixtureProviderId?.trim() ?? "";
  return source?.kind === "provider" && AUTONOMOUS_FIXTURE_PROVIDERS.has(fixtureProvider) && Boolean(fixtureProviderId);
}

export type PersistedDecisionThinkingTraceStatus = "supportive" | "contested" | "unproven" | "blocked";
export type PersistedDecisionThinkingTraceOutcome = "supports" | "questions" | "needs-evidence" | "blocks";

export type PersistedDecisionConfidenceBudgetItem = {
  id: string;
  label: string;
  status: "adds-confidence" | "subtracts-confidence" | "neutral";
  score: number;
  weight: number;
  weightedScore: number;
  detail: string;
};

export type PersistedDecisionThinkingTrace = {
  status: PersistedDecisionThinkingTraceStatus;
  thesis: string;
  counterThesis: string;
  synthesis: string;
  beliefPressure: {
    supporting: number;
    questioning: number;
    needsEvidence: number;
    blocking: number;
    netScore: number;
  };
  confidenceBudget: {
    score: number;
    grade: "high" | "medium" | "low";
    items: PersistedDecisionConfidenceBudgetItem[];
  };
  falsifiers: string[];
  evidenceGaps: string[];
  nextEvidenceAction: string;
  auditTrail: Array<{
    step: string;
    outcome: PersistedDecisionThinkingTraceOutcome;
    evidence: string[];
  }>;
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

const VOLATILE_DECISION_KEYS = new Set(["generatedAt", "startedAt", "completedAt", "dueAt", "expiresAt", "nextReviewAt"]);

function stableDecisionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableDecisionValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_DECISION_KEYS.has(key))
      .map(([key, nested]) => [key, stableDecisionValue(nested)])
  );
}

export function buildDecisionRunInputHash({ match, prediction }: { match: Match; prediction: Prediction }): string {
  const dataSource = match.dataSource
    ? {
        kind: match.dataSource.kind,
        fixtureProvider: match.dataSource.fixtureProvider,
        fixtureProviderId: match.dataSource.fixtureProviderId,
        oddsProvider: match.dataSource.oddsProvider,
        oddsProviderEventId: match.dataSource.oddsProviderEventId,
        formProvider: match.dataSource.formProvider,
        strengthProvider: match.dataSource.strengthProvider,
        notes: match.dataSource.notes
      }
    : null;

  return stableHash({
    fixture: {
      id: match.id,
      sport: match.sport,
      league: match.league,
      kickoffTime: match.kickoffTime,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      venue: match.venue ?? null,
      status: match.status,
      score: match.score ?? null,
      oddsMarkets: match.oddsMarkets,
      homeForm: match.homeForm,
      awayForm: match.awayForm,
      dataQualityScore: match.dataQualityScore,
      providerContextSignals: match.providerContextSignals ?? [],
      dataSource
    },
    model: {
      engineVersion: prediction.decision.engineVersion,
      markets: prediction.markets,
      diagnostics: prediction.diagnostics,
      probabilityCalibration: prediction.calibrationAdjustment ?? null,
      contextAdjustment: prediction.contextAdjustment,
      marketPriorAdjustment: prediction.marketPriorAdjustment,
      valueEdges: prediction.valueEdges,
      canonicalDecision: stableDecisionValue(prediction.canonicalDecision),
      learningProfile: stableDecisionValue(prediction.decision.learningProfile ?? null),
      caseMemory: stableDecisionValue(prediction.decision.caseMemory ?? null),
      historicalDiscipline: stableDecisionValue(prediction.decision.historicalDiscipline)
    }
  });
}

function compactText(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function uniqueStrings(values: Array<string | null | undefined>, limit = 8): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function boundScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function confidenceGrade(score: number): PersistedDecisionThinkingTrace["confidenceBudget"]["grade"] {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function budgetStatus(score: number): PersistedDecisionConfidenceBudgetItem["status"] {
  if (score >= 58) return "adds-confidence";
  if (score <= 42) return "subtracts-confidence";
  return "neutral";
}

function confidenceBudgetItem({
  score,
  ...input
}: Omit<PersistedDecisionConfidenceBudgetItem, "score" | "weightedScore" | "status"> & {
  score: number;
  status?: PersistedDecisionConfidenceBudgetItem["status"];
}): PersistedDecisionConfidenceBudgetItem {
  const bounded = boundScore(score);
  return {
    ...input,
    status: input.status ?? budgetStatus(bounded),
    score: bounded,
    weightedScore: Math.round(bounded * input.weight)
  };
}

function valueConfidenceScore(edge: number | null, expectedValue: number | null): number {
  if (edge == null && expectedValue == null) return 35;
  const boundedEdge = edge == null ? 0 : Math.max(-0.08, Math.min(0.12, edge));
  const boundedEv = expectedValue == null ? 0 : Math.max(-0.12, Math.min(0.18, expectedValue));
  return 45 + boundedEdge * 250 + boundedEv * 180;
}

function controlPolicyScore(status: DecisionEngineReport["controlPolicy"]["status"]): number {
  if (status === "publishable") return 82;
  if (status === "monitor-only") return 58;
  if (status === "needs-rerun") return 42;
  return 18;
}

function outcomeForControlStatus(status: DecisionEngineReport["controlPolicy"]["status"]): PersistedDecisionThinkingTraceOutcome {
  if (status === "publishable") return "supports";
  if (status === "monitor-only") return "questions";
  if (status === "needs-rerun") return "needs-evidence";
  return "blocks";
}

function buildPersistedDecisionThinkingTrace({
  match,
  prediction,
  decision,
  brain
}: {
  match: Match;
  prediction: Prediction;
  decision: DecisionEngineReport;
  brain: ReturnType<typeof buildDecisionBrain>;
}): PersistedDecisionThinkingTrace {
  const canonicalCandidate = prediction.canonicalDecision.bestPublishedPick ?? prediction.canonicalDecision.bestLean ?? prediction.canonicalDecision.bestWatchlistCandidate;
  const bestEdge = canonicalCandidate?.edge ?? null;
  const bestExpectedValue = canonicalCandidate?.expectedValue ?? null;
  const unresolvedDisagreements = decision.committee.unresolvedDisagreements.length;
  const contradictionConcerns = decision.contradictionChecks.filter((item) => item.status !== "clear").length;
  const blockedControlGates = decision.controlPolicy.gates.filter((item) => item.status === "block").length;
  const blockedToolAttempts = decision.toolExecution.attempts.filter((item) => item.status === "blocked").length;
  const waitingToolAttempts = decision.toolExecution.attempts.filter((item) => item.status === "waiting").length;

  const evidenceGaps = uniqueStrings(
    [
      ...decision.dataCoverage.requiredBeforeTrust,
      ...decision.researchBrief.dataGaps,
      ...decision.researchBrief.requiredChecks,
      ...decision.toolOrchestration.tasks
        .filter((item) => item.status === "missing-config" || item.status === "waiting" || item.status === "blocked")
        .map((item) => `${item.label}: ${item.reason}`),
      ...decision.toolExecution.attempts
        .filter((item) => item.status === "blocked" || item.status === "waiting")
        .map((item) => `${item.label}: ${item.nextAction}`),
      ...decision.actionability.blockers,
      ...decision.actionability.requiredBeforeAction,
      ...decision.reviewLoop.unresolvedIssues,
      ...decision.reviewLoop.releaseCriteria
    ],
    10
  );

  const falsifiers = uniqueStrings(
    [
      ...decision.notebook.falsifiers.map((item) => `${item.label}: ${item.action}`),
      ...decision.robustness.requiredRechecks,
      ...decision.decisionBoundary.flipTriggers,
      ...decision.marketMovement.alerts,
      decision.deliberation.decisionIfMissingDataTurnsBad,
      decision.deliberation.decisionIfMarketMoves,
      decision.reviewLoop.unresolvedIssues[0]
    ],
    10
  );

  const auditTrail: PersistedDecisionThinkingTrace["auditTrail"] = [
    {
      step: "Model-market edge",
      outcome: bestEdge != null && bestEdge > 0 && bestExpectedValue != null && bestExpectedValue > 0 ? "supports" : "needs-evidence",
      evidence: uniqueStrings(
        [
          canonicalCandidate?.label ?? prediction.canonicalDecision.noPickReason ?? "No clear value found",
          bestEdge == null ? null : `edge:${bestEdge.toFixed(4)}`,
          bestExpectedValue == null ? null : `ev:${bestExpectedValue.toFixed(4)}`,
          decision.beliefState.summary
        ],
        4
      )
    },
    {
      step: "Data coverage",
      outcome: decision.dataCoverage.requiredBeforeTrust.length
        ? "needs-evidence"
        : decision.dataCoverage.status === "provider-backed" || decision.dataCoverage.score >= 70
          ? "supports"
          : "questions",
      evidence: uniqueStrings(
        [
          `score:${decision.dataCoverage.score}`,
          `status:${decision.dataCoverage.status}`,
          `missing:${decision.dataCoverage.missingSignals}`,
          decision.dataCoverage.requiredBeforeTrust[0] ?? decision.dataCoverage.summary
        ],
        4
      )
    },
    {
      step: "Committee arbitration",
      outcome:
        decision.committee.consensus === "blocked"
          ? "blocks"
          : decision.committee.consensus === "split" || unresolvedDisagreements
            ? "questions"
            : "supports",
      evidence: uniqueStrings(
        [
          `consensus:${decision.committee.consensus}`,
          `recommendation:${decision.committee.recommendedAction}`,
          decision.committee.finalRationale,
          decision.committee.unresolvedDisagreements[0]
        ],
        4
      )
    },
    {
      step: "Robustness and market movement",
      outcome: decision.robustness.status === "robust" && decision.marketMovement.status === "resilient" ? "supports" : "questions",
      evidence: uniqueStrings(
        [
          `robustness:${decision.robustness.status}`,
          `survival:${decision.robustness.survivalRate}`,
          `market:${decision.marketMovement.status}`,
          decision.robustness.summary
        ],
        4
      )
    },
    {
      step: "Tool execution",
      outcome: decision.toolExecution.status === "blocked" || blockedToolAttempts ? "blocks" : decision.toolExecution.status === "partial" || waitingToolAttempts ? "needs-evidence" : "supports",
      evidence: uniqueStrings(
        [
          `status:${decision.toolExecution.status}`,
          `blocked:${decision.toolExecution.blockedTasks}`,
          `waiting:${decision.toolExecution.waitingTasks}`,
          decision.toolExecution.nextRun
        ],
        4
      )
    },
    {
      step: "Control policy",
      outcome: outcomeForControlStatus(decision.controlPolicy.status),
      evidence: uniqueStrings(
        [
          `status:${decision.controlPolicy.status}`,
          `publish:${decision.controlPolicy.publishAllowed}`,
          decision.controlPolicy.primaryDirective,
          decision.controlPolicy.nextBestAction
        ],
        4
      )
    },
    {
      step: "Brain replay",
      outcome: outcomeForControlStatus(brain.status),
      evidence: uniqueStrings([brain.summary, `steps:${brain.thinkingSteps.length}`, brain.nextBestAction], 4)
    }
  ];

  const supporting = auditTrail.filter((item) => item.outcome === "supports").length + Math.min(3, decision.evidence.filter((item) => item.impact === "positive").length);
  const questioning =
    auditTrail.filter((item) => item.outcome === "questions").length +
    Math.min(4, decision.evidence.filter((item) => item.impact === "negative").length + unresolvedDisagreements + contradictionConcerns);
  const needsEvidence = auditTrail.filter((item) => item.outcome === "needs-evidence").length + Math.min(4, evidenceGaps.length);
  const blocking =
    auditTrail.filter((item) => item.outcome === "blocks").length +
    Math.min(4, blockedControlGates + blockedToolAttempts + decision.actionability.blockers.length);
  const beliefPressure = {
    supporting,
    questioning,
    needsEvidence,
    blocking,
    netScore: supporting * 2 - questioning - needsEvidence * 2 - blocking * 4
  };

  const status: PersistedDecisionThinkingTraceStatus =
    decision.controlPolicy.status === "blocked" || decision.actionability.status === "blocked" || beliefPressure.blocking
      ? "blocked"
      : beliefPressure.needsEvidence > beliefPressure.supporting || evidenceGaps.length
        ? "unproven"
        : beliefPressure.questioning >= beliefPressure.supporting ||
            decision.committee.consensus === "split" ||
            decision.robustness.status !== "robust" ||
            decision.marketMovement.status === "fragile"
          ? "contested"
          : "supportive";

  const memoryScore = Math.round(decision.calibration.reliabilityScore * 0.75 + (decision.caseMemory.averageReliabilityScore ?? 45) * 0.25);
  const budgetItems = [
    confidenceBudgetItem({
      id: "model-market-edge",
      label: "Model-market edge",
      score: valueConfidenceScore(bestEdge, bestExpectedValue),
      weight: 0.24,
      detail:
        bestEdge == null
          ? "No model-market edge is available in the stored decision."
          : `Stored edge ${bestEdge.toFixed(4)} and EV ${bestExpectedValue?.toFixed(4) ?? "n/a"}.`
    }),
    confidenceBudgetItem({
      id: "data-quality",
      label: "Data quality",
      score: decision.dataCoverage.score,
      weight: 0.2,
      detail: `${decision.dataCoverage.summary} Required gaps: ${decision.dataCoverage.requiredBeforeTrust.length}.`
    }),
    confidenceBudgetItem({
      id: "actionability",
      label: "Actionability",
      score: decision.actionability.score,
      weight: 0.2,
      detail: `${decision.actionability.summary} Blockers: ${decision.actionability.blockers.length}.`
    }),
    confidenceBudgetItem({
      id: "control-policy",
      label: "Control policy",
      score: controlPolicyScore(decision.controlPolicy.status),
      weight: 0.18,
      detail: `${decision.controlPolicy.summary} Next: ${decision.controlPolicy.nextBestAction}`
    }),
    confidenceBudgetItem({
      id: "memory-calibration",
      label: "Memory calibration",
      score: memoryScore,
      weight: 0.18,
      detail: `${decision.calibration.detail} Case memory: ${decision.caseMemory.summary}`
    })
  ];
  const budgetScore = boundScore(budgetItems.reduce((sum, item) => sum + item.weightedScore, 0));
  const nextEvidenceAction =
    evidenceGaps[0] ??
    decision.controlPolicy.nextBestAction ??
    decision.marketMovement.nextAction ??
    decision.nextChecks[0] ??
    "Re-run the decision engine with fresh market and provider evidence.";
  const matchName = `${match.homeTeam.name} vs ${match.awayTeam.name}`;
  const synthesis =
    status === "blocked"
      ? `The saved agent trace blocks action for ${matchName}; ${beliefPressure.blocking} blocker(s) and ${beliefPressure.needsEvidence} evidence gap(s) remain.`
      : status === "unproven"
        ? `The saved agent trace has a working thesis for ${matchName}, but provider and tool evidence still need proof.`
        : status === "contested"
          ? `The saved agent trace is contested for ${matchName}; market, robustness, or committee pressure still challenges the thesis.`
          : `The saved agent trace is internally supportive for ${matchName} with a ${budgetScore}/100 confidence budget.`;

  return {
    status,
    thesis: compactText(decision.deliberation.primaryThesis || decision.summary, 240),
    counterThesis: compactText(decision.deliberation.dissentingThesis || falsifiers[0] || "No counter-thesis was stored.", 240),
    synthesis: compactText(decision.deliberation.synthesis || synthesis, 280),
    beliefPressure,
    confidenceBudget: {
      score: budgetScore,
      grade: confidenceGrade(budgetScore),
      items: budgetItems
    },
    falsifiers,
    evidenceGaps,
    nextEvidenceAction: compactText(nextEvidenceAction, 220),
    auditTrail
  };
}

type SupabaseServerClient = NonNullable<ReturnType<typeof getSupabaseServerClient>>;

function bundleTableMissing(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("op_decision_evidence_bundles") &&
    (normalized.includes("does not exist") || normalized.includes("could not find") || normalized.includes("schema cache") || normalized.includes("relation"))
  );
}

async function resolveDecisionModelVersion({
  client,
  match,
  prediction,
  decision
}: {
  client: SupabaseServerClient;
  match: Match;
  prediction: Prediction;
  decision: DecisionEngineReport;
}): Promise<{ id: string | null; reason?: string }> {
  const modelKey = prediction.diagnostics.modelVersion;
  const existing = await client.from("op_model_versions").select("id").eq("model_key", modelKey).maybeSingle();
  if (existing.error) return { id: null, reason: existing.error.message };
  if (typeof existing.data?.id === "string") return { id: existing.data.id };

  const inserted = await client
    .from("op_model_versions")
    .insert({
      model_key: modelKey,
      sport: match.sport,
      model_type: "deterministic-sports-model",
      version_label: modelKey,
      description: `Registered ${match.sport} model used by ${decision.engineVersion} immutable decision evidence.`,
      metrics: {},
      config: {
        engineVersion: decision.engineVersion,
        evidenceSchemaVersion: DECISION_EVIDENCE_BUNDLE_SCHEMA_VERSION
      },
      is_active: false
    })
    .select("id")
    .single();
  if (!inserted.error && typeof inserted.data?.id === "string") return { id: inserted.data.id };

  const retried = await client.from("op_model_versions").select("id").eq("model_key", modelKey).maybeSingle();
  if (typeof retried.data?.id === "string") return { id: retried.data.id };
  return { id: null, reason: inserted.error?.message ?? retried.error?.message ?? "Unable to register the model version." };
}

async function persistDecisionEvidenceBundle({
  client,
  decisionRunId,
  match,
  prediction,
  decision,
  bundle
}: {
  client: SupabaseServerClient;
  decisionRunId: string;
  match: Match;
  prediction: Prediction;
  decision: DecisionEngineReport;
  bundle: DecisionEvidenceBundle;
}): Promise<DecisionEvidenceBundlePersistenceResult> {
  const base = {
    configured: true,
    table: "op_decision_evidence_bundles" as const,
    evidenceHash: bundle.evidenceHash,
    decisionHash: bundle.decisionHash
  };
  const existing = await client
    .from("op_decision_evidence_bundles")
    .select("id")
    .eq("decision_run_id", decisionRunId)
    .eq("evidence_hash", bundle.evidenceHash)
    .eq("decision_hash", bundle.decisionHash)
    .maybeSingle();
  if (existing.error) {
    if (bundleTableMissing(existing.error.message)) {
      return {
        ...base,
        status: "pending-migration",
        reason: "Apply the decision evidence bundle migration before immutable decision records can be stored."
      };
    }
    return { ...base, status: "failed", reason: existing.error.message };
  }
  if (typeof existing.data?.id === "string") return { ...base, status: "reused", id: existing.data.id };

  const modelVersion = await resolveDecisionModelVersion({ client, match, prediction, decision });
  if (!modelVersion.id) return { ...base, status: "failed", reason: modelVersion.reason ?? "Model version registration failed." };

  const inserted = await client
    .from("op_decision_evidence_bundles")
    .insert({
      decision_run_id: decisionRunId,
      fixture_external_id: match.id,
      sport: match.sport,
      engine_version: decision.engineVersion,
      model_key: prediction.diagnostics.modelVersion,
      model_version_id: modelVersion.id,
      evidence_schema_version: bundle.schemaVersion,
      evidence_hash: bundle.evidenceHash,
      decision_hash: bundle.decisionHash,
      input_snapshot: bundle.inputSnapshot,
      source_manifest: bundle.sourceManifest,
      market_snapshot: bundle.marketSnapshot,
      model_snapshot: bundle.modelSnapshot,
      context_snapshot: bundle.contextSnapshot,
      decision_snapshot: bundle.decisionSnapshot
    })
    .select("id")
    .single();
  if (inserted.error) {
    if (bundleTableMissing(inserted.error.message)) {
      return {
        ...base,
        status: "pending-migration",
        reason: "Apply the decision evidence bundle migration before immutable decision records can be stored."
      };
    }
    return { ...base, status: "failed", reason: inserted.error.message };
  }
  return { ...base, status: "stored", id: typeof inserted.data?.id === "string" ? inserted.data.id : undefined };
}

export function buildDecisionRunPayload({
  match,
  prediction,
  decision = prediction.decision,
  aiAgent = null
}: {
  match: Match;
  prediction: Prediction;
  decision?: DecisionEngineReport;
  aiAgent?: DecisionAiAgentResult | null;
}): Record<string, unknown> {
  const predictionForBrain = decision === prediction.decision ? prediction : { ...prediction, decision };
  const brain = buildDecisionBrain({ match, prediction: predictionForBrain });
  const thinkingTrace = buildPersistedDecisionThinkingTrace({ match, prediction: predictionForBrain, decision, brain });
  const evidenceBundle = buildDecisionEvidenceBundle({
    match,
    prediction: predictionForBrain,
    decision,
    aiReview: persistableAiReviewEnvelope(aiAgent),
    brain,
    thinkingTrace
  });
  const canonicalCandidate = prediction.canonicalDecision.bestPublishedPick ?? prediction.canonicalDecision.bestLean ?? prediction.canonicalDecision.bestWatchlistCandidate;

  return {
    fixture_external_id: match.id,
    sport: match.sport,
    engine_version: decision.engineVersion,
    model_key: prediction.diagnostics.modelVersion,
    verdict: decision.verdict,
    action: decision.action,
    confidence: decision.confidence,
    risk: decision.risk,
    decision_score: decision.decisionScore,
    recommended_selection: canonicalCandidate?.label ?? null,
    summary: decision.summary,
    health: decision.health,
    calibration: decision.calibration,
    context_adjustment: decision.contextAdjustment ?? prediction.contextAdjustment,
    agent_stages: decision.agentStages,
    contradiction_checks: decision.contradictionChecks,
    scenario_matrix: decision.scenarioMatrix,
    abstention_rules: decision.abstentionRules,
    factors: decision.factors,
    sensitivity_checks: decision.sensitivityChecks,
    public_reasoning_steps: decision.publicReasoningSteps,
    evidence: decision.evidence,
    risks: decision.risks,
    avoid_reasons: decision.avoidReasons,
    safer_alternatives: decision.saferAlternatives,
    missing_signals: decision.missingSignals,
    next_checks: decision.nextChecks,
    model_snapshot: {
      generatedAt: prediction.generatedAt,
      diagnostics: prediction.diagnostics,
      contextAdjustment: prediction.contextAdjustment,
      marketPriorAdjustment: prediction.marketPriorAdjustment,
      markets: prediction.markets,
      valueEdges: prediction.valueEdges,
      canonicalDecision: prediction.canonicalDecision,
      bestPick: prediction.bestPick,
      candidatePick: prediction.canonicalDecision.bestPublishedPick,
      learningProfile: decision.learningProfile ?? null,
      caseMemory: decision.caseMemory,
      beliefState: decision.beliefState,
      deliberation: decision.deliberation,
      monitoringPlan: decision.monitoringPlan,
      actionability: decision.actionability,
      reviewLoop: decision.reviewLoop,
      researchBrief: decision.researchBrief,
      notebook: decision.notebook,
      probabilityTrace: decision.probabilityTrace,
      attribution: decision.attribution,
      uncertainty: decision.uncertainty,
      decisionBoundary: decision.decisionBoundary,
      aiProtocol: decision.aiProtocol,
      reasoningGraph: decision.reasoningGraph,
      toolOrchestration: decision.toolOrchestration,
      toolExecution: decision.toolExecution,
      controlPolicy: decision.controlPolicy,
      oddsIntelligence: decision.oddsIntelligence,
      marketMovement: decision.marketMovement,
      dataCoverage: decision.dataCoverage,
      robustness: decision.robustness,
      evaluationPlan: decision.evaluationPlan,
      committee: decision.committee,
      aiAgentAudit: decision.aiAgentAudit ?? null,
      brain,
      thinkingTrace,
      evidenceBundle
    },
    odds_snapshot: match.oddsMarkets,
    input_hash: buildDecisionRunInputHash({ match, prediction }),
    llm_enhanced: decision.llmEnhanced,
    llm_model: decision.llmModel ?? null,
    llm_status: decision.llmStatus ?? null,
    llm_failure_reason: decision.llmFailureReason ?? null,
    updated_at: new Date().toISOString()
  };
}

export async function findDecisionRunByInput({
  match,
  prediction
}: {
  match: Match;
  prediction: Prediction;
}): Promise<DecisionRunLookupResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      status: "unavailable",
      reason: `Supabase server reads are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) return { status: "failed", reason: "Supabase client could not be created." };

  const inputHash = buildDecisionRunInputHash({ match, prediction });
  const { data, error } = await client
    .from("op_decision_runs")
    .select("id,input_hash,llm_enhanced,llm_status,verdict,action,summary,recommended_selection,op_prediction_outcomes(id,result,market,selection)")
    .eq("fixture_external_id", match.id)
    .eq("input_hash", inputHash)
    .limit(1)
    .maybeSingle();

  if (error) return { status: "failed", reason: error.message };
  if (!data || typeof data.id !== "string") return { status: "not-found" };

  const outcomeRows = Array.isArray(data.op_prediction_outcomes) ? data.op_prediction_outcomes : [];
  const outcomeRow = outcomeRows.find(
    (value): value is { id: string; result: string; market: string; selection: string } =>
      Boolean(
        value &&
          typeof value === "object" &&
          typeof value.id === "string" &&
          typeof value.result === "string" &&
          typeof value.market === "string" &&
          typeof value.selection === "string"
      )
  );

  return {
    status: "found",
    run: {
      id: data.id,
      inputHash,
      llmEnhanced: data.llm_enhanced === true,
      llmStatus: typeof data.llm_status === "string" ? data.llm_status : null,
      verdict: data.verdict as DecisionEngineReport["verdict"],
      action: data.action as DecisionEngineReport["action"],
      summary: typeof data.summary === "string" ? data.summary : "Stored decision run reused.",
      recommendedSelection: typeof data.recommended_selection === "string" ? data.recommended_selection : null,
      outcome: outcomeRow ?? null
    }
  };
}

export async function persistDecisionRun({
  match,
  prediction,
  decision = prediction.decision,
  aiAgent = null
}: {
  match: Match;
  prediction: Prediction;
  decision?: DecisionEngineReport;
  aiAgent?: DecisionAiAgentResult | null;
}): Promise<DecisionPersistenceResult> {
  if (!isVerifiedProviderDecisionMatch(match)) {
    return {
      requested: true,
      status: "skipped",
      configured: false,
      table: "op_decision_runs",
      reason: "Autonomous decision persistence requires a verified live fixture provider and provider fixture ID; mock, seeded, and fallback fixtures are rejected."
    };
  }

  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      requested: true,
      status: "skipped",
      configured: false,
      table: "op_decision_runs",
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      requested: true,
      status: "failed",
      configured: true,
      table: "op_decision_runs",
      reason: "Supabase client could not be created."
    };
  }

  const payload = buildDecisionRunPayload({ match, prediction, decision, aiAgent });
  const evidenceBundle = (payload.model_snapshot as { evidenceBundle?: DecisionEvidenceBundle }).evidenceBundle;
  if (!evidenceBundle) {
    return {
      requested: true,
      status: "failed",
      configured: true,
      table: "op_decision_runs",
      reason: "Decision evidence bundle could not be built."
    };
  }

  const { data, error } = await client
    .from("op_decision_runs")
    .upsert(payload, {
      onConflict: "fixture_external_id,input_hash",
      ignoreDuplicates: false
    })
    .select("id")
    .single();

  if (error) {
    return {
      requested: true,
      status: "failed",
      configured: true,
      table: "op_decision_runs",
      reason: error.message
    };
  }

  const decisionRunId = typeof data?.id === "string" ? data.id : undefined;
  const evidenceBundleResult = decisionRunId
    ? await persistDecisionEvidenceBundle({ client, decisionRunId, match, prediction, decision, bundle: evidenceBundle })
    : {
        status: "failed" as const,
        configured: true,
        table: "op_decision_evidence_bundles" as const,
        reason: "Decision write did not return an ID for immutable evidence storage.",
        evidenceHash: evidenceBundle.evidenceHash,
        decisionHash: evidenceBundle.decisionHash
      };

  return {
    requested: true,
    status: "stored",
    configured: true,
    table: "op_decision_runs",
    id: decisionRunId,
    evidenceBundle: evidenceBundleResult
  };
}
