import type {
  ConfidenceLevel,
  DecisionAiAgentAudit,
  DecisionAiEvidenceCheck,
  DecisionAiSafetyGate,
  DecisionAction,
  DecisionAiAgentResult,
  DecisionAiAgentReview,
  DecisionAiAgentStatus,
  DecisionEngineReport,
  DecisionVerdict,
  Match,
  Prediction,
  RiskLevel
} from "@/lib/sports/types";
import { readDecisionOpenAIProviderError } from "./decisionOpenAIProviderError";
import { extractOutputText } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

const REVIEW_LIMITS = {
  rationale: 5,
  riskFlags: 6,
  dataGaps: 6,
  saferAlternatives: 5,
  checksBeforeAction: 6,
  evidenceChecks: 8,
  safetyGates: 6,
  unsupportedClaims: 6
};

type AiEvidencePacketItem = {
  id: string;
  source: string;
  label: string;
  quality?: string;
  impact?: string | number;
  status?: string;
  detail: string;
};

const aiAgentReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: ["agree", "downgrade", "abstain", "needs-data"] },
    recommendedAction: { type: "string", enum: ["consider", "monitor", "avoid"] },
    confidenceAdjustment: { type: "string", enum: ["keep", "lower"] },
    riskAdjustment: { type: "string", enum: ["keep", "raise"] },
    summary: { type: "string" },
    rationale: { type: "array", maxItems: 3, items: { type: "string" } },
    riskFlags: { type: "array", maxItems: 3, items: { type: "string" } },
    dataGaps: { type: "array", maxItems: 3, items: { type: "string" } },
    saferAlternatives: { type: "array", maxItems: 3, items: { type: "string" } },
    checksBeforeAction: { type: "array", maxItems: 3, items: { type: "string" } },
    auditSummary: { type: "string" },
    evidenceChecks: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["supports", "opposes", "uncertain", "missing"] },
          citedEvidenceIds: { type: "array", items: { type: "string" } },
          finding: { type: "string" },
          requiredFollowUp: { type: ["string", "null"] }
        },
        required: ["id", "label", "status", "citedEvidenceIds", "finding", "requiredFollowUp"]
      }
    },
    safetyGates: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["pass", "warn", "block"] },
          reason: { type: "string" }
        },
        required: ["id", "label", "status", "reason"]
      }
    },
    unsupportedClaims: { type: "array", maxItems: 3, items: { type: "string" } }
  },
  required: [
    "reviewVerdict",
    "recommendedAction",
    "confidenceAdjustment",
    "riskAdjustment",
    "summary",
    "rationale",
    "riskFlags",
    "dataGaps",
    "saferAlternatives",
    "checksBeforeAction",
    "auditSummary",
    "evidenceChecks",
    "safetyGates",
    "unsupportedClaims"
  ]
};

function boundedText(value: unknown, max = 260): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function boundedList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item)).filter(Boolean).slice(0, maxItems);
}

function isEvidenceCheckStatus(value: unknown): value is DecisionAiEvidenceCheck["status"] {
  return value === "supports" || value === "opposes" || value === "uncertain" || value === "missing";
}

function isSafetyGateStatus(value: unknown): value is DecisionAiSafetyGate["status"] {
  return value === "pass" || value === "warn" || value === "block";
}

function boundedEvidenceChecks(value: unknown): DecisionAiEvidenceCheck[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const status = isEvidenceCheckStatus(record.status) ? record.status : null;
      const label = boundedText(record.label, 120);
      const finding = boundedText(record.finding, 360);
      if (!status || !label || !finding) return null;
      const id = boundedText(record.id, 80) || `ai-evidence-${index + 1}`;
      const requiredFollowUp = record.requiredFollowUp === null ? null : boundedText(record.requiredFollowUp, 240) || null;
      return {
        id,
        label,
        status,
        citedEvidenceIds: boundedList(record.citedEvidenceIds, 8),
        finding,
        requiredFollowUp
      };
    })
    .filter((item): item is DecisionAiEvidenceCheck => Boolean(item))
    .slice(0, REVIEW_LIMITS.evidenceChecks);
}

function boundedSafetyGates(value: unknown): DecisionAiSafetyGate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const status = isSafetyGateStatus(record.status) ? record.status : null;
      const label = boundedText(record.label, 120);
      const reason = boundedText(record.reason, 360);
      if (!status || !label || !reason) return null;
      return {
        id: boundedText(record.id, 80) || `ai-gate-${index + 1}`,
        label,
        status,
        reason
      };
    })
    .filter((item): item is DecisionAiSafetyGate => Boolean(item))
    .slice(0, REVIEW_LIMITS.safetyGates);
}

function isAction(value: unknown): value is DecisionAction {
  return value === "consider" || value === "monitor" || value === "avoid";
}

function isReviewVerdict(value: unknown): value is DecisionAiAgentReview["reviewVerdict"] {
  return value === "agree" || value === "downgrade" || value === "abstain" || value === "needs-data";
}

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function safestAction(current: DecisionAction, proposed: DecisionAction): DecisionAction {
  return actionRank(proposed) <= actionRank(current) ? proposed : current;
}

function lowerAction(action: DecisionAction): DecisionAction {
  if (action === "consider") return "monitor";
  return "avoid";
}

function lowerConfidence(confidence: ConfidenceLevel): ConfidenceLevel {
  if (confidence === "high") return "medium";
  if (confidence === "medium") return "low";
  return "low";
}

function raiseRisk(risk: RiskLevel): RiskLevel {
  if (risk === "low") return "medium";
  return "high";
}

function verdictForAction(action: DecisionAction, previous: DecisionVerdict): DecisionVerdict {
  if (action === "avoid") return "avoid";
  if (action === "monitor") return "watchlist";
  return previous === "strong-value" ? "strong-value" : "lean-value";
}

function agentStatusForDecision(status: DecisionAiAgentStatus): DecisionAiAgentStatus | undefined {
  return status === "not-requested" ? undefined : status;
}

function firstEvidenceId(packet: AiEvidencePacketItem[], predicate: (item: AiEvidencePacketItem) => boolean): string {
  return packet.find(predicate)?.id ?? packet[0]?.id ?? "fallback-audit";
}

function fallbackList(values: string[], fallback: string, maxItems: number): string[] {
  const unique = Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
  return (unique.length ? unique : [fallback]).slice(0, maxItems);
}

