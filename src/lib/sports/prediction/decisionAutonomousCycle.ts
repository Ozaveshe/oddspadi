import type { DecisionAiAgentResult, DecisionAiAgentStatus, DecisionEngineReport, Match, Prediction, Sport } from "@/lib/sports/types";
import { getPredictions } from "@/lib/sports/service";
import {
  buildDecisionRunInputHash,
  findDecisionRunByInput,
  isVerifiedProviderDecisionMatch,
  persistDecisionRun,
  type DecisionPersistenceResult,
  type DecisionRunLookupResult
} from "@/lib/sports/prediction/decisionPersistence";
import { runOpenAIDecisionAgentReview } from "@/lib/sports/prediction/openaiDecisionAgent";
import { buildAutonomousPendingOutcome } from "@/lib/sports/prediction/decisionAutonomousOutcome";
import {
  storePredictionOutcome,
  type PredictionOutcomeWriteResult
} from "@/lib/sports/prediction/decisionOutcomes";

type PredictionRow = { match: Match; prediction: Prediction };

export type DecisionAutonomousCycleStatus = "preview" | "completed" | "partial" | "failed" | "no-fixtures" | "blocked";

export type DecisionAutonomousCycleItem = {
  fixtureId: string;
  fixtureProviderId: string | null;
  oddsProviderEventId: string | null;
  match: string;
  kickoffTime: string;
  status: Match["status"];
  dataQualityScore: number;
  evidenceHash: string;
  deterministic: {
    verdict: DecisionEngineReport["verdict"];
    action: DecisionEngineReport["action"];
    confidence: DecisionEngineReport["confidence"];
    risk: DecisionEngineReport["risk"];
    recommendedSelection: string | null;
  };
  final: {
    verdict: DecisionEngineReport["verdict"];
    action: DecisionEngineReport["action"];
    confidence: DecisionEngineReport["confidence"];
    risk: DecisionEngineReport["risk"];
    recommendedSelection: string | null;
    summary: string;
  };
  ai: {
    requested: boolean;
    provider: "openai" | "deterministic" | "stored";
    status: DecisionAiAgentStatus | "reused";
    model: string | null;
    reason: string | null;
  };
  persistence: DecisionPersistenceResult;
  outcome: PredictionOutcomeWriteResult | {
    status: "skipped";
    configured: boolean;
    table: "op_prediction_outcomes";
    reason: string;
  };
};

export type DecisionAutonomousCycle = {
  mode: "autonomous-decision-cycle";
  cycleId: string;
  generatedAt: string;
  status: DecisionAutonomousCycleStatus;
  summary: string;
  request: {
    date: string;
    sport: Sport;
    runRequested: boolean;
    adminAuthorized: boolean;
    runAi: boolean;
    persist: boolean;
    fixtureLimit: number;
    aiReviewLimit: number;
  };
  provider: {
    fixturesObserved: number;
    actionableFixtures: number;
    rejectedFallbackFixtures: number;
    fixtureProviders: string[];
    oddsProviders: string[];
  };
  counts: {
    selected: number;
    considered: number;
    monitored: number;
    avoided: number;
    aiReviewed: number;
    aiReused: number;
    aiFallbacks: number;
    persisted: number;
    reused: number;
    persistenceFailed: number;
    evidenceBundlesStored: number;
    evidenceBundlesReused: number;
    evidenceBundlesUnverified: number;
    evidenceBundlePendingMigration: number;
    evidenceBundleFailures: number;
    outcomesStored: number;
    outcomesReused: number;
    outcomeFailures: number;
  };
  decisions: DecisionAutonomousCycleItem[];
  controls: {
    deterministicModelIsAuthority: true;
    aiCanUpgradeDecision: false;
    providerEvidenceRequired: true;
    idempotentPersistence: true;
    immutableEvidenceRequired: true;
    learnedWeightsRemainShadowOnly: true;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: string;
};

export type DecisionAutonomousCycleDependencies = {
  getPredictions: typeof getPredictions;
  findDecisionRunByInput: typeof findDecisionRunByInput;
  runOpenAIDecisionAgentReview: typeof runOpenAIDecisionAgentReview;
  persistDecisionRun: typeof persistDecisionRun;
  storePredictionOutcome: typeof storePredictionOutcome;
};

const defaultDependencies: DecisionAutonomousCycleDependencies = {
  getPredictions,
  findDecisionRunByInput,
  runOpenAIDecisionAgentReview,
  persistDecisionRun,
  storePredictionOutcome
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

function clampInteger(value: number, fallback: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, value));
}

