import type { DecisionAiAgentResult, DecisionEngineReport, Match, Prediction } from "@/lib/sports/types";

export const DECISION_EVIDENCE_BUNDLE_SCHEMA_VERSION = "decision-evidence-bundle-v1";

export type DecisionEvidenceBundle = {
  schemaVersion: typeof DECISION_EVIDENCE_BUNDLE_SCHEMA_VERSION;
  evidenceHash: string;
  decisionHash: string;
  inputSnapshot: Record<string, unknown>;
  sourceManifest: Record<string, unknown>;
  marketSnapshot: Record<string, unknown>;
  modelSnapshot: Record<string, unknown>;
  contextSnapshot: Record<string, unknown>;
  decisionSnapshot: Record<string, unknown>;
};

export type PersistableAiReviewEnvelope = {
  requested: boolean;
  provider: DecisionAiAgentResult["provider"];
  status: DecisionAiAgentResult["status"];
  model: string | null;
  reason: string | null;
  review: DecisionAiAgentResult["review"];
};

export function persistableAiReviewEnvelope(aiAgent: DecisionAiAgentResult | null | undefined): PersistableAiReviewEnvelope | null {
  if (!aiAgent) return null;
  return {
    requested: aiAgent.requested,
    provider: aiAgent.provider,
    status: aiAgent.status,
    model: aiAgent.model ?? null,
    reason: aiAgent.reason ?? null,
    review: aiAgent.review
  };
}

