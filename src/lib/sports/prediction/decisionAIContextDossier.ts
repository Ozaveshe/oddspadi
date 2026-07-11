import type { DecisionAICognitiveLoop } from "@/lib/sports/prediction/decisionAICognitiveLoop";
import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionFeatureMatrix, DecisionFeatureRow } from "@/lib/sports/prediction/decisionFeatureMatrix";
import type { DecisionModelEnsemble } from "@/lib/sports/prediction/decisionModelEnsemble";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { readDecisionOpenAIProviderError } from "@/lib/sports/prediction/decisionOpenAIProviderError";
import type { Match, Prediction, Sport } from "@/lib/sports/types";
import { extractOutputText } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionAIContextDossierStatus = "ready-for-review" | "needs-evidence" | "blocked" | "no-target";
export type DecisionAIContextEvidenceStatus = "support" | "watch" | "block";
export type DecisionAIContextQuestionStatus = "answered" | "needs-data" | "blocked";
export type DecisionAIContextDossierRunStatus = "not-requested" | "not-configured" | "reviewed" | "provider-error" | "invalid-response";
export type DecisionAIContextDossierProvider = "openai" | "deterministic";
export type DecisionAIContextReviewVerdict = "agree" | "downgrade" | "needs-evidence" | "block";
export type DecisionAIContextFindingStatus = "supports" | "challenges" | "missing";
export type DecisionAIContextSafetyGateStatus = "pass" | "watch" | "block";

export type DecisionAIContextEvidence = {
  id: string;
  label: string;
  source: string;
  status: DecisionAIContextEvidenceStatus;
  weight: number;
  detail: string;
};

export type DecisionAIContextQuestion = {
  id: string;
  prompt: string;
  status: DecisionAIContextQuestionStatus;
  answer: string;
  evidenceIds: string[];
};

export type DecisionAIContextEvidenceFinding = {
  evidenceId: string;
  status: DecisionAIContextFindingStatus;
  finding: string;
};

export type DecisionAIContextSafetyGate = {
  id: string;
  status: DecisionAIContextSafetyGateStatus;
  reason: string;
};

export type DecisionAIContextDossierReview = {
  reviewVerdict: DecisionAIContextReviewVerdict;
  summary: string;
  evidenceFindings: DecisionAIContextEvidenceFinding[];
  missingData: string[];
  riskFlags: string[];
  nextSafeAction: string;
  safetyGates: DecisionAIContextSafetyGate[];
  unsupportedClaims: string[];
  publishPermission: "never";
  persistencePermission: "never";
  trainingPermission: "never";
};

export type DecisionAIContextDossier = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "ai-context-dossier";
  status: DecisionAIContextDossierStatus;
  dossierHash: string;
  summary: string;
  target: {
    matchId: string | null;
    match: string | null;
    league: string | null;
    kickoffTime: string | null;
    selection: string | null;
    action: Prediction["decision"]["action"] | null;
    verdict: Prediction["decision"]["verdict"] | null;
    health: Prediction["decision"]["health"] | null;
  };
  modelContext: {
    modelVersion: string | null;
    expectedScore: string | null;
    topOutcome: string | null;
    baseProbability: number | null;
    posteriorProbability: number | null;
    marketProbability: number | null;
    valueEdge: number | null;
    expectedValue: number | null;
    decisionScore: number | null;
    uncertaintyScore: number | null;
  };
  marketContext: {
    status: string | null;
    totalMarkets: number;
    totalSelections: number;
    actionableSelections: number;
    averageBookmakerMargin: number | null;
    bestSelection: string | null;
    marketMovement: string | null;
  };
  dataContext: {
    coverageScore: number;
    providerBackedSignals: number;
    computedSignals: number;
    mockSignals: number;
    missingSignals: number;
    staleSignals: number;
    nextProviderTask: string | null;
    missingEnv: string[];
  };
  trainingContext: {
    matrixStatus: DecisionFeatureMatrix["status"];
    trainingReadyScore: number;
    topFeatureRow: string | null;
    governanceStatus: DecisionModelGovernance["status"];
    governanceTrustScore: number;
    realFinishedFixtures: number;
    minimumRecommendedFixtures: number;
    learnedGuardrailsAllowed: boolean;
  };
  agentContext: {
    ensembleStatus: DecisionModelEnsemble["status"];
    ensembleAction: string | null;
    cognitiveStatus: DecisionAICognitiveLoop["status"] | null;
    nextOperation: string | null;
    safeToRunReadOnly: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
  };
  aiReadiness: {
    score: number;
    modelConfigured: boolean;
    canSubmitToOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    blockers: string[];
  };
  evidence: DecisionAIContextEvidence[];
  questions: DecisionAIContextQuestion[];
  requestPreview: ReturnType<typeof buildOpenAIContextDossierPayload>;
  deterministicFallback: DecisionAIContextDossierReview;
  review: DecisionAIContextDossierReview | null;
  latestRun: {
    requested: boolean;
    provider: DecisionAIContextDossierProvider;
    status: DecisionAIContextDossierRunStatus;
    model: string | null;
    reviewHash: string | null;
    reason: string | null;
    safeNoPersistence: true;
  };
  proofUrls: string[];
};