function verdictRank(verdict: DecisionEngineReport["verdict"]): number {
  if (verdict === "strong-value") return 5;
  if (verdict === "lean-value") return 4;
  if (verdict === "watchlist") return 3;
  if (verdict === "avoid") return 2;
  return 1;
}

function rankRows(rows: PredictionRow[]): PredictionRow[] {
  return rows.slice().sort((left, right) => {
    const verdictDifference = verdictRank(right.prediction.decision.verdict) - verdictRank(left.prediction.decision.verdict);
    if (verdictDifference) return verdictDifference;
    const rightEv = right.prediction.canonicalDecision.bestPublishedPick?.expectedValue ?? -1;
    const leftEv = left.prediction.canonicalDecision.bestPublishedPick?.expectedValue ?? -1;
    if (rightEv !== leftEv) return rightEv - leftEv;
    if (right.prediction.decision.decisionScore !== left.prediction.decision.decisionScore) {
      return right.prediction.decision.decisionScore - left.prediction.decision.decisionScore;
    }
    if (right.match.dataQualityScore !== left.match.dataQualityScore) return right.match.dataQualityScore - left.match.dataQualityScore;
    return new Date(left.match.kickoffTime).getTime() - new Date(right.match.kickoffTime).getTime();
  });
}

function skippedPersistence(reason: string): DecisionPersistenceResult {
  return { requested: false, status: "skipped", configured: false, table: "op_decision_runs", reason };
}

function reusedPersistence(runId: string, evidenceHash: string): DecisionPersistenceResult {
  return {
    requested: true,
    status: "reused",
    configured: true,
    table: "op_decision_runs",
    id: runId,
    reason: "The same fixture evidence and deterministic model state were already stored.",
    evidenceBundle: {
      status: "unverified",
      configured: true,
      table: "op_decision_evidence_bundles",
      evidenceHash,
      reason: "A reused decision has not been rechecked against an immutable evidence bundle in this cycle."
    }
  };
}

function summaryFor(status: DecisionAutonomousCycleStatus, counts: DecisionAutonomousCycle["counts"]): string {
  if (status === "blocked") return "Autonomous execution was blocked because the server-side admin authorization was not present.";
  if (status === "preview") return `Preview ranked ${counts.selected} fixture(s) without calling OpenAI or writing storage.`;
  if (status === "no-fixtures") return "No scheduled or live fixtures were available for this decision cycle.";
  if (status === "failed") return "The autonomous cycle could not persist any selected fixture decision.";
  if (status === "partial") {
    return `The cycle processed ${counts.selected} fixture(s), with ${counts.aiFallbacks} AI fallback(s), ${counts.persistenceFailed} decision-write failure(s), ${counts.evidenceBundlePendingMigration + counts.evidenceBundlesUnverified + counts.evidenceBundleFailures} immutable-evidence issue(s), and ${counts.outcomeFailures} outcome-write failure(s).`;
  }
  return `The cycle processed ${counts.selected} fixture(s), completed ${counts.aiReviewed} new AI review(s), reused ${counts.aiReused} prior review(s), and opened or reused ${counts.outcomesStored + counts.outcomesReused} shadow outcome(s).`;
}