export function safeParseAiAgentReview(text: string): DecisionAiAgentReview | null {
  try {
    const parsed = JSON.parse(text) as Partial<DecisionAiAgentReview>;
    if (!isReviewVerdict(parsed.reviewVerdict)) return null;
    if (!isAction(parsed.recommendedAction)) return null;
    if (parsed.confidenceAdjustment !== "keep" && parsed.confidenceAdjustment !== "lower") return null;
    if (parsed.riskAdjustment !== "keep" && parsed.riskAdjustment !== "raise") return null;

    const summary = boundedText(parsed.summary, 520);
    if (!summary) return null;
    const auditSummary = boundedText(parsed.auditSummary, 520);
    const evidenceChecks = boundedEvidenceChecks(parsed.evidenceChecks);
    const safetyGates = boundedSafetyGates(parsed.safetyGates);
    if (!auditSummary || !evidenceChecks.length || !safetyGates.length) return null;

    return {
      reviewVerdict: parsed.reviewVerdict,
      recommendedAction: parsed.recommendedAction,
      confidenceAdjustment: parsed.confidenceAdjustment,
      riskAdjustment: parsed.riskAdjustment,
      summary,
      rationale: boundedList(parsed.rationale, REVIEW_LIMITS.rationale),
      riskFlags: boundedList(parsed.riskFlags, REVIEW_LIMITS.riskFlags),
      dataGaps: boundedList(parsed.dataGaps, REVIEW_LIMITS.dataGaps),
      saferAlternatives: boundedList(parsed.saferAlternatives, REVIEW_LIMITS.saferAlternatives),
      checksBeforeAction: boundedList(parsed.checksBeforeAction, REVIEW_LIMITS.checksBeforeAction),
      auditSummary,
      evidenceChecks,
      safetyGates,
      unsupportedClaims: boundedList(parsed.unsupportedClaims, REVIEW_LIMITS.unsupportedClaims)
    };
  } catch {
    return null;
  }
}

function diagnoseAiAgentReview(text: string): string {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const problems: string[] = [];
    if (!isReviewVerdict(parsed.reviewVerdict)) problems.push("reviewVerdict");
    if (!isAction(parsed.recommendedAction)) problems.push("recommendedAction");
    if (parsed.confidenceAdjustment !== "keep" && parsed.confidenceAdjustment !== "lower") problems.push("confidenceAdjustment");
    if (parsed.riskAdjustment !== "keep" && parsed.riskAdjustment !== "raise") problems.push("riskAdjustment");
    if (!boundedText(parsed.summary, 520)) problems.push("summary");
    if (!boundedText(parsed.auditSummary, 520)) problems.push("auditSummary");
    if (!boundedEvidenceChecks(parsed.evidenceChecks).length) problems.push("evidenceChecks");
    if (!boundedSafetyGates(parsed.safetyGates).length) problems.push("safetyGates");
    return problems.length ? `invalid fields: ${problems.join(", ")}` : "JSON fields passed local checks after the initial parse";
  } catch {
    return `output was not complete JSON (${text.length} characters)`;
  }
}

function responseCompletionDiagnostic(response: unknown): string {
  if (!response || typeof response !== "object") return "response metadata unavailable";
  const record = response as { status?: unknown; incomplete_details?: { reason?: unknown } | null };
  const status = typeof record.status === "string" ? record.status : "unknown";
  const incompleteReason =
    record.incomplete_details && typeof record.incomplete_details.reason === "string" ? record.incomplete_details.reason : null;
  return incompleteReason ? `response status ${status}; incomplete reason ${incompleteReason}` : `response status ${status}`;
}