type DecisionAIContextDossierPayloadInput = Omit<DecisionAIContextDossier, "requestPreview" | "deterministicFallback" | "review" | "latestRun">;

const aiContextDossierReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: ["agree", "downgrade", "needs-evidence", "block"] },
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
    missingData: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
    nextSafeAction: { type: "string" },
    safetyGates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["pass", "watch", "block"] },
          reason: { type: "string" }
        },
        required: ["id", "status", "reason"]
      }
    },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    publishPermission: { type: "string", enum: ["never"] },
    persistencePermission: { type: "string", enum: ["never"] },
    trainingPermission: { type: "string", enum: ["never"] }
  },
  required: [
    "reviewVerdict",
    "summary",
    "evidenceFindings",
    "missingData",
    "riskFlags",
    "nextSafeAction",
    "safetyGates",
    "unsupportedClaims",
    "publishPermission",
    "persistencePermission",
    "trainingPermission"
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

function boundedText(value: unknown, maxLength = 360): string {
  return typeof value === "string" ? compact(value, maxLength) : "";
}

function boundedList(value: unknown, maxItems: number, maxLength = 260): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item, maxLength)).filter(Boolean).slice(0, maxItems);
}

function isReviewVerdict(value: unknown): value is DecisionAIContextReviewVerdict {
  return value === "agree" || value === "downgrade" || value === "needs-evidence" || value === "block";
}

function isFindingStatus(value: unknown): value is DecisionAIContextFindingStatus {
  return value === "supports" || value === "challenges" || value === "missing";
}

function isSafetyGateStatus(value: unknown): value is DecisionAIContextSafetyGateStatus {
  return value === "pass" || value === "watch" || value === "block";
}

function normalizeEvidenceFindings(value: unknown): DecisionAIContextEvidenceFinding[] {
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
    .filter((item): item is DecisionAIContextEvidenceFinding => Boolean(item))
    .slice(0, 12);
}

function normalizeSafetyGates(value: unknown): DecisionAIContextSafetyGate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const status = isSafetyGateStatus(record.status) ? record.status : null;
      const reason = boundedText(record.reason, 420);
      if (!status || !reason) return null;
      return {
        id: boundedText(record.id, 100) || `ai-context-gate-${index + 1}`,
        status,
        reason
      };
    })
    .filter((item): item is DecisionAIContextSafetyGate => Boolean(item))
    .slice(0, 8);
}

export function safeParseAIContextDossierReview(text: string): DecisionAIContextDossierReview | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isReviewVerdict(parsed.reviewVerdict)) return null;
    if (parsed.publishPermission !== "never" || parsed.persistencePermission !== "never" || parsed.trainingPermission !== "never") return null;

    const summary = boundedText(parsed.summary, 620);
    const nextSafeAction = boundedText(parsed.nextSafeAction, 360);
    const evidenceFindings = normalizeEvidenceFindings(parsed.evidenceFindings);
    const safetyGates = normalizeSafetyGates(parsed.safetyGates);
    if (!summary || !nextSafeAction || !evidenceFindings.length || !safetyGates.length) return null;

    return {
      reviewVerdict: parsed.reviewVerdict,
      summary,
      evidenceFindings,
      missingData: boundedList(parsed.missingData, 8),
      riskFlags: boundedList(parsed.riskFlags, 8),
      nextSafeAction,
      safetyGates,
      unsupportedClaims: boundedList(parsed.unsupportedClaims, 8),
      publishPermission: "never",
      persistencePermission: "never",
      trainingPermission: "never"
    };
  } catch {
    return null;
  }
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function rowRank(row: DecisionRow): number {
  const bestPick = row.prediction.bestPick;
  const decision = row.prediction.decision;
  const value = bestPick.hasValue ? Math.max(0, bestPick.expectedValue) * 130 + Math.max(0, bestPick.edge) * 95 : 0;
  const action = decision.action === "consider" ? 100 : decision.action === "monitor" ? 45 : 0;
  return value + action + decision.decisionScore + row.match.dataQualityScore * 30;
}