function baseResult({
  date,
  sport,
  runRequested,
  adminAuthorized,
  runAi,
  persist,
  fixtureLimit,
  aiReviewLimit,
  status,
  generatedAt
}: {
  date: string;
  sport: Sport;
  runRequested: boolean;
  adminAuthorized: boolean;
  runAi: boolean;
  persist: boolean;
  fixtureLimit: number;
  aiReviewLimit: number;
  status: "blocked";
  generatedAt: string;
}): DecisionAutonomousCycle {
  const counts: DecisionAutonomousCycle["counts"] = {
    selected: 0,
    considered: 0,
    monitored: 0,
    avoided: 0,
    aiReviewed: 0,
    aiReused: 0,
    aiFallbacks: 0,
    persisted: 0,
    reused: 0,
    persistenceFailed: 0,
    evidenceBundlesStored: 0,
    evidenceBundlesReused: 0,
    evidenceBundlesUnverified: 0,
    evidenceBundlePendingMigration: 0,
    evidenceBundleFailures: 0,
    outcomesStored: 0,
    outcomesReused: 0,
    outcomeFailures: 0
  };
  return {
    mode: "autonomous-decision-cycle",
    cycleId: stableHash({ date, sport, generatedAt, status }),
    generatedAt,
    status,
    summary: summaryFor(status, counts),
    request: { date, sport, runRequested, adminAuthorized, runAi, persist, fixtureLimit, aiReviewLimit },
    provider: { fixturesObserved: 0, actionableFixtures: 0, rejectedFallbackFixtures: 0, fixtureProviders: [], oddsProviders: [] },
    counts,
    decisions: [],
    controls: {
      deterministicModelIsAuthority: true,
      aiCanUpgradeDecision: false,
      providerEvidenceRequired: true,
      idempotentPersistence: true,
      immutableEvidenceRequired: true,
      learnedWeightsRemainShadowOnly: true,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: "Retry through the authenticated POST endpoint."
  };
}

export async function runDecisionAutonomousCycle({
  date,
  sport = "football",
  runRequested = false,
  adminAuthorized = false,
  runAi = true,
  persist = true,
  fixtureLimit = 12,
  aiReviewLimit = 2,
  now = new Date(),
  dependencies = defaultDependencies
}: {
  date: string;
  sport?: Sport;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  runAi?: boolean;
  persist?: boolean;
  fixtureLimit?: number;
  aiReviewLimit?: number;
  now?: Date;
  dependencies?: DecisionAutonomousCycleDependencies;
}): Promise<DecisionAutonomousCycle> {
  const boundedFixtureLimit = clampInteger(fixtureLimit, 12, 1, 20);
  const boundedAiReviewLimit = clampInteger(aiReviewLimit, 2, 0, 3);
  const generatedAt = now.toISOString();
  if (runRequested && !adminAuthorized) {
    return baseResult({
      date,
      sport,
      runRequested,
      adminAuthorized,
      runAi,
      persist,
      fixtureLimit: boundedFixtureLimit,
      aiReviewLimit: boundedAiReviewLimit,
      status: "blocked",
      generatedAt
    });
  }

  const rows = await dependencies.getPredictions({
    date,
    sport,
    providerMode: "live",
    storageMode: "live",
    publicHistory: sport === "football"
  });
  const providerRows = rows.filter((row) => isVerifiedProviderDecisionMatch(row.match));
  const actionableRows = providerRows.filter((row) => row.match.status !== "finished");
  const selectedRows = rankRows(actionableRows).slice(0, boundedFixtureLimit);
  const decisions: DecisionAutonomousCycleItem[] = [];
  let aiCalls = 0;

  for (const row of selectedRows) {
    const evidenceHash = buildDecisionRunInputHash(row);
    const lookup: DecisionRunLookupResult = runRequested
      ? await dependencies.findDecisionRunByInput(row)
      : { status: "not-found" };
    const existing = lookup.status === "found" ? lookup.run : null;
    const canReuseAi = Boolean(existing?.llmEnhanced);
    const shouldRunAi = runRequested && runAi && !canReuseAi && aiCalls < boundedAiReviewLimit;

    let finalDecision = row.prediction.decision;
    let ai: DecisionAutonomousCycleItem["ai"] = {
      requested: false,
      provider: "deterministic",
      status: "not-requested",
      model: null,
      reason: runRequested ? "This fixture was outside the bounded AI review budget." : "Preview mode never calls OpenAI."
    };
    let aiAgentResult: DecisionAiAgentResult | null = null;

    if (canReuseAi && existing) {
      ai = {
        requested: true,
        provider: "stored",
        status: "reused",
        model: null,
        reason: "A grounded AI review already exists for the same evidence hash."
      };
    } else if (shouldRunAi) {
      aiCalls += 1;
      const review = await dependencies.runOpenAIDecisionAgentReview({ match: row.match, prediction: row.prediction });
      aiAgentResult = review;
      finalDecision = review.decision;
      ai = {
        requested: true,
        provider: review.provider,
        status: review.status,
        model: review.model ?? null,
        reason: review.reason ?? null
      };
    }

    let persistence = skippedPersistence(runRequested ? "Persistence was disabled for this cycle." : "Preview mode never writes storage.");
    if (runRequested && persist) {
      if (existing && (!shouldRunAi || canReuseAi)) {
        persistence = reusedPersistence(existing.id, evidenceHash);
      } else {
        persistence = await dependencies.persistDecisionRun({
          match: row.match,
          prediction: row.prediction,
          decision: finalDecision,
          aiAgent: aiAgentResult
        });
      }
    }

    const final = existing && canReuseAi
      ? {
          verdict: existing.verdict,
          action: existing.action,
          confidence: row.prediction.decision.confidence,
          risk: row.prediction.decision.risk,
          recommendedSelection: existing.recommendedSelection,
          summary: existing.summary
        }
      : {
          verdict: finalDecision.verdict,
          action: finalDecision.action,
          confidence: finalDecision.confidence,
          risk: finalDecision.risk,
          recommendedSelection: finalDecision.recommendedSelection,
          summary: finalDecision.summary
        };

    let outcome: DecisionAutonomousCycleItem["outcome"] = {
      status: "skipped",
      configured: false,
      table: "op_prediction_outcomes",
      reason: runRequested ? "No stored decision run was available for shadow outcome tracking." : "Preview mode never writes outcomes."
    };
    if (runRequested && persist && persistence.id && (persistence.status === "stored" || persistence.status === "reused")) {
      const pendingOutcome = buildAutonomousPendingOutcome({
        match: row.match,
        prediction: row.prediction,
        decisionRunId: persistence.id,
        evidenceHash,
        finalDecision: final
      });
      outcome = pendingOutcome
        ? await dependencies.storePredictionOutcome(pendingOutcome)
        : {
            status: "skipped",
            configured: true,
            table: "op_prediction_outcomes",
            reason: "No auditable model selection was available for shadow outcome tracking."
          };
    }

    decisions.push({
      fixtureId: row.match.id,
      fixtureProviderId: row.match.dataSource?.fixtureProviderId ?? null,
      oddsProviderEventId: row.match.dataSource?.oddsProviderEventId ?? null,
      match: `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`,
      kickoffTime: row.match.kickoffTime,
      status: row.match.status,
      dataQualityScore: row.match.dataQualityScore,
      evidenceHash,
      deterministic: {
        verdict: row.prediction.decision.verdict,
        action: row.prediction.decision.action,
        confidence: row.prediction.decision.confidence,
        risk: row.prediction.decision.risk,
        recommendedSelection: row.prediction.decision.recommendedSelection
      },
      final,
      ai,
      persistence,
      outcome
    });
  }

  const counts: DecisionAutonomousCycle["counts"] = {
    selected: decisions.length,
    considered: decisions.filter((item) => item.final.action === "consider").length,
    monitored: decisions.filter((item) => item.final.action === "monitor").length,
    avoided: decisions.filter((item) => item.final.action === "avoid").length,
    aiReviewed: decisions.filter((item) => item.ai.status === "reviewed").length,
    aiReused: decisions.filter((item) => item.ai.status === "reused").length,
    aiFallbacks: decisions.filter((item) => ["not-configured", "provider-error", "invalid-response"].includes(item.ai.status)).length,
    persisted: decisions.filter((item) => item.persistence.status === "stored").length,
    reused: decisions.filter((item) => item.persistence.status === "reused").length,
    persistenceFailed: decisions.filter((item) => item.persistence.status === "failed").length,
    evidenceBundlesStored: decisions.filter((item) => item.persistence.evidenceBundle?.status === "stored").length,
    evidenceBundlesReused: decisions.filter((item) => item.persistence.evidenceBundle?.status === "reused").length,
    evidenceBundlesUnverified: decisions.filter((item) => item.persistence.evidenceBundle?.status === "unverified").length,
    evidenceBundlePendingMigration: decisions.filter((item) => item.persistence.evidenceBundle?.status === "pending-migration").length,
    evidenceBundleFailures: decisions.filter((item) => item.persistence.evidenceBundle?.status === "failed").length,
    outcomesStored: decisions.filter((item) => item.outcome.status === "stored").length,
    outcomesReused: decisions.filter((item) => item.outcome.status === "reused").length,
    outcomeFailures: decisions.filter((item) => item.outcome.status === "failed" || item.outcome.status === "not-configured").length
  };

  let status: DecisionAutonomousCycleStatus;
  if (!selectedRows.length) status = "no-fixtures";
  else if (!runRequested) status = "preview";
  else if (persist && counts.persistenceFailed === selectedRows.length) status = "failed";
  else if (
    counts.persistenceFailed > 0 ||
    counts.outcomeFailures > 0 ||
    counts.aiFallbacks > 0 ||
    counts.evidenceBundlePendingMigration > 0 ||
    counts.evidenceBundlesUnverified > 0 ||
    counts.evidenceBundleFailures > 0
  ) status = "partial";
  else status = "completed";

  const fixtureProviders = Array.from(new Set(providerRows.map((row) => row.match.dataSource?.fixtureProvider).filter((value): value is string => Boolean(value))));
  const oddsProviders = Array.from(new Set(providerRows.map((row) => row.match.dataSource?.oddsProvider).filter((value): value is string => Boolean(value))));
  const cycleId = stableHash({ date, sport, evidenceHashes: decisions.map((item) => item.evidenceHash), runRequested });

  return {
    mode: "autonomous-decision-cycle",
    cycleId,
    generatedAt,
    status,
    summary: summaryFor(status, counts),
    request: {
      date,
      sport,
      runRequested,
      adminAuthorized,
      runAi: runRequested && runAi,
      persist: runRequested && persist,
      fixtureLimit: boundedFixtureLimit,
      aiReviewLimit: boundedAiReviewLimit
    },
    provider: {
      fixturesObserved: providerRows.length,
      actionableFixtures: actionableRows.length,
      rejectedFallbackFixtures: rows.length - providerRows.length,
      fixtureProviders,
      oddsProviders
    },
    counts,
    decisions,
    controls: {
      deterministicModelIsAuthority: true,
      aiCanUpgradeDecision: false,
      providerEvidenceRequired: true,
      idempotentPersistence: true,
      immutableEvidenceRequired: true,
      learnedWeightsRemainShadowOnly: true,
      canPublishPicks: false,
      canStake: false
    },
    nextAction:
      status === "preview"
        ? "Run the authenticated POST endpoint to execute bounded AI review and idempotent persistence."
        : status === "no-fixtures"
          ? "Wait for the next scheduled or live fixture window."
          : status === "partial" || status === "failed"
            ? "Inspect per-fixture AI and persistence receipts, then retry only after the failing dependency is healthy."
            : "Let the settlement scheduler attach final outcomes, then recompute calibration in shadow mode."
  };
}