export function buildAiAgentEvidencePacket(decision: DecisionEngineReport): AiEvidencePacketItem[] {
  const evidence = decision.evidence.map((item, index) => ({
    id: `evidence-${index + 1}-${item.category}`,
    source: item.category,
    label: item.label,
    quality: item.quality,
    impact: item.impact,
    detail: item.detail
  }));
  const odds = [
    {
      id: "odds-intelligence-summary",
      source: "odds-intelligence",
      label: "Odds intelligence summary",
      status: decision.oddsIntelligence.status,
      impact: decision.oddsIntelligence.actionableSelections ? "positive" : "neutral",
      detail: decision.oddsIntelligence.summary
    },
    ...decision.oddsIntelligence.topCandidates.slice(0, 5).map((item, index) => ({
      id: `odds-candidate-${index + 1}-${item.marketId}-${item.selectionId}`,
      source: "odds-intelligence",
      label: item.label,
      status: item.action,
      impact: item.confidence,
      detail: `${item.reason} Model ${item.modelProbability}, no-vig ${item.noVigImpliedProbability}, edge ${item.edge}, EV ${item.expectedValue}.`
      }))
  ];
  const marketMovement = [
    {
      id: "market-movement-summary",
      source: "market-movement",
      label: "Market movement summary",
      status: decision.marketMovement.status,
      impact: decision.marketMovement.status === "resilient" ? "positive" : decision.marketMovement.status === "no-market" ? "neutral" : "caution",
      detail: decision.marketMovement.summary
    },
    ...decision.marketMovement.scenarios.slice(0, 5).map((item) => ({
      id: `market-movement-${item.id}`,
      source: "market-movement",
      label: item.label,
      status: item.actionAfterMove,
      impact: item.expectedValue === null ? "unknown" : item.expectedValue > 0 ? "positive" : "negative",
      detail: `${item.detail} Odds ${item.odds ?? "N/A"}; edge ${item.edge ?? "N/A"}; EV ${item.expectedValue ?? "N/A"}.`
    }))
  ];
  const probabilityTrace = [
    {
      id: "probability-trace-summary",
      source: "probability-trace",
      label: "Probability trace summary",
      status: decision.probabilityTrace.status,
      impact: decision.probabilityTrace.status === "ready" ? "positive" : decision.probabilityTrace.status === "watchlist" ? "caution" : "negative",
      detail: decision.probabilityTrace.summary
    },
    ...decision.probabilityTrace.steps.slice(0, 8).map((item) => ({
      id: `probability-trace-${item.id}`,
      source: `probability-trace-${item.kind}`,
      label: item.label,
      status: item.status,
      impact: item.confidence,
      detail: `${item.detail} Prior ${item.priorProbability ?? "N/A"}; posterior ${item.posteriorProbability ?? "N/A"}; log-odds delta ${item.logOddsDelta}.`
    }))
  ];
  const attribution = [
    {
      id: "attribution-summary",
      source: "decision-attribution",
      label: "Decision attribution summary",
      status: decision.attribution.status,
      impact: decision.attribution.status === "supportive" ? "positive" : decision.attribution.status === "mixed" ? "caution" : "negative",
      detail: `${decision.attribution.summary} Decisive factor: ${decision.attribution.decisiveFactor}. ${decision.attribution.explanation}`
    },
    ...decision.attribution.positiveDrivers.slice(0, 4).map((item) => ({
      id: `attribution-positive-${item.id}`,
      source: `decision-attribution-${item.category}`,
      label: item.label,
      status: item.direction,
      impact: item.impactScore,
      detail: item.detail
    })),
    ...decision.attribution.negativeDrivers.slice(0, 4).map((item) => ({
      id: `attribution-negative-${item.id}`,
      source: `decision-attribution-${item.category}`,
      label: item.label,
      status: item.direction,
      impact: item.impactScore,
      detail: item.detail
    }))
  ];
  const uncertainty = [
    {
      id: "uncertainty-summary",
      source: "uncertainty-decomposition",
      label: "Uncertainty decomposition summary",
      status: decision.uncertainty.status,
      impact: decision.uncertainty.status === "controlled" ? "positive" : decision.uncertainty.status === "watchlist" ? "caution" : "negative",
      detail: `${decision.uncertainty.summary} Primary uncertainty: ${decision.uncertainty.primaryUncertainty}. ${decision.uncertainty.decisionImpact}`
    },
    ...decision.uncertainty.components.slice(0, 6).map((item) => ({
      id: `uncertainty-${item.id}`,
      source: `uncertainty-${item.category}`,
      label: item.label,
      status: item.level,
      impact: item.score,
      detail: `${item.detail} Mitigation: ${item.mitigation}`
    }))
  ];
  const decisionBoundary = [
    {
      id: "decision-boundary-summary",
      source: "decision-boundary",
      label: "Decision boundary summary",
      status: decision.decisionBoundary.status,
      impact:
        decision.decisionBoundary.status === "comfortable"
          ? "positive"
          : decision.decisionBoundary.status === "near-flip" || decision.decisionBoundary.status === "at-risk"
            ? "caution"
            : "negative",
      detail: `${decision.decisionBoundary.summary} Next action: ${decision.decisionBoundary.nextAction}`
    },
    ...decision.decisionBoundary.metrics.slice(0, 8).map((item) => ({
      id: `decision-boundary-${item.id}`,
      source: `decision-boundary-${item.kind}`,
      label: item.label,
      status: item.status,
      impact: item.margin ?? "unknown",
      detail: `${item.detail} Current ${item.current ?? "N/A"}; threshold ${item.threshold ?? "N/A"}; margin ${item.margin ?? "N/A"}.`
    }))
  ];
  const aiProtocol = [
    {
      id: "ai-protocol-summary",
      source: "ai-protocol",
      label: "AI protocol summary",
      status: decision.aiProtocol.status,
      impact: decision.aiProtocol.status === "ready" || decision.aiProtocol.status === "reviewed" ? "positive" : decision.aiProtocol.status === "needs-data" ? "caution" : "negative",
      detail: `${decision.aiProtocol.summary} Objective: ${decision.aiProtocol.objective}`
    },
    ...decision.aiProtocol.questions.slice(0, 6).map((item) => ({
      id: `ai-protocol-question-${item.id}`,
      source: "ai-protocol-question",
      label: item.prompt,
      status: item.status,
      impact: item.status === "answered" ? "positive" : item.status === "needs-data" ? "caution" : "negative",
      detail: `${item.answer} Follow-up: ${item.followUp ?? "No follow-up."} Evidence: ${item.evidenceIds.join(", ")}.`
    })),
    ...decision.aiProtocol.checks.slice(0, 7).map((item) => ({
      id: `ai-protocol-check-${item.id}`,
      source: "ai-protocol-check",
      label: item.label,
      status: item.status,
      impact: item.status === "pass" ? "positive" : item.status === "watch" ? "caution" : "negative",
      detail: `${item.detail} Evidence: ${item.evidenceIds.join(", ")}.`
    }))
  ];
  const reasoningGraph = [
    {
      id: "reasoning-graph-summary",
      source: "reasoning-graph",
      label: "Reasoning graph summary",
      status: decision.reasoningGraph.status,
      impact: decision.reasoningGraph.status === "coherent" ? "positive" : decision.reasoningGraph.status === "contested" ? "caution" : "negative",
      detail: `${decision.reasoningGraph.summary} Strongest path: ${decision.reasoningGraph.strongestPath.join(" -> ") || "none"}.`
    },
    ...decision.reasoningGraph.nodes.slice(0, 10).map((item) => ({
      id: `reasoning-node-${item.id}`,
      source: `reasoning-graph-${item.type}`,
      label: item.label,
      status: item.status,
      impact: item.strength,
      detail: `${item.detail} Evidence: ${item.evidenceIds.join(", ") || "none"}.`
    })),
    ...decision.reasoningGraph.edges.slice(0, 10).map((item) => ({
      id: `reasoning-edge-${item.id}`,
      source: `reasoning-graph-${item.relation}`,
      label: `${item.from} ${item.relation} ${item.to}`,
      status: item.relation,
      impact: item.weight,
      detail: item.detail
    }))
  ];
  const toolOrchestration = [
    {
      id: "tool-orchestration-summary",
      source: "tool-orchestration",
      label: "Tool orchestration summary",
      status: decision.toolOrchestration.status,
      impact: decision.toolOrchestration.readinessScore,
      detail: `${decision.toolOrchestration.summary} Next task: ${decision.toolOrchestration.nextTaskId ?? "none"}.`
    },
    ...decision.toolOrchestration.tasks.slice(0, 10).map((item) => ({
      id: `tool-task-${item.id}`,
      source: `tool-orchestration-${item.category}`,
      label: item.label,
      status: item.status,
      impact: item.priority,
      detail: `${item.reason} Unlocks: ${item.unlocks} Decision impact: ${item.decisionImpact}`
    }))
  ];
  const toolExecution = [
    {
      id: "tool-execution-summary",
      source: "tool-execution",
      label: "Tool execution summary",
      status: decision.toolExecution.status,
      impact: decision.toolExecution.executedTasks,
      detail: `${decision.toolExecution.summary} Next run: ${decision.toolExecution.nextRun}`
    },
    ...decision.toolExecution.attempts.slice(0, 10).map((item) => ({
      id: `tool-execution-${item.taskId}`,
      source: `tool-execution-${item.category}`,
      label: item.label,
      status: item.status,
      impact: item.observedRecords ?? item.priority,
      detail: `${item.detail} Output signals: ${item.outputSignals.join(", ")}. Decision delta: ${item.decisionDelta}`
    }))
  ];
  const controlPolicy = [
    {
      id: "control-policy-summary",
      source: "control-policy",
      label: "Control policy summary",
      status: decision.controlPolicy.status,
      impact: decision.controlPolicy.visibility,
      detail: `${decision.controlPolicy.summary} Directive: ${decision.controlPolicy.primaryDirective} Next: ${decision.controlPolicy.nextBestAction}`
    },
    ...decision.controlPolicy.gates.slice(0, 10).map((item) => ({
      id: `control-gate-${item.id}`,
      source: `control-policy-${item.source}`,
      label: item.label,
      status: item.status,
      impact: item.requiredAction ? "requires-action" : "clear",
      detail: `${item.detail} Required action: ${item.requiredAction ?? "none"}.`
    }))
  ];
  const dataCoverage = [
    {
      id: "data-coverage-summary",
      source: "data-coverage",
      label: "Data coverage summary",
      status: decision.dataCoverage.status,
      impact: decision.dataCoverage.score >= 70 ? "positive" : decision.dataCoverage.score >= 45 ? "neutral" : "negative",
      detail: decision.dataCoverage.summary
    },
    ...decision.dataCoverage.signals
      .filter((signal) => signal.status === "missing" || signal.status === "mock" || signal.status === "stale")
      .slice(0, 8)
      .map((signal) => ({
        id: `data-coverage-${signal.id}`,
        source: `data-coverage-${signal.category}`,
        label: signal.label,
        status: signal.status,
        impact: signal.requiredForProduction ? "critical" : "informational",
        detail: signal.detail
      }))
  ];
  const historicalDiscipline = [
    {
      id: "historical-discipline-summary",
      source: "historical-discipline",
      label: "Historical discipline summary",
      status: decision.historicalDiscipline.status,
      impact: decision.historicalDiscipline.trustEffect,
      detail: `${decision.historicalDiscipline.summary} Instruction: ${decision.historicalDiscipline.instruction} Fixtures ${decision.historicalDiscipline.fixtures}; odds rows ${decision.historicalDiscipline.oddsRows}; benchmark ${decision.historicalDiscipline.benchmarkVerdict ?? "not-attached"}.`
    },
    ...decision.historicalDiscipline.requiredBeforePromotion.slice(0, 5).map((item, index) => ({
      id: `historical-discipline-requirement-${index + 1}`,
      source: "historical-discipline-requirement",
      label: `Historical promotion requirement ${index + 1}`,
      status: decision.historicalDiscipline.status,
      impact: "required-before-promotion",
      detail: item
    }))
  ];
  const belief = decision.beliefState.signals.slice(0, 8).map((item) => ({
    id: `belief-${item.id}`,
    source: `belief-${item.source}`,
    label: item.label,
    status: item.direction,
    impact: item.confidence,
    detail: item.detail
  }));
  const gates = decision.abstentionRules.map((item) => ({
    id: `abstention-${item.id}`,
    source: "abstention-gate",
    label: item.label,
    status: item.triggered ? "triggered" : "clear",
    detail: item.detail
  }));
  const researchBrief = [
    {
      id: "research-brief-summary",
      source: "research-brief",
      label: decision.researchBrief.headline,
      status: decision.researchBrief.status,
      impact: decision.action,
      detail: `${decision.researchBrief.executiveSummary} ${decision.researchBrief.analystPosture} ${decision.researchBrief.decisionClock}`
    },
    {
      id: "research-brief-thesis",
      source: "research-brief",
      label: "Model, market, and risk thesis",
      status: decision.researchBrief.status,
      impact: decision.confidence,
      detail: `Model: ${decision.researchBrief.modelThesis} Market: ${decision.researchBrief.marketThesis} Risk: ${decision.researchBrief.riskThesis}`
    },
    {
      id: "research-brief-checks",
      source: "research-brief",
      label: "Required research checks",
      status: decision.researchBrief.requiredChecks.length ? "requires-checks" : "clear",
      impact: decision.risk,
      detail: decision.researchBrief.requiredChecks.join(" ") || "No research-brief checks remain open."
    }
  ];
  const notebook = [
    {
      id: "notebook-summary",
      source: "decision-notebook",
      label: "Decision notebook summary",
      status: decision.notebook.status,
      impact: decision.action,
      detail: decision.notebook.summary
    },
    ...decision.notebook.falsifiers.slice(0, 4).map((item) => ({
      id: `notebook-falsifier-${item.id}`,
      source: `decision-notebook-${item.source}`,
      label: item.label,
      status: item.status,
      impact: item.priority,
      detail: `${item.detail} Action: ${item.action}`
    })),
    ...decision.notebook.operatorChecklist.slice(0, 4).map((item) => ({
      id: `notebook-check-${item.id}`,
      source: `decision-notebook-${item.source}`,
      label: item.label,
      status: item.status,
      impact: item.priority,
      detail: `${item.detail} Action: ${item.action}`
    }))
  ];
  const robustness = decision.robustness.cases.map((item) => ({
    id: `robustness-${item.id}`,
    source: "robustness-stress-test",
    label: item.label,
    status: item.status,
    impact: item.actionAfterShock,
    detail: `${item.detail} Repair: ${item.repair}`
  }));
  return [
    ...evidence,
    ...dataCoverage,
    ...odds,
    ...marketMovement,
    ...probabilityTrace,
    ...attribution,
    ...uncertainty,
    ...decisionBoundary,
    ...aiProtocol,
    ...reasoningGraph,
    ...toolOrchestration,
    ...toolExecution,
    ...controlPolicy,
    ...historicalDiscipline,
    ...belief,
    ...gates,
    ...researchBrief,
    ...notebook,
    ...robustness
  ];
}