function selectTarget(rows: DecisionRow[], ensemble: DecisionModelEnsemble): DecisionRow | null {
  const ensembleTarget = ensemble.topCandidate ? rows.find((row) => row.match.id === ensemble.topCandidate?.matchId) : null;
  return ensembleTarget ?? rows.slice().sort((a, b) => rowRank(b) - rowRank(a))[0] ?? null;
}

function featureRowForTarget(matrix: DecisionFeatureMatrix, target: DecisionRow | null): DecisionFeatureRow | null {
  if (!target) return null;
  return matrix.rows.find((row) => row.matchId === target.match.id) ?? matrix.topRow;
}

function evidence(input: DecisionAIContextEvidence): DecisionAIContextEvidence {
  return {
    ...input,
    detail: compact(input.detail, 420),
    weight: round(clamp(input.weight, 0, 1), 3)
  };
}

function statusFor({
  target,
  governance,
  dataIntake,
  matrix
}: {
  target: DecisionRow | null;
  governance: DecisionModelGovernance;
  dataIntake: DecisionDataIntakeQueue;
  matrix: DecisionFeatureMatrix;
}): DecisionAIContextDossierStatus {
  if (!target) return "no-target";
  if (governance.status === "blocked" || dataIntake.status === "blocked") return "blocked";
  if (matrix.status !== "ready" || target.prediction.decision.dataCoverage.requiredBeforeTrust.length) return "needs-evidence";
  return "ready-for-review";
}

function readinessScore({
  target,
  matrix,
  governance,
  dataIntake
}: {
  target: DecisionRow | null;
  matrix: DecisionFeatureMatrix;
  governance: DecisionModelGovernance;
  dataIntake: DecisionDataIntakeQueue;
}): number {
  if (!target) return 0;
  const decision = target.prediction.decision;
  const score =
    decision.decisionScore * 0.24 +
    decision.dataCoverage.score * 0.22 +
    decision.actionability.score * 0.16 +
    (100 - decision.uncertainty.score) * 0.14 +
    matrix.coverage.averageTrainingReadyScore * 0.12 +
    governance.trustScore * 0.12;
  const penalty =
    (dataIntake.status === "blocked" ? 16 : 0) +
    (governance.status === "blocked" ? 18 : 0) +
    (decision.controlPolicy.publishAllowed ? 0 : 8) +
    (target.prediction.bestPick.hasValue ? 0 : 10);
  return round(clamp(score - penalty, 0, 100), 1);
}