const HASH_IGNORED_KEYS = new Set([
  "generatedAt",
  "createdAt",
  "updatedAt",
  "fetchedAt",
  "retrievedAt",
  "lastCheckedAt",
  "expiresAt",
  "requestId",
  "traceId"
]);

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !HASH_IGNORED_KEYS.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)])
  );
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(canonicalValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

function inputSnapshot(match: Match): Record<string, unknown> {
  return {
    normalizedMatch: match,
    fixture: {
      id: match.id,
      sport: match.sport,
      league: match.league,
      kickoffTime: match.kickoffTime,
      status: match.status,
      score: match.score ?? null,
      venue: match.venue ?? null,
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeForm: match.homeForm,
      awayForm: match.awayForm,
      dataQualityScore: match.dataQualityScore
    },
    providerDataSource: match.dataSource ?? null
  };
}

function sourceManifest(match: Match): Record<string, unknown> {
  const dataSource = match.dataSource;
  const contextSignals = match.providerContextSignals ?? [];
  return {
    fixtureProvider: dataSource?.fixtureProvider ?? null,
    fixtureProviderId: dataSource?.fixtureProviderId ?? null,
    oddsProvider: dataSource?.oddsProvider ?? null,
    oddsProviderEventId: dataSource?.oddsProviderEventId ?? null,
    formProvider: dataSource?.formProvider ?? null,
    strengthProvider: dataSource?.strengthProvider ?? null,
    sourceKind: dataSource?.kind ?? "unknown",
    providerNotes: dataSource?.notes ?? [],
    contextSources: uniqueText(contextSignals.map((signal) => signal.source)),
    contextSignalCount: contextSignals.length,
    hasProviderEvidence: dataSource?.kind === "provider" && Boolean(dataSource.fixtureProviderId)
  };
}

function marketSnapshot(match: Match, prediction: Prediction): Record<string, unknown> {
  return {
    observedOddsMarkets: match.oddsMarkets,
    modelMarkets: prediction.markets,
    valueEdges: prediction.valueEdges,
    canonicalDecision: prediction.canonicalDecision,
    bestPick: prediction.bestPick,
    marketPriorAdjustment: prediction.marketPriorAdjustment ?? null
  };
}

function modelSnapshot(prediction: Prediction): Record<string, unknown> {
  return {
    modelKey: prediction.diagnostics.modelVersion,
    diagnostics: prediction.diagnostics,
    probabilityCalibration: prediction.calibrationAdjustment ?? null,
    contextAdjustment: prediction.contextAdjustment ?? null,
    learningProfile: prediction.decision.learningProfile ?? null,
    historicalDiscipline: prediction.decision.historicalDiscipline ?? null,
    caseMemory: prediction.decision.caseMemory ?? null,
    canonicalDecision: prediction.canonicalDecision,
    candidatePick: prediction.canonicalDecision.bestPublishedPick
  };
}

function contextSnapshot(match: Match, prediction: Prediction, decision: DecisionEngineReport): Record<string, unknown> {
  return {
    providerContextSignals: match.providerContextSignals ?? [],
    appliedAdjustment: decision.contextAdjustment ?? prediction.contextAdjustment ?? null,
    evidence: decision.evidence,
    missingSignals: decision.missingSignals,
    dataCoverage: decision.dataCoverage,
    researchBrief: decision.researchBrief
  };
}

function decisionSnapshot({
  decision,
  aiReview,
  brain,
  thinkingTrace
}: {
  decision: DecisionEngineReport;
  aiReview: PersistableAiReviewEnvelope | null;
  brain: unknown;
  thinkingTrace: unknown;
}): Record<string, unknown> {
  return {
    engineVersion: decision.engineVersion,
    verdict: decision.verdict,
    action: decision.action,
    confidence: decision.confidence,
    risk: decision.risk,
    decisionScore: decision.decisionScore,
    recommendedSelection: decision.recommendedSelection,
    summary: decision.summary,
    factors: decision.factors,
    sensitivityChecks: decision.sensitivityChecks,
    risks: decision.risks,
    avoidReasons: decision.avoidReasons,
    saferAlternatives: decision.saferAlternatives,
    nextChecks: decision.nextChecks,
    controlPolicy: decision.controlPolicy,
    actionability: decision.actionability,
    calibration: decision.calibration,
    beliefState: decision.beliefState,
    deliberation: decision.deliberation,
    probabilityTrace: decision.probabilityTrace,
    reasoningGraph: decision.reasoningGraph,
    committee: decision.committee,
    aiProtocol: decision.aiProtocol,
    toolOrchestration: decision.toolOrchestration,
    toolExecution: decision.toolExecution,
    aiAudit: decision.aiAgentAudit ?? null,
    aiReview,
    brain,
    thinkingTrace,
    llm: {
      enhanced: decision.llmEnhanced,
      model: decision.llmModel ?? null,
      status: decision.llmStatus ?? null,
      failureReason: decision.llmFailureReason ?? null
    }
  };
}

export function buildDecisionEvidenceBundle({
  match,
  prediction,
  decision = prediction.decision,
  aiReview = null,
  brain = null,
  thinkingTrace = null
}: {
  match: Match;
  prediction: Prediction;
  decision?: DecisionEngineReport;
  aiReview?: PersistableAiReviewEnvelope | null;
  brain?: unknown;
  thinkingTrace?: unknown;
}): DecisionEvidenceBundle {
  const input = inputSnapshot(match);
  const sources = sourceManifest(match);
  const markets = marketSnapshot(match, prediction);
  const model = modelSnapshot(prediction);
  const context = contextSnapshot(match, prediction, decision);
  const finalDecision = decisionSnapshot({ decision, aiReview, brain, thinkingTrace });
  const evidenceHash = stableHash({
    schemaVersion: DECISION_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    inputSnapshot: input,
    sourceManifest: sources,
    marketSnapshot: markets,
    modelSnapshot: model,
    contextSnapshot: context
  });
  const decisionHash = stableHash({
    schemaVersion: DECISION_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    evidenceHash,
    decisionSnapshot: finalDecision
  });

  return {
    schemaVersion: DECISION_EVIDENCE_BUNDLE_SCHEMA_VERSION,
    evidenceHash,
    decisionHash,
    inputSnapshot: input,
    sourceManifest: sources,
    marketSnapshot: markets,
    modelSnapshot: model,
    contextSnapshot: context,
    decisionSnapshot: finalDecision
  };
}