export function buildDeterministicAiAgentFallbackReview({
  decision,
  reason
}: {
  decision: DecisionEngineReport;
  reason: string;
}): DecisionAiAgentReview {
  const evidencePacket = buildAiAgentEvidencePacket(decision);
  const dataId = firstEvidenceId(evidencePacket, (item) => item.id === "data-coverage-summary");
  const oddsId = firstEvidenceId(evidencePacket, (item) => item.id === "odds-intelligence-summary");
  const traceId = firstEvidenceId(evidencePacket, (item) => item.id === "probability-trace-summary");
  const controlId = firstEvidenceId(evidencePacket, (item) => item.id === "control-policy-summary");
  const historyId = firstEvidenceId(evidencePacket, (item) => item.id === "historical-discipline-summary");
  const robustnessId = firstEvidenceId(evidencePacket, (item) => item.id === "uncertainty-summary" || item.source === "robustness-stress-test");
  const hasControlBlock = decision.controlPolicy.status === "blocked" || !decision.controlPolicy.safeToDisplay;
  const hasDataDebt = decision.dataCoverage.requiredBeforeTrust.length > 0 || decision.missingSignals.length > 0;
  const hasActionabilityBlock = decision.actionability.status === "blocked" || decision.actionability.blockers.length > 0;
  const hasHighRisk = decision.risk === "high" || decision.robustness.status === "fragile" || decision.uncertainty.status === "high-risk";
  const hasHistoricalMarketCap = decision.historicalDiscipline.cappedByMarketPrior || decision.historicalDiscipline.trustEffect === "cap-raw-edge";
  const hardBlock = hasControlBlock || hasActionabilityBlock;
  const recommendedAction: DecisionAction = hardBlock ? "avoid" : hasDataDebt || hasHighRisk ? "monitor" : decision.action;
  const reviewVerdict: DecisionAiAgentReview["reviewVerdict"] =
    hardBlock ? "abstain" : hasDataDebt || hasHighRisk ? "needs-data" : "agree";
  const dataGaps = fallbackList(
    [...decision.missingSignals, ...decision.dataCoverage.requiredBeforeTrust],
    "No provider-backed data gap was detected by the deterministic fallback audit.",
    REVIEW_LIMITS.dataGaps
  );
  const riskFlags = fallbackList(
    [
      ...decision.risks,
      ...(hasHistoricalMarketCap ? [`Historical discipline: ${decision.historicalDiscipline.summary}`] : []),
      ...decision.actionability.blockers,
      ...decision.controlPolicy.gates.filter((gate) => gate.status !== "pass").map((gate) => `${gate.label}: ${gate.detail}`)
    ],
    "No extra risk flag was detected by the deterministic fallback audit.",
    REVIEW_LIMITS.riskFlags
  );
  const saferAlternatives = fallbackList(
    decision.saferAlternatives.map((alternative) => `${alternative.market}: ${alternative.selection}. ${alternative.rationale}`),
    "Keep the match monitor-only until provider, market, and context evidence refresh.",
    REVIEW_LIMITS.saferAlternatives
  );
  const checksBeforeAction = fallbackList(
    [...decision.nextChecks, ...decision.actionability.requiredBeforeAction, decision.controlPolicy.nextBestAction],
    "Rerun the deterministic decision proof before any public action.",
    REVIEW_LIMITS.checksBeforeAction
  );

  return {
    reviewVerdict,
    recommendedAction,
    confidenceAdjustment: recommendedAction === decision.action && !hasDataDebt ? "keep" : "lower",
    riskAdjustment: hasDataDebt || hasHighRisk || hardBlock ? "raise" : "keep",
    summary:
      recommendedAction === "avoid"
        ? `Deterministic fallback AI audit abstains because safety/control evidence is not clear. Provider reason: ${reason}`
        : recommendedAction === "monitor"
          ? `Deterministic fallback AI audit keeps this monitor-only until missing data and risk checks clear. Provider reason: ${reason}`
          : `Deterministic fallback AI audit agrees with the local action while preserving no-upgrade guardrails. Provider reason: ${reason}`,
    rationale: fallbackList(
      [
        decision.summary,
        decision.oddsIntelligence.summary,
        decision.dataCoverage.summary,
        decision.controlPolicy.summary
      ],
      "Fallback audit used only supplied deterministic evidence.",
      REVIEW_LIMITS.rationale
    ),
    riskFlags,
    dataGaps,
    saferAlternatives,
    checksBeforeAction,
    auditSummary: `Deterministic fallback reviewer checked supplied evidence after OpenAI review was unavailable: ${reason}`,
    evidenceChecks: [
      {
        id: "fallback-market-math",
        label: "Market math and value edge",
        status: decision.oddsIntelligence.bestSelection ? "supports" : "uncertain",
        citedEvidenceIds: [oddsId, traceId],
        finding: decision.oddsIntelligence.summary,
        requiredFollowUp: decision.oddsIntelligence.bestSelection ? null : "Refresh priced markets and recompute no-vig edge."
      },
      {
        id: "fallback-data-coverage",
        label: "Provider and context coverage",
        status: hasDataDebt ? "missing" : "supports",
        citedEvidenceIds: [dataId],
        finding: decision.dataCoverage.summary,
        requiredFollowUp: hasDataDebt ? dataGaps[0] ?? "Clear data coverage gaps." : null
      },
      {
        id: "fallback-control-policy",
        label: "Control and actionability gate",
        status: hardBlock ? "opposes" : decision.controlPolicy.publishAllowed ? "supports" : "uncertain",
        citedEvidenceIds: [controlId],
        finding: decision.controlPolicy.summary,
        requiredFollowUp: hardBlock || !decision.controlPolicy.publishAllowed ? decision.controlPolicy.nextBestAction : null
      },
      {
        id: "fallback-historical-discipline",
        label: "Historical discipline and market prior",
        status: hasHistoricalMarketCap ? "opposes" : decision.historicalDiscipline.attached ? "uncertain" : "missing",
        citedEvidenceIds: [historyId],
        finding: decision.historicalDiscipline.summary,
        requiredFollowUp: hasHistoricalMarketCap
          ? decision.historicalDiscipline.requiredBeforePromotion[0] ?? "Run provider-enriched retest before promotion."
          : decision.historicalDiscipline.attached
            ? decision.historicalDiscipline.instruction
            : "Attach public historical evidence or persisted provider-backed training evidence."
      },
      {
        id: "fallback-risk-robustness",
        label: "Risk and robustness",
        status: hasHighRisk ? "opposes" : "supports",
        citedEvidenceIds: [robustnessId],
        finding: `${decision.uncertainty.summary} ${decision.robustness.summary}`,
        requiredFollowUp: hasHighRisk ? decision.robustness.requiredRechecks[0] ?? "Rerun robustness checks." : null
      }
    ],
    safetyGates: [
      {
        id: "fallback-no-upgrade",
        label: "No upgrade from fallback review",
        status: "pass",
        reason: "The deterministic fallback can keep or lower action only; it cannot raise confidence or publish."
      },
      {
        id: "fallback-provider-unavailable",
        label: "OpenAI provider unavailable",
        status: hardBlock ? "block" : "warn",
        reason
      },
      {
        id: "fallback-historical-discipline",
        label: "Historical discipline no-promotion gate",
        status: hasHistoricalMarketCap ? "block" : decision.historicalDiscipline.attached ? "warn" : "pass",
        reason: hasHistoricalMarketCap
          ? "Historical public-market evidence says market prior dominates; fallback review must not publish or upgrade raw value."
          : decision.historicalDiscipline.attached
            ? "Historical evidence is attached but remains diagnostic/provider-retest only."
            : "No historical discipline evidence is attached to this review."
      }
    ],
    unsupportedClaims: []
  };
}