function buildEvidence({
  target,
  featureRow,
  matrix,
  governance,
  dataIntake,
  ensemble,
  cognitiveLoop
}: {
  target: DecisionRow | null;
  featureRow: DecisionFeatureRow | null;
  matrix: DecisionFeatureMatrix;
  governance: DecisionModelGovernance;
  dataIntake: DecisionDataIntakeQueue;
  ensemble: DecisionModelEnsemble;
  cognitiveLoop?: DecisionAICognitiveLoop | null;
}): DecisionAIContextEvidence[] {
  if (!target) {
    return [
      evidence({
        id: "no-target",
        label: "No target decision",
        source: "decision-slate",
        status: "block",
        weight: 1,
        detail: "No prediction row is available for the AI dossier."
      })
    ];
  }

  const decision = target.prediction.decision;
  const bestPick = target.prediction.bestPick;
  const ensembleTarget = ensemble.candidates.find((candidate) => candidate.matchId === target.match.id) ?? ensemble.topCandidate;

  return [
    evidence({
      id: "model-probability",
      label: "Model probability",
      source: target.prediction.diagnostics.modelVersion,
      status: bestPick.hasValue || decision.beliefState.believedProbability !== null ? "support" : "watch",
      weight: 0.95,
      detail: `${decision.summary} Expected score: ${target.prediction.diagnostics.expectedScoreLabel ?? "not supplied"}.`
    }),
    evidence({
      id: "market-value",
      label: "Odds value",
      source: "odds-intelligence",
      status: bestPick.hasValue && bestPick.edge > 0 && bestPick.expectedValue > 0 ? "support" : "watch",
      weight: 0.94,
      detail: bestPick.hasValue
        ? `${bestPick.label}: model ${bestPick.modelProbability}, no-vig ${bestPick.noVigImpliedProbability}, edge ${bestPick.edge}, EV ${bestPick.expectedValue}, odds ${bestPick.odds}.`
        : decision.oddsIntelligence.summary
    }),
    evidence({
      id: "posterior-belief",
      label: "Posterior belief",
      source: "probability-trace",
      status: decision.probabilityTrace.status === "blocked" ? "block" : decision.probabilityTrace.status === "watchlist" ? "watch" : "support",
      weight: 0.88,
      detail: decision.probabilityTrace.summary
    }),
    evidence({
      id: "data-coverage",
      label: "Data coverage",
      source: "data-coverage-audit",
      status: decision.dataCoverage.requiredBeforeTrust.length ? "block" : decision.dataCoverage.score >= 74 ? "support" : "watch",
      weight: 1,
      detail: `${decision.dataCoverage.summary} Required before trust: ${decision.dataCoverage.requiredBeforeTrust.slice(0, 4).join("; ") || "none"}.`
    }),
    evidence({
      id: "context-adjustment",
      label: "Context adjustment",
      source: "context-adjustment",
      status: target.prediction.contextAdjustment.missingSignals.length ? "watch" : "support",
      weight: 0.82,
      detail: `${target.prediction.contextAdjustment.summary} Missing: ${target.prediction.contextAdjustment.missingSignals.slice(0, 4).join("; ") || "none"}.`
    }),
    evidence({
      id: "feature-vector",
      label: "Feature vector",
      source: "feature-matrix",
      status: featureRow && featureRow.trainingReadyScore >= 70 && featureRow.mockFeatures === 0 ? "support" : "watch",
      weight: 0.78,
      detail: featureRow
        ? `${featureRow.trainingReadyFeatures}/${featureRow.totalFeatures} training-ready features; completeness ${featureRow.completenessScore}%; blockers ${featureRow.blockers.slice(0, 3).join("; ") || "none"}.`
        : matrix.summary
    }),
    evidence({
      id: "model-governance",
      label: "Model governance",
      source: "model-governance",
      status: governance.status === "approved" ? "support" : governance.status === "shadow" ? "watch" : "block",
      weight: 0.92,
      detail: `${governance.summary} Next: ${governance.nextActions.slice(0, 3).join("; ") || "no action"}.`
    }),
    evidence({
      id: "ensemble-judges",
      label: "Model ensemble",
      source: "model-ensemble",
      status: ensembleTarget?.consensus === "blocked" ? "block" : ensembleTarget?.consensus === "split" ? "watch" : "support",
      weight: 0.84,
      detail: ensembleTarget
        ? `Consensus ${ensembleTarget.consensus}; base ${ensembleTarget.baseAction}; ensemble ${ensembleTarget.ensembleAction}; next check ${ensembleTarget.nextCheck}.`
        : ensemble.summary
    }),
    evidence({
      id: "data-intake-next",
      label: "Data intake next task",
      source: "data-intake",
      status: dataIntake.status === "blocked" ? "block" : dataIntake.status === "ready" ? "watch" : "support",
      weight: 0.9,
      detail: dataIntake.nextItem
        ? `${dataIntake.nextItem.label}: ${dataIntake.nextItem.decisionImpact} Missing env: ${dataIntake.nextItem.missingEnv.join(", ") || "none"}.`
        : dataIntake.summary
    }),
    evidence({
      id: "cognitive-loop",
      label: "AI cognitive loop",
      source: "ai-cognitive-loop",
      status: cognitiveLoop
        ? cognitiveLoop.status === "blocked" || cognitiveLoop.status === "repair"
          ? "block"
          : cognitiveLoop.status === "ready-shadow"
            ? "support"
            : "watch"
        : "watch",
      weight: 0.74,
      detail: cognitiveLoop
        ? `${cognitiveLoop.summary} Next operation: ${cognitiveLoop.nextOperation.label}; safe read-only ${cognitiveLoop.nextOperation.safeToRun}.`
        : "Cognitive loop was not supplied to this dossier route."
    })
  ];
}

function buildQuestions(evidenceItems: DecisionAIContextEvidence[], target: DecisionRow | null): DecisionAIContextQuestion[] {
  const evidenceStatus = (id: string) => evidenceItems.find((item) => item.id === id)?.status ?? "watch";
  const question = (input: DecisionAIContextQuestion): DecisionAIContextQuestion => input;
  const bestPick = target?.prediction.bestPick;

  return [
    question({
      id: "should-trust-model-market-edge",
      prompt: "Does the model-market disagreement survive no-vig odds, posterior belief, and EV checks?",
      status: evidenceStatus("market-value") === "support" && evidenceStatus("posterior-belief") !== "block" ? "answered" : "needs-data",
      answer: bestPick?.hasValue
        ? `${bestPick.label} has positive edge ${bestPick.edge} and EV ${bestPick.expectedValue}, subject to data and actionability gates.`
        : "No positive-value pick is strong enough to trust yet.",
      evidenceIds: ["market-value", "posterior-belief", "model-probability"]
    }),
    question({
      id: "what-blocks-public-action",
      prompt: "What prevents the AI from publishing, persisting, training, or upgrading this decision?",
      status: evidenceStatus("data-coverage") === "block" || evidenceStatus("model-governance") === "block" ? "blocked" : "answered",
      answer: target
        ? unique([...target.prediction.decision.controlPolicy.forbiddenActions, ...target.prediction.decision.actionability.requiredBeforeAction], 5).join("; ")
        : "No target decision exists.",
      evidenceIds: ["data-coverage", "model-governance", "cognitive-loop"]
    }),
    question({
      id: "what-data-is-needed-next",
      prompt: "Which provider or proof task should run next to make the decision more real?",
      status: evidenceStatus("data-intake-next") === "block" ? "blocked" : "needs-data",
      answer: evidenceItems.find((item) => item.id === "data-intake-next")?.detail ?? "No provider task is available.",
      evidenceIds: ["data-intake-next", "feature-vector", "model-governance"]
    })
  ];
}

function summaryFor(status: DecisionAIContextDossierStatus, target: DecisionRow | null, score: number): string {
  if (status === "no-target") return "AI context dossier cannot choose a target because the slate has no prediction rows.";
  const label = target ? matchLabel(target.match) : "the active target";
  if (status === "blocked") return `AI context dossier blocks ${label}; readiness is ${score}/100 and hard data or governance gates remain closed.`;
  if (status === "needs-evidence") return `AI context dossier is reviewable for ${label}, but needs stronger provider/training evidence before trust can rise.`;
  return `AI context dossier is ready for bounded model review on ${label}; side effects remain locked.`;
}

function deterministicVerdict(dossier: DecisionAIContextDossierPayloadInput): DecisionAIContextReviewVerdict {
  if (dossier.status === "no-target" || dossier.status === "blocked") return "block";
  if (dossier.status === "needs-evidence" || dossier.evidence.some((item) => item.status === "watch")) return "needs-evidence";
  return "agree";
}

function deterministicFindingStatus(status: DecisionAIContextEvidenceStatus): DecisionAIContextFindingStatus {
  if (status === "support") return "supports";
  if (status === "block") return "missing";
  return "challenges";
}

function deterministicReviewSummary(dossier: DecisionAIContextDossierPayloadInput, verdict: DecisionAIContextReviewVerdict): string {
  if (verdict === "agree") return `Deterministic context review agrees ${dossier.target.match ?? "the target"} is ready for bounded AI review, but not for writes.`;
  if (verdict === "needs-evidence") return `Deterministic context review holds ${dossier.target.match ?? "the target"} until watch evidence is refreshed.`;
  return `Deterministic context review blocks ${dossier.target.match ?? "the target"} because hard data, governance, or target gates remain closed.`;
}