function buildAiAgentAudit(review: DecisionAiAgentReview, allowedEvidenceIds: Set<string>): DecisionAiAgentAudit {
  const evidenceChecks = review.evidenceChecks.map((item) => ({
    ...item,
    citedEvidenceIds: item.citedEvidenceIds.filter((id) => allowedEvidenceIds.has(id))
  }));
  return {
    auditSummary: review.auditSummary,
    evidenceChecks,
    safetyGates: review.safetyGates,
    citedEvidenceIds: Array.from(new Set(evidenceChecks.flatMap((item) => item.citedEvidenceIds))).slice(0, 24),
    unsupportedClaims: review.unsupportedClaims
  };
}

export function applyAiAgentReviewToDecision({
  decision,
  review,
  model,
  reviewSource = "openai"
}: {
  decision: DecisionEngineReport;
  review: DecisionAiAgentReview;
  model: string;
  reviewSource?: "openai" | "deterministic-fallback";
}): DecisionEngineReport {
  const reviewedByOpenAI = reviewSource === "openai";
  const reviewerLabel = reviewedByOpenAI ? "OpenAI reviewer" : "Deterministic fallback reviewer";
  const evidencePacket = buildAiAgentEvidencePacket(decision);
  const aiAgentAudit = buildAiAgentAudit(review, new Set(evidencePacket.map((item) => item.id)));
  const hasBlockingGate = aiAgentAudit.safetyGates.some((gate) => gate.status === "block");
  const gateWarnings = aiAgentAudit.safetyGates.filter((gate) => gate.status !== "pass").map((gate) => `${gate.label}: ${gate.reason}`);
  const evidenceFollowUps = aiAgentAudit.evidenceChecks
    .filter((check) => check.requiredFollowUp)
    .map((check) => `${check.label}: ${check.requiredFollowUp}`);
  const proposedAction =
    hasBlockingGate || review.reviewVerdict === "abstain" || review.reviewVerdict === "needs-data"
      ? "avoid"
      : review.reviewVerdict === "downgrade"
        ? lowerAction(decision.action)
        : review.recommendedAction;
  const finalAction = safestAction(decision.action, proposedAction);
  const confidence = review.confidenceAdjustment === "lower" || finalAction !== decision.action ? lowerConfidence(decision.confidence) : decision.confidence;
  const risk = review.riskAdjustment === "raise" || finalAction !== decision.action ? raiseRisk(decision.risk) : decision.risk;
  const verdict = verdictForAction(finalAction, decision.verdict);
  const downgradeNote =
    finalAction !== decision.action
      ? `${reviewerLabel} downgraded action from ${decision.action} to ${finalAction}; local guardrails prevent upward promotion.`
      : `${reviewerLabel} agreed with the local action under the no-upgrade guardrail.`;
  const citedNote = reviewedByOpenAI
    ? `AI evidence audit cited ${aiAgentAudit.citedEvidenceIds.length} supplied evidence item(s), checked ${aiAgentAudit.evidenceChecks.length} evidence point(s), and found ${aiAgentAudit.safetyGates.filter((gate) => gate.status === "block").length} blocking gate(s).`
    : `Deterministic fallback audit cited ${aiAgentAudit.citedEvidenceIds.length} supplied evidence item(s), checked ${aiAgentAudit.evidenceChecks.length} evidence point(s), and found ${aiAgentAudit.safetyGates.filter((gate) => gate.status === "block").length} blocking gate(s).`;
  const aiProtocol = {
    ...decision.aiProtocol,
    status: "reviewed" as const,
    mode: "openai-reviewed" as const,
    summary: `${decision.aiProtocol.summary} OpenAI reviewer completed a cited audit with verdict ${review.reviewVerdict}.`,
    checks: [
      ...decision.aiProtocol.checks,
      {
        id: "openai-review",
        label: "OpenAI reviewer audit",
        status: hasBlockingGate ? ("fail" as const) : review.reviewVerdict === "needs-data" ? ("watch" as const) : ("pass" as const),
        detail: review.auditSummary,
        evidenceIds: aiAgentAudit.citedEvidenceIds
      }
    ]
  };
  const completedToolTasks = decision.toolOrchestration.tasks.map((task) =>
    task.id === "openai-review"
      ? {
          ...task,
          status: "complete" as const,
          reason: `${task.reason} OpenAI reviewer completed with verdict ${review.reviewVerdict}.`,
          decisionImpact: `Applied guarded review outcome ${finalAction}; local no-upgrade guardrail remained active.`
        }
      : task
  );
  const toolOrchestration = {
    ...decision.toolOrchestration,
    tasks: completedToolTasks,
    readyTasks: Array.from(new Set([...decision.toolOrchestration.readyTasks, "openai-review"])),
    blockingTasks: decision.toolOrchestration.blockingTasks.filter((taskId) => taskId !== "openai-review"),
    summary: `${decision.toolOrchestration.summary} Guarded AI review completed with verdict ${review.reviewVerdict}.`
  };
  const reviewCompletedAt = new Date().toISOString();
  const completedToolAttempts = decision.toolExecution.attempts.map((attempt) =>
    attempt.taskId === "openai-review"
      ? {
          ...attempt,
          status: "executed" as const,
          observedRecords: aiAgentAudit.evidenceChecks.length + aiAgentAudit.safetyGates.length,
          completedAt: reviewCompletedAt,
          detail: `Run guarded AI reviewer executed from ${attempt.provider} with verdict ${review.reviewVerdict}.`,
          decisionDelta: `Applied guarded review outcome ${finalAction}; local no-upgrade guardrail remained active.`,
          nextAction: gateWarnings[0] ?? evidenceFollowUps[0] ?? "Keep the cited audit with the persisted decision run."
        }
      : attempt
  );
  const executedToolAttempts = completedToolAttempts.filter((attempt) => attempt.status === "executed").length;
  const blockedToolAttempts = completedToolAttempts.filter((attempt) => attempt.status === "blocked").length;
  const waitingToolAttempts = completedToolAttempts.filter((attempt) => attempt.status === "waiting").length;
  const skippedToolAttempts = completedToolAttempts.filter((attempt) => attempt.status === "skipped").length;
  const toolExecution = {
    ...decision.toolExecution,
    status: blockedToolAttempts ? ("blocked" as const) : waitingToolAttempts || skippedToolAttempts ? ("partial" as const) : ("complete" as const),
    mode: "openai-reviewed" as const,
    attempts: completedToolAttempts,
    executedTasks: executedToolAttempts,
    blockedTasks: blockedToolAttempts,
    waitingTasks: waitingToolAttempts,
    skippedTasks: skippedToolAttempts,
    summary: `${decision.toolExecution.summary} Guarded AI review execution completed with verdict ${review.reviewVerdict}.`,
    nextRun: gateWarnings[0] ?? evidenceFollowUps[0] ?? decision.toolExecution.nextRun,
    publicLog: [
      ...decision.toolExecution.publicLog,
      `Run guarded AI reviewer: executed; verdict ${review.reviewVerdict}; applied action ${finalAction}.`
    ].slice(0, 10)
  };
  const reviewedControlGates = decision.controlPolicy.gates.map((gate) =>
    gate.id === "ai-review"
      ? {
          ...gate,
          status: hasBlockingGate ? ("block" as const) : review.reviewVerdict === "needs-data" ? ("watch" as const) : ("pass" as const),
          detail: review.auditSummary,
          requiredAction: gateWarnings[0] ?? evidenceFollowUps[0] ?? null
        }
      : gate
  );
  const controlHasBlock = finalAction === "avoid" || reviewedControlGates.some((gate) => gate.status === "block");
  const controlHasWatch = reviewedControlGates.some((gate) => gate.status === "watch");
  const controlStatus = controlHasBlock
    ? ("blocked" as const)
    : controlHasWatch || finalAction === "monitor"
      ? ("monitor-only" as const)
      : decision.controlPolicy.rerunRequired
        ? ("needs-rerun" as const)
        : ("publishable" as const);
  const controlPolicy = {
    ...decision.controlPolicy,
    status: controlStatus,
    visibility:
      controlStatus === "publishable"
        ? ("public-candidate" as const)
        : controlStatus === "blocked"
          ? ("internal-only" as const)
          : ("watchlist-only" as const),
    automationMode: controlStatus === "publishable" ? ("auto-monitor" as const) : controlStatus === "blocked" ? ("blocked" as const) : ("operator-review" as const),
    publishAllowed: controlStatus === "publishable",
    aiReviewRequired: false,
    rerunRequired: controlStatus === "needs-rerun" || controlStatus === "blocked",
    safeToDisplay: controlStatus !== "blocked",
    primaryBlockerId: reviewedControlGates.find((gate) => gate.status === "block")?.id ?? reviewedControlGates.find((gate) => gate.status === "watch")?.id ?? null,
    summary: `${decision.controlPolicy.summary} Guarded AI review updated the control policy with verdict ${review.reviewVerdict}.`,
    primaryDirective:
      controlStatus === "publishable"
        ? "Show as an inspectable value candidate with monitoring and responsible-use warnings."
        : controlStatus === "monitor-only"
          ? "Keep on the public watchlist only; do not present as actionable value."
          : controlStatus === "needs-rerun"
            ? "Run the next required tool and rerun the decision before publishing."
            : "Block public display and collect the required evidence first.",
    nextBestAction: gateWarnings[0] ?? evidenceFollowUps[0] ?? decision.controlPolicy.nextBestAction,
    gates: reviewedControlGates,
    forbiddenActions:
      controlStatus === "publishable"
        ? decision.controlPolicy.forbiddenActions
        : Array.from(new Set([...decision.controlPolicy.forbiddenActions, "publish as value candidate", "upgrade by AI review"])).slice(0, 8)
  };

  return {
    ...decision,
    verdict,
    action: finalAction,
    confidence,
    risk,
    recommendedSelection: finalAction === "avoid" ? null : decision.recommendedSelection,
    summary: review.summary,
    health: finalAction === "avoid" ? "fragile" : finalAction === "monitor" && decision.health === "stable" ? "review" : decision.health,
    calibration: {
      ...decision.calibration,
      health: finalAction === "avoid" ? "fragile" : finalAction === "monitor" && decision.calibration.health === "stable" ? "review" : decision.calibration.health,
      action: finalAction === "avoid" ? "abstain" : finalAction === "monitor" && decision.calibration.action === "trust" ? "discount" : decision.calibration.action,
      detail: `${decision.calibration.detail} ${downgradeNote}`
    },
    risks: Array.from(new Set([...gateWarnings, ...review.unsupportedClaims, ...review.riskFlags, ...decision.risks])).slice(0, 10),
    avoidReasons:
      finalAction === "avoid"
        ? Array.from(new Set([...decision.avoidReasons, ...review.rationale, ...gateWarnings, downgradeNote])).slice(0, 10)
        : decision.avoidReasons,
    saferAlternatives: decision.saferAlternatives.map((alternative, index) => ({
      ...alternative,
      rationale: review.saferAlternatives[index] ?? alternative.rationale
    })),
    missingSignals: Array.from(new Set([...decision.missingSignals, ...review.dataGaps])).slice(0, 8),
    nextChecks: Array.from(new Set([...evidenceFollowUps, ...review.checksBeforeAction, ...decision.nextChecks])).slice(0, 12),
    aiProtocol,
    toolOrchestration,
    toolExecution,
    controlPolicy,
    publicReasoningSteps: [
      ...decision.publicReasoningSteps,
      `AI reviewer audit: ${review.auditSummary}`,
      `AI reviewer verdict: ${review.reviewVerdict}; recommended action ${review.recommendedAction}; applied action ${finalAction}.`,
      citedNote,
      downgradeNote
    ],
    llmEnhanced: reviewedByOpenAI,
    llmModel: reviewedByOpenAI ? model : undefined,
    llmStatus: reviewedByOpenAI ? "enhanced" : decision.llmStatus,
    aiAgentReviewed: reviewedByOpenAI,
    aiAgentStatus: reviewedByOpenAI ? "reviewed" : undefined,
    aiAgentModel: reviewedByOpenAI ? model : undefined,
    aiAgentVerdict: reviewedByOpenAI ? review.reviewVerdict : undefined,
    aiAgentSummary: reviewedByOpenAI ? review.summary : undefined,
    aiAgentAudit
  };
}