function deterministicContextReview(dossier: DecisionAIContextDossierPayloadInput): DecisionAIContextDossierReview {
  const verdict = deterministicVerdict(dossier);
  const blockingEvidence = dossier.evidence.filter((item) => item.status === "block");
  const watchEvidence = dossier.evidence.filter((item) => item.status === "watch");

  return {
    reviewVerdict: verdict,
    summary: deterministicReviewSummary(dossier, verdict),
    evidenceFindings: dossier.evidence.slice(0, 8).map((item) => ({
      evidenceId: item.id,
      status: deterministicFindingStatus(item.status),
      finding: `${item.label}: ${item.detail}`
    })),
    missingData: unique(
      [
        ...dossier.dataContext.missingEnv.map((key) => `Missing env ${key}`),
        ...blockingEvidence.map((item) => item.label),
        ...watchEvidence.slice(0, 4).map((item) => `${item.label} still needs stronger evidence`)
      ],
      10
    ),
    riskFlags: unique([...dossier.aiReadiness.blockers, ...blockingEvidence.map((item) => item.detail)], 10),
    nextSafeAction:
      dossier.dataContext.nextProviderTask ??
      dossier.agentContext.nextOperation ??
      (verdict === "agree" ? "Run the configured OpenAI review without persistence." : "Collect provider evidence before trusting the dossier."),
    safetyGates: [
      {
        id: "no-publish",
        status: "pass",
        reason: "The dossier review cannot publish picks or upgrade public action."
      },
      {
        id: "no-persistence",
        status: "pass",
        reason: "The dossier review cannot persist memory or decision state."
      },
      {
        id: "no-training",
        status: "pass",
        reason: "The dossier review cannot train or activate learned guardrails."
      },
      {
        id: "evidence-state",
        status: blockingEvidence.length ? "block" : watchEvidence.length ? "watch" : "pass",
        reason: blockingEvidence[0]?.detail ?? watchEvidence[0]?.detail ?? "All dossier evidence rows are supportive."
      }
    ],
    unsupportedClaims: [],
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never"
  };
}

function sanitizeReview(review: DecisionAIContextDossierReview, allowedEvidenceIds: Set<string>): DecisionAIContextDossierReview {
  return {
    ...review,
    evidenceFindings: review.evidenceFindings
      .filter((finding) => allowedEvidenceIds.has(finding.evidenceId))
      .slice(0, 12),
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never"
  };
}

export function buildOpenAIContextDossierPayload({
  model,
  dossier
}: {
  model: string;
  dossier: DecisionAIContextDossierPayloadInput;
}) {
  const userPayload = {
    date: dossier.date,
    sport: dossier.sport,
    status: dossier.status,
    target: dossier.target,
    modelContext: dossier.modelContext,
    marketContext: dossier.marketContext,
    dataContext: dossier.dataContext,
    trainingContext: dossier.trainingContext,
    agentContext: dossier.agentContext,
    aiReadiness: dossier.aiReadiness,
    evidence: dossier.evidence,
    questions: dossier.questions,
    outputRules: {
      allowedEvidenceIds: dossier.evidence.map((item) => item.id),
      publicReasoningOnly: true,
      noPersistence: true,
      noPublishing: true,
      noTraining: true,
      noPublicActionUpgrade: true
    }
  };

  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system" as const,
        content:
          "You are OddsPadi's AI context reviewer. Use only the supplied dossier evidence. Return public reasoning only. Never invent sports data, publish, persist, train, stake, or upgrade a public action."
      },
      {
        role: "user" as const,
        content: JSON.stringify(userPayload)
      }
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "OddsPadiAIContextDossierReview",
        strict: true,
        schema: aiContextDossierReviewSchema
      }
    },
    max_output_tokens: 1400
  };
}

export function buildDecisionAIContextDossier({
  rows,
  date,
  sport,
  modelEnsemble,
  featureMatrix,
  modelGovernance,
  dataIntake,
  cognitiveLoop = null,
  env = process.env,
  model = getDecisionOpenAIModel(env),
  now = new Date()
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  modelEnsemble: DecisionModelEnsemble;
  featureMatrix: DecisionFeatureMatrix;
  modelGovernance: DecisionModelGovernance;
  dataIntake: DecisionDataIntakeQueue;
  cognitiveLoop?: DecisionAICognitiveLoop | null;
  env?: Record<string, string | undefined>;
  model?: string;
  now?: Date;
}): DecisionAIContextDossier {
  const target = selectTarget(rows, modelEnsemble);
  const featureRow = featureRowForTarget(featureMatrix, target);
  const status = statusFor({ target, governance: modelGovernance, dataIntake, matrix: featureMatrix });
  const score = readinessScore({ target, matrix: featureMatrix, governance: modelGovernance, dataIntake });
  const evidenceItems = buildEvidence({
    target,
    featureRow,
    matrix: featureMatrix,
    governance: modelGovernance,
    dataIntake,
    ensemble: modelEnsemble,
    cognitiveLoop
  });
  const questions = buildQuestions(evidenceItems, target);
  const bestPick = target?.prediction.bestPick;
  const decision = target?.prediction.decision;
  const missingEnv = unique([...(dataIntake.nextItem?.missingEnv ?? []), ...dataIntake.items.flatMap((item) => item.missingEnv)], 12);
  const blockers = unique(
    [
      ...evidenceItems.filter((item) => item.status === "block").map((item) => item.label),
      ...(decision?.actionability.blockers ?? []),
      ...(decision?.controlPolicy.gates.filter((gate) => gate.status === "block").map((gate) => gate.label) ?? [])
    ],
    10
  );
  const openAiConfigured = Boolean(env.OPENAI_API_KEY?.trim());
  const dossierBase: DecisionAIContextDossierPayloadInput = {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "ai-context-dossier",
    status,
    dossierHash: stableHash({
      date,
      sport,
      target: target?.match.id ?? null,
      status,
      score,
      evidence: evidenceItems.map((item) => [item.id, item.status]),
      questions: questions.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, target, score),
    target: {
      matchId: target?.match.id ?? null,
      match: target ? matchLabel(target.match) : null,
      league: target?.match.league.name ?? null,
      kickoffTime: target?.match.kickoffTime ?? null,
      selection: bestPick?.hasValue ? bestPick.label : (decision?.recommendedSelection ?? null),
      action: decision?.action ?? null,
      verdict: decision?.verdict ?? null,
      health: decision?.health ?? null
    },
    modelContext: {
      modelVersion: target?.prediction.diagnostics.modelVersion ?? null,
      expectedScore: target?.prediction.diagnostics.expectedScoreLabel ?? null,
      topOutcome: target?.prediction.diagnostics.topOutcomeLabel ?? null,
      baseProbability: decision?.beliefState.baseModelProbability ?? null,
      posteriorProbability: decision?.probabilityTrace.posteriorProbability ?? decision?.beliefState.believedProbability ?? null,
      marketProbability: bestPick?.hasValue ? bestPick.noVigImpliedProbability : (decision?.beliefState.marketImpliedProbability ?? null),
      valueEdge: bestPick?.hasValue ? bestPick.edge : (decision?.beliefState.probabilityEdge ?? null),
      expectedValue: bestPick?.hasValue ? bestPick.expectedValue : (decision?.beliefState.expectedValue ?? null),
      decisionScore: decision?.decisionScore ?? null,
      uncertaintyScore: decision?.uncertainty.score ?? null
    },
    marketContext: {
      status: decision?.oddsIntelligence.status ?? null,
      totalMarkets: decision?.oddsIntelligence.totalMarkets ?? 0,
      totalSelections: decision?.oddsIntelligence.totalSelections ?? 0,
      actionableSelections: decision?.oddsIntelligence.actionableSelections ?? 0,
      averageBookmakerMargin: decision?.oddsIntelligence.averageBookmakerMargin ?? null,
      bestSelection: bestPick?.hasValue ? `${bestPick.label} @ ${bestPick.odds}` : null,
      marketMovement: decision?.marketMovement.summary ?? null
    },
    dataContext: {
      coverageScore: decision?.dataCoverage.score ?? 0,
      providerBackedSignals: decision?.dataCoverage.providerBackedSignals ?? 0,
      computedSignals: decision?.dataCoverage.computedSignals ?? 0,
      mockSignals: decision?.dataCoverage.mockSignals ?? 0,
      missingSignals: decision?.dataCoverage.missingSignals ?? 0,
      staleSignals: decision?.dataCoverage.staleSignals ?? 0,
      nextProviderTask: dataIntake.nextItem?.label ?? null,
      missingEnv
    },
    trainingContext: {
      matrixStatus: featureMatrix.status,
      trainingReadyScore: featureRow?.trainingReadyScore ?? featureMatrix.coverage.averageTrainingReadyScore,
      topFeatureRow: featureRow?.match ?? null,
      governanceStatus: modelGovernance.status,
      governanceTrustScore: modelGovernance.trustScore,
      realFinishedFixtures: modelGovernance.trainingCorpus.realFinishedFixtures,
      minimumRecommendedFixtures: modelGovernance.trainingCorpus.minimumRecommendedFixtures,
      learnedGuardrailsAllowed: modelGovernance.learnedGuardrailsAllowed
    },
    agentContext: {
      ensembleStatus: modelEnsemble.status,
      ensembleAction: modelEnsemble.topCandidate?.ensembleAction ?? null,
      cognitiveStatus: cognitiveLoop?.status ?? null,
      nextOperation: cognitiveLoop?.nextOperation.label ?? null,
      safeToRunReadOnly: cognitiveLoop?.nextOperation.safeToRun ?? false,
      canPersist: false,
      canPublish: false,
      canTrain: false
    },
    aiReadiness: {
      score,
      modelConfigured: openAiConfigured,
      canSubmitToOpenAI: openAiConfigured && status !== "no-target",
      canPersist: false,
      canPublish: false,
      canTrain: false,
      blockers
    },
    evidence: evidenceItems,
    questions,
    proofUrls: unique(
      [
        "/api/sports/decision/ai-context-dossier",
        "/api/sports/decision/ai-cognitive-loop",
        "/api/sports/decision/model-ensemble",
        "/api/sports/decision/feature-matrix",
        "/api/sports/decision/model-governance",
        "/api/sports/decision/data-intake",
        cognitiveLoop?.nextOperation.verifyUrl
      ],
      20
    )
  };
  const deterministicFallback = deterministicContextReview(dossierBase);

  return {
    ...dossierBase,
    requestPreview: buildOpenAIContextDossierPayload({ model, dossier: dossierBase }),
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

function withReview({
  dossier,
  provider,
  status,
  review,
  model,
  reason = null
}: {
  dossier: DecisionAIContextDossier;
  provider: DecisionAIContextDossierProvider;
  status: DecisionAIContextDossierRunStatus;
  review: DecisionAIContextDossierReview;
  model: string | null;
  reason?: string | null;
}): DecisionAIContextDossier {
  const sanitized = sanitizeReview(review, new Set(dossier.evidence.map((item) => item.id)));
  const safeReview = sanitized.evidenceFindings.length ? sanitized : dossier.deterministicFallback;

  return {
    ...dossier,
    review: safeReview,
    latestRun: {
      requested: true,
      provider,
      status,
      model,
      reviewHash: stableHash(safeReview),
      reason,
      safeNoPersistence: true
    },
    aiReadiness: {
      ...dossier.aiReadiness,
      canPersist: false,
      canPublish: false,
      canTrain: false
    },
    agentContext: {
      ...dossier.agentContext,
      canPersist: false,
      canPublish: false,
      canTrain: false
    }
  };
}

export async function runDecisionAIContextDossierReview({
  rows,
  date,
  sport,
  modelEnsemble,
  featureMatrix,
  modelGovernance,
  dataIntake,
  cognitiveLoop = null,
  runRequested = false,
  apiKey = process.env.OPENAI_API_KEY,
  env = process.env,
  model = getDecisionOpenAIModel(),
  fetchImpl = fetch,
  now = new Date()
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  modelEnsemble: DecisionModelEnsemble;
  featureMatrix: DecisionFeatureMatrix;
  modelGovernance: DecisionModelGovernance;
  dataIntake: DecisionDataIntakeQueue;
  cognitiveLoop?: DecisionAICognitiveLoop | null;
  runRequested?: boolean;
  apiKey?: string;
  env?: Record<string, string | undefined>;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionAIContextDossier> {
  const dossier = buildDecisionAIContextDossier({
    rows,
    date,
    sport,
    modelEnsemble,
    featureMatrix,
    modelGovernance,
    dataIntake,
    cognitiveLoop,
    env: {
      ...env,
      OPENAI_API_KEY: apiKey
    },
    model,
    now
  });
  if (!runRequested) return dossier;

  if (!apiKey) {
    return withReview({
      dossier,
      provider: "deterministic",
      status: "not-configured",
      review: dossier.deterministicFallback,
      model: null,
      reason: "OPENAI_API_KEY is not configured."
    });
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(dossier.requestPreview)
    });

    if (!response.ok) {
      const providerError = await readDecisionOpenAIProviderError(response);
      return withReview({
        dossier,
        provider: "openai",
        status: "provider-error",
        review: dossier.deterministicFallback,
        model,
        reason: providerError.reason
      });
    }

    const outputText = extractOutputText((await response.json()) as unknown);
    if (!outputText) {
      return withReview({
        dossier,
        provider: "openai",
        status: "invalid-response",
        review: dossier.deterministicFallback,
        model,
        reason: "OpenAI response did not include output text."
      });
    }

    const parsed = safeParseAIContextDossierReview(outputText);
    if (!parsed) {
      return withReview({
        dossier,
        provider: "openai",
        status: "invalid-response",
        review: dossier.deterministicFallback,
        model,
        reason: "OpenAI response did not match the AI context dossier review schema."
      });
    }

    return withReview({
      dossier,
      provider: "openai",
      status: "reviewed",
      review: parsed,
      model
    });
  } catch {
    return withReview({
      dossier,
      provider: "openai",
      status: "provider-error",
      review: dossier.deterministicFallback,
      model,
      reason: "OpenAI context dossier review failed before a valid response was received."
    });
  }
}