export function buildOpenAIDecisionAgentPayload({
  match,
  prediction,
  model
}: {
  match: Match;
  prediction: Prediction;
  model: string;
}) {
  return {
    model,
    store: false,
    reasoning: { effort: "low" },
    input: [
      {
        role: "system",
        content:
          "You are OddsPadi's guarded AI decision reviewer. Use only the supplied JSON and cite supplied evidence IDs in evidenceChecks. Review the math, market edge, historical discipline, evidence, missing data, risks, abstention gates, monitoring plan, and robustness tests. If historical discipline says market prior dominates or caps raw edge, you must not publish, upgrade, or recommend that raw model value until provider-enriched retest evidence clears the supplied promotion requirements. Return public audit notes only, not hidden chain-of-thought. You may agree, downgrade, abstain, or require more data. You must not invent injuries, lineups, weather, news, odds, scores, or private facts. You must not upgrade an avoid/monitor decision into a stronger recommendation. Put any claim that is not directly supported by a supplied evidence ID into unsupportedClaims. Keep every string short, return no more than three items in each list, and use three or four evidence checks and safety gates only."
      },
      {
        role: "user",
        content: JSON.stringify({
          fixture: {
            id: match.id,
            sport: match.sport,
            homeTeam: match.homeTeam.name,
            awayTeam: match.awayTeam.name,
            league: match.league.name,
            country: match.league.country,
            kickoffTime: match.kickoffTime,
            status: match.status,
            score: match.score ?? null
          },
          model: {
            diagnostics: prediction.diagnostics,
            markets: prediction.markets,
            valueEdges: prediction.valueEdges,
            bestPick: prediction.bestPick
          },
          aiProtocol: prediction.decision.aiProtocol,
          reasoningGraph: prediction.decision.reasoningGraph,
          toolOrchestration: prediction.decision.toolOrchestration,
          toolExecution: prediction.decision.toolExecution,
          controlPolicy: prediction.decision.controlPolicy,
          evidencePacket: buildAiAgentEvidencePacket(prediction.decision),
          requiredAudit: {
            citeEvidenceIds: true,
            checkMarketMath: true,
            checkMissingContext: true,
            checkRobustness: true,
            checkActionability: true,
            blockIfUnsupportedClaimsMatter: true
          },
          deterministicDecision: {
            engineVersion: prediction.decision.engineVersion,
            verdict: prediction.decision.verdict,
            action: prediction.decision.action,
            confidence: prediction.decision.confidence,
            risk: prediction.decision.risk,
            decisionScore: prediction.decision.decisionScore,
            recommendedSelection: prediction.decision.recommendedSelection,
            summary: prediction.decision.summary,
            health: prediction.decision.health,
            calibration: prediction.decision.calibration,
            factors: prediction.decision.factors,
            contradictionChecks: prediction.decision.contradictionChecks,
            sensitivityChecks: prediction.decision.sensitivityChecks,
            abstentionRules: prediction.decision.abstentionRules,
            evidence: prediction.decision.evidence,
            risks: prediction.decision.risks,
            avoidReasons: prediction.decision.avoidReasons,
            saferAlternatives: prediction.decision.saferAlternatives,
            missingSignals: prediction.decision.missingSignals,
            nextChecks: prediction.decision.nextChecks,
            dataCoverage: prediction.decision.dataCoverage,
            oddsIntelligence: prediction.decision.oddsIntelligence,
            marketMovement: prediction.decision.marketMovement,
            historicalDiscipline: prediction.decision.historicalDiscipline,
            robustness: prediction.decision.robustness,
            uncertainty: prediction.decision.uncertainty,
            decisionBoundary: prediction.decision.decisionBoundary,
            probabilityTrace: prediction.decision.probabilityTrace,
            committee: prediction.decision.committee,
            deliberation: prediction.decision.deliberation,
            actionability: prediction.decision.actionability,
            monitoringPlan: prediction.decision.monitoringPlan,
            publicReasoningSteps: prediction.decision.publicReasoningSteps
          }
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "OddsPadiAiDecisionAgentReview",
        strict: true,
        schema: aiAgentReviewSchema
      }
    },
    max_output_tokens: 4800
  };
}

function resultWithStatus({
  status,
  decision,
  reason,
  model,
  fallbackReview
}: {
  status: DecisionAiAgentStatus;
  decision: DecisionEngineReport;
  reason?: string;
  model?: string;
  fallbackReview?: DecisionAiAgentReview;
}): DecisionAiAgentResult {
  const reviewedDecision = fallbackReview
    ? applyAiAgentReviewToDecision({
        decision,
        review: fallbackReview,
        model: model ?? "deterministic-fallback",
        reviewSource: "deterministic-fallback"
      })
    : null;
  const decisionWithStatus = reviewedDecision
    ? {
        ...reviewedDecision,
        llmEnhanced: decision.llmEnhanced,
        llmStatus: status === "not-configured" ? ("not-configured" as const) : status === "invalid-response" ? ("invalid-response" as const) : ("provider-error" as const),
        llmFailureReason: reason ?? decision.llmFailureReason,
        aiAgentStatus: agentStatusForDecision(status),
        aiAgentModel: model ?? "deterministic-fallback",
        aiProtocol: {
          ...reviewedDecision.aiProtocol,
          mode: "deterministic-public-audit" as const,
          summary: `${decision.aiProtocol.summary} Deterministic fallback AI audit completed because OpenAI review was unavailable.`
        },
        toolExecution: {
          ...reviewedDecision.toolExecution,
          mode: "deterministic-local-audit" as const,
          publicLog: [
            ...reviewedDecision.toolExecution.publicLog,
            `Deterministic fallback AI audit used supplied evidence only; provider status ${status}.`
          ].slice(0, 10)
        },
        publicReasoningSteps: [
          ...reviewedDecision.publicReasoningSteps,
          `Deterministic fallback AI audit preserved provider status ${status}: ${reason ?? "no provider reason supplied"}.`
        ]
      }
    : {
        ...decision,
        aiAgentStatus: agentStatusForDecision(status),
        aiAgentModel: model,
        llmFailureReason: reason ?? decision.llmFailureReason
      };

  return {
    requested: true,
    provider: status === "not-configured" ? "deterministic" : "openai",
    status,
    model,
    review: fallbackReview ?? null,
    decision: decisionWithStatus,
    reason
  };
}

export async function runOpenAIDecisionAgentReview({
  match,
  prediction,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  fetchImpl = fetch
}: {
  match: Match;
  prediction: Prediction;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<DecisionAiAgentResult> {
  if (!apiKey) {
    const reason = "OPENAI_API_KEY is not configured.";
    return resultWithStatus({
      status: "not-configured",
      decision: prediction.decision,
      reason,
      fallbackReview: buildDeterministicAiAgentFallbackReview({ decision: prediction.decision, reason })
    });
  }

  const payload = buildOpenAIDecisionAgentPayload({ match, prediction, model });

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(90_000)
    });

    if (!response.ok) {
      const providerError = await readDecisionOpenAIProviderError(response);
      const reason = providerError.reason;
      return resultWithStatus({
        status: "provider-error",
        decision: prediction.decision,
        model,
        reason,
        fallbackReview: buildDeterministicAiAgentFallbackReview({ decision: prediction.decision, reason })
      });
    }

    const responseJson = (await response.json()) as unknown;
    const outputText = extractOutputText(responseJson);
    if (!outputText) {
      const reason = "OpenAI response did not include output text.";
      return resultWithStatus({
        status: "invalid-response",
        decision: prediction.decision,
        model,
        reason,
        fallbackReview: buildDeterministicAiAgentFallbackReview({ decision: prediction.decision, reason })
      });
    }

    const review = safeParseAiAgentReview(outputText);
    if (!review) {
      const reason = `OpenAI response did not match the AI decision-agent review schema: ${diagnoseAiAgentReview(outputText)}; ${responseCompletionDiagnostic(responseJson)}.`;
      return resultWithStatus({
        status: "invalid-response",
        decision: prediction.decision,
        model,
        reason,
        fallbackReview: buildDeterministicAiAgentFallbackReview({ decision: prediction.decision, reason })
      });
    }

    return {
      requested: true,
      provider: "openai",
      status: "reviewed",
      model,
      review,
      decision: applyAiAgentReviewToDecision({ decision: prediction.decision, review, model })
    };
  } catch {
    const reason = "OpenAI decision-agent review failed before a valid response was received.";
    return resultWithStatus({
      status: "provider-error",
      decision: prediction.decision,
      model,
      reason,
      fallbackReview: buildDeterministicAiAgentFallbackReview({ decision: prediction.decision, reason })
    });
  }
}
