import type { DecisionBrainReviewRunner } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import type { DecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionEplPreKickoffRehearsal } from "@/lib/sports/prediction/decisionEplPreKickoffRehearsal";
import type { DecisionFinalAnswerTraceReceipt } from "@/lib/sports/prediction/decisionFinalAnswerTraceReceipt";
import type { DecisionHistoricalDisciplineReceipt } from "@/lib/sports/prediction/decisionHistoricalDisciplineReceipt";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionProviderBatchManifest } from "@/lib/sports/prediction/decisionProviderBatchManifest";
import type { DecisionRequirementPulse } from "@/lib/sports/prediction/decisionRequirementPulse";
import type { DecisionStorageActivationChecklist } from "@/lib/sports/prediction/decisionStorageActivationChecklist";
import type { DecisionSupabaseStorageProofLedger } from "@/lib/sports/prediction/decisionSupabaseStorageProofLedger";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import type { TenYearCorpusExecutionManifest } from "@/lib/sports/training/tenYearCorpusExecutionManifest";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpProgressStatus = "shipping-local" | "needs-live-data" | "needs-training" | "launch-blocked";
export type DecisionMvpProgressPhaseStatus = "done" | "current" | "blocked" | "locked";

export type DecisionMvpProgressPhase = {
  id:
    | "decision-workspace"
    | "model-odds-engine"
    | "market-calibration"
    | "ai-thinking"
    | "data-backbone"
    | "supabase-storage"
    | "provider-dry-runs"
    | "ten-year-corpus"
    | "epl-2026-rehearsal"
    | "public-launch";
  label: string;
  status: DecisionMvpProgressPhaseStatus;
  percent: number;
  evidence: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionMvpProgressReceipt = {
  mode: "decision-mvp-progress-receipt";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpProgressStatus;
  progressHash: string;
  summary: string;
  percentages: {
    technicalMvp: number;
    liveProductionMvp: number;
    dataReadiness: number;
    aiReadiness: number;
    publicLaunchReadiness: number;
  };
  counts: Record<DecisionMvpProgressPhaseStatus, number>;
  phases: DecisionMvpProgressPhase[];
  completed: string[];
  currentWork: string[];
  blockers: string[];
  epl2026: {
    tracked: true;
    season: string;
    competition: string;
    seasonStartDate: string;
    asOfDate: string;
    targetDate: string;
    daysUntilStart: number;
    openingFixtures: number;
    status: DecisionEplPreKickoffRehearsal["status"];
    nextAction: string;
  };
  diagnosticHistory: {
    attached: boolean;
    source: string | null;
    status: PublicHistoricalTrainingEvidence["status"] | null;
    seasons: string | null;
    fixtures: number;
    oddsRows: number;
    bookmakerMarkets: number;
    diagnosticScore: number;
    mvpCorpusPercent: number;
    dataReadinessPercent: number;
    benchmarkVerdict: PublicHistoricalTrainingEvidence["scorecard"]["benchmarkVerdict"] | null;
    canCreditDiagnosticProgress: boolean;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    nextAction: string;
    proofUrl: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunLiveAIReview: boolean;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
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

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(values: Array<string | null | undefined>, limit = 14): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function phase(input: DecisionMvpProgressPhase): DecisionMvpProgressPhase {
  return {
    ...input,
    percent: clamp(input.percent)
  };
}

function phaseCounts(phases: DecisionMvpProgressPhase[]): Record<DecisionMvpProgressPhaseStatus, number> {
  return {
    done: phases.filter((item) => item.status === "done").length,
    current: phases.filter((item) => item.status === "current").length,
    blocked: phases.filter((item) => item.status === "blocked").length,
    locked: phases.filter((item) => item.status === "locked").length
  };
}

function statusFromPhases(phases: DecisionMvpProgressPhase[]): DecisionMvpProgressStatus {
  if (phases.some((item) => item.id === "supabase-storage" && item.status === "blocked")) return "launch-blocked";
  if (phases.some((item) => item.id === "market-calibration" && item.status === "blocked")) return "needs-training";
  if (phases.some((item) => item.id === "ten-year-corpus" && item.status !== "done")) return "needs-training";
  if (phases.some((item) => item.id === "data-backbone" && item.status !== "done")) return "needs-live-data";
  return "shipping-local";
}

function requirementScore(requirementPulse: DecisionRequirementPulse, id: DecisionRequirementPulse["groups"][number]["id"]): number {
  return requirementPulse.groups.find((item) => item.id === id)?.score ?? 0;
}

function technicalPercent(phases: DecisionMvpProgressPhase[]): number {
  const weights: Record<DecisionMvpProgressPhase["id"], number> = {
    "decision-workspace": 12,
    "model-odds-engine": 14,
    "market-calibration": 8,
    "ai-thinking": 14,
    "data-backbone": 12,
    "supabase-storage": 10,
    "provider-dry-runs": 10,
    "ten-year-corpus": 12,
    "epl-2026-rehearsal": 6,
    "public-launch": 6
  };
  const weighted = phases.reduce((sum, item) => sum + item.percent * weights[item.id], 0);
  return clamp(weighted / 100);
}

function productionPercent(phases: DecisionMvpProgressPhase[]): number {
  const productionIds = new Set<DecisionMvpProgressPhase["id"]>([
    "data-backbone",
    "supabase-storage",
    "provider-dry-runs",
    "ten-year-corpus",
    "epl-2026-rehearsal",
    "public-launch"
  ]);
  const selected = phases.filter((item) => productionIds.has(item.id));
  return clamp(selected.reduce((sum, item) => sum + item.percent, 0) / Math.max(1, selected.length));
}

function summaryFor(status: DecisionMvpProgressStatus, percentages: DecisionMvpProgressReceipt["percentages"]): string {
  if (status === "shipping-local") return `Local technical MVP is ${percentages.technicalMvp}% complete; production launch remains ${percentages.liveProductionMvp}% until live data proof passes.`;
  if (status === "needs-live-data") return `Technical MVP is ${percentages.technicalMvp}% complete, but live production is ${percentages.liveProductionMvp}% because provider/storage proof is still missing.`;
  if (status === "needs-training") return `Technical MVP is ${percentages.technicalMvp}% complete; the main remaining work is the 10-year corpus, backtests, and training proof.`;
  return `MVP launch is blocked at ${percentages.liveProductionMvp}% live readiness until the current storage/provider blockers clear.`;
}

export function buildDecisionMvpProgressReceipt({
  date,
  sport,
  requirementPulse,
  dataBackbone,
  storageActivationChecklist,
  supabaseStorageProofLedger,
  providerBatchManifest,
  tenYearCorpusExecutionManifest,
  eplPreKickoffRehearsal,
  brainReviewRunner,
  openAiLiveReviewReceipt,
  finalAnswerTraceReceipt,
  answerPromotionGate,
  publicHistoricalTrainingEvidence = null,
  historicalDisciplineReceipt = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  requirementPulse: DecisionRequirementPulse;
  dataBackbone: DecisionDataBackbone;
  storageActivationChecklist: DecisionStorageActivationChecklist;
  supabaseStorageProofLedger?: DecisionSupabaseStorageProofLedger | null;
  providerBatchManifest: DecisionProviderBatchManifest;
  tenYearCorpusExecutionManifest: TenYearCorpusExecutionManifest;
  eplPreKickoffRehearsal: DecisionEplPreKickoffRehearsal;
  brainReviewRunner: DecisionBrainReviewRunner;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  finalAnswerTraceReceipt: DecisionFinalAnswerTraceReceipt;
  answerPromotionGate: DecisionAnswerPromotionGate;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  historicalDisciplineReceipt?: DecisionHistoricalDisciplineReceipt | null;
  now?: Date;
}): DecisionMvpProgressReceipt {
  const modelOddsPercent = clamp((requirementScore(requirementPulse, "prediction-engine") + requirementScore(requirementPulse, "odds-intelligence")) / 2);
  const marketCalibrationCheck = answerPromotionGate.checks.find((item) => item.id === "market-calibration") ?? null;
  const historicalDisciplineEnforced = historicalDisciplineReceipt?.status === "market-prior-enforced";
  const marketCalibrationPercent = marketCalibrationCheck?.status === "pass" ? 78 : historicalDisciplineEnforced ? 64 : marketCalibrationCheck?.status === "watch" ? 42 : 18;
  const containedStorageReady = Boolean(supabaseStorageProofLedger?.controls.canRunProviderDryRun);
  const storagePercent = clamp(Math.max(storageActivationChecklist.progress.storageReadiness, containedStorageReady ? 68 : 0));
  const providerPercent = clamp((providerBatchManifest.totals.dryRunReady / Math.max(1, providerBatchManifest.totals.batches)) * 100);
  const corpusPercent = clamp((tenYearCorpusExecutionManifest.totals.dryRunReadyJobs / Math.max(1, tenYearCorpusExecutionManifest.totals.competitions)) * 100);
  const publicHistoryCorpusPercent = publicHistoricalTrainingEvidence?.controls.canCreditMvpDiagnosticProgress
    ? publicHistoricalTrainingEvidence.contribution.mvpCorpusPercent
    : 0;
  const blendedCorpusPercent = clamp(Math.max(corpusPercent, publicHistoryCorpusPercent));
  const eplPercent = clamp(
    ((eplPreKickoffRehearsal.totals.readyReadOnly / Math.max(1, eplPreKickoffRehearsal.totals.openingFixtures)) * 55) +
      (eplPreKickoffRehearsal.totals.openingFixtures > 0 ? 20 : 0) +
      (eplPreKickoffRehearsal.controls.canRunFixtureDryRun || eplPreKickoffRehearsal.controls.canRunOddsDryRun ? 25 : 0)
  );
  const aiPercent = clamp(
    (historicalDisciplineEnforced ? 6 : 0) +
      (openAiLiveReviewReceipt.status === "reviewed" ? 45 : openAiLiveReviewReceipt.controls.canRequestLiveReview ? 32 : 12) +
      (brainReviewRunner.status === "reviewed" ? 35 : brainReviewRunner.controls.canRequestOpenAI ? 28 : 12) +
      (brainReviewRunner.controls.canApplyAI ? 0 : 8) +
      (openAiLiveReviewReceipt.controls.canPersist ? 0 : 8)
  );

  const phases = [
    phase({
      id: "decision-workspace",
      label: "Decision workspace",
      status: finalAnswerTraceReceipt.totals.steps >= 7 ? "done" : "current",
      percent: finalAnswerTraceReceipt.totals.steps >= 7 ? 82 : 50,
      evidence: `${finalAnswerTraceReceipt.totals.steps} final-answer trace step(s); ${finalAnswerTraceReceipt.totals.block} block step(s).`,
      nextAction: finalAnswerTraceReceipt.nextAction.label,
      proofUrl: "/api/sports/decision/final-answer-trace"
    }),
    phase({
      id: "model-odds-engine",
      label: "Model and odds engine",
      status: modelOddsPercent >= 70 ? "done" : modelOddsPercent >= 35 ? "current" : "blocked",
      percent: modelOddsPercent,
      evidence: `${requirementPulse.counts.ready} requirement group(s) ready; odds and model scores are derived from the requirement pulse.`,
      nextAction: requirementPulse.topGap?.nextAction ?? "Keep model, EV, risk, and safer-alternative checks attached to every slate.",
      proofUrl: "/api/sports/decision/requirement-pulse"
    }),
    phase({
      id: "market-calibration",
      label: "Market calibration",
      status: marketCalibrationCheck?.status === "pass" ? "done" : historicalDisciplineEnforced || marketCalibrationCheck?.status === "watch" ? "current" : "blocked",
      percent: marketCalibrationPercent,
      evidence: historicalDisciplineEnforced
        ? `${historicalDisciplineReceipt.summary} Market calibration remains promotion-blocking by design.`
        : marketCalibrationCheck
        ? `${marketCalibrationCheck.label} ${marketCalibrationCheck.status}: ${marketCalibrationCheck.detail}`
        : "Market-calibration check is missing from the answer-promotion gate.",
      nextAction:
        historicalDisciplineEnforced
          ? historicalDisciplineReceipt.nextAction.label
          : (marketCalibrationCheck?.requiredEvidence ??
            "Attach market-calibrated fusion to answer promotion before the MVP progress receipt can trust model value."),
      proofUrl: historicalDisciplineEnforced ? "/api/sports/decision/historical-discipline" : "/api/sports/decision/market-calibrated-fusion"
    }),
    phase({
      id: "ai-thinking",
      label: "AI thinking",
      status: openAiLiveReviewReceipt.status === "reviewed" || brainReviewRunner.status === "reviewed" ? "done" : aiPercent >= 45 ? "current" : "blocked",
      percent: aiPercent,
      evidence: `OpenAI live proof ${openAiLiveReviewReceipt.status}; brain runner ${brainReviewRunner.status}; side effects locked.`,
      nextAction: openAiLiveReviewReceipt.nextAction,
      proofUrl: "/api/sports/decision/brain-review-runner"
    }),
    phase({
      id: "data-backbone",
      label: "Data backbone",
      status: dataBackbone.status === "ready-provider-dry-run" ? "done" : dataBackbone.status.startsWith("blocked") ? "blocked" : "current",
      percent: dataBackbone.readinessScore,
      evidence: `${dataBackbone.totals.providerBackedRequirements} provider-backed, ${dataBackbone.totals.blockedRequiredSignals} blocked live signal(s).`,
      nextAction: dataBackbone.nextAction.label,
      proofUrl: "/api/sports/decision/data-backbone"
    }),
    phase({
      id: "supabase-storage",
      label: "Supabase storage",
      status:
        storageActivationChecklist.status === "ready-for-provider-dry-run" || supabaseStorageProofLedger?.status === "clean-storage-proof"
          ? "done"
          : containedStorageReady
            ? "current"
          : storageActivationChecklist.status === "blocked-cross-project" || storageActivationChecklist.status === "needs-credential"
            ? "blocked"
            : "current",
      percent: storagePercent,
      evidence: `${storageActivationChecklist.progress.liveTables}/${storageActivationChecklist.progress.expectedTables} live table(s); ${supabaseStorageProofLedger?.totals.foreignSignals ?? 0} foreign signal(s); score ${storagePercent}/100.`,
      nextAction: containedStorageReady ? supabaseStorageProofLedger?.nextAction.label ?? storageActivationChecklist.nextProbe.label : storageActivationChecklist.nextProbe.label,
      proofUrl: containedStorageReady ? "/api/sports/decision/supabase-storage-proof-ledger" : "/api/sports/decision/storage-activation-checklist"
    }),
    phase({
      id: "provider-dry-runs",
      label: "Provider dry-runs",
      status: providerBatchManifest.totals.dryRunReady > 0 ? "current" : providerBatchManifest.totals.needsEnv > 0 ? "blocked" : "locked",
      percent: providerPercent,
      evidence: `${providerBatchManifest.totals.dryRunReady}/${providerBatchManifest.totals.batches} provider batch(es) dry-run ready.`,
      nextAction: providerBatchManifest.nextCommand.label,
      proofUrl: "/api/sports/decision/provider-batch-manifest"
    }),
    phase({
      id: "ten-year-corpus",
      label: "10-year corpus",
      status:
        tenYearCorpusExecutionManifest.totals.dryRunReadyJobs > 0 || publicHistoryCorpusPercent > 0
          ? "current"
          : tenYearCorpusExecutionManifest.totals.needsEnvJobs > 0
            ? "blocked"
            : "locked",
      percent: blendedCorpusPercent,
      evidence: publicHistoricalTrainingEvidence
        ? `${tenYearCorpusExecutionManifest.totals.seasonJobs} season job(s), ${tenYearCorpusExecutionManifest.window.estimatedMatches} estimated match rows; public CSV ${publicHistoricalTrainingEvidence.scorecard.fixtures.toLocaleString()} fixtures and ${publicHistoricalTrainingEvidence.scorecard.oddsRows.toLocaleString()} odds rows (${publicHistoricalTrainingEvidence.status}).`
        : `${tenYearCorpusExecutionManifest.totals.seasonJobs} season job(s), ${tenYearCorpusExecutionManifest.window.estimatedMatches} estimated match rows.`,
      nextAction:
        publicHistoricalTrainingEvidence?.controls.canCreditMvpDiagnosticProgress && tenYearCorpusExecutionManifest.totals.dryRunReadyJobs === 0
          ? publicHistoricalTrainingEvidence.nextAction.label
          : tenYearCorpusExecutionManifest.nextJob?.label ?? "Inspect 10-year corpus execution.",
      proofUrl: publicHistoricalTrainingEvidence ? "/api/sports/decision/training/public-historical-training-evidence" : "/api/sports/decision/training/ten-year-corpus-execution"
    }),
    phase({
      id: "epl-2026-rehearsal",
      label: "2026/27 EPL readiness",
      status: eplPreKickoffRehearsal.status === "ready-read-only" ? "done" : eplPreKickoffRehearsal.status === "blocked-storage" ? "blocked" : "current",
      percent: eplPercent,
      evidence: `${eplPreKickoffRehearsal.totals.openingFixtures} opening fixture(s), ${eplPreKickoffRehearsal.totals.daysUntilStart} day(s) until start.`,
      nextAction: eplPreKickoffRehearsal.fixtures[0]?.nextAction.label ?? "Inspect EPL opening fixture rehearsal.",
      proofUrl: "/api/sports/decision/epl-pre-kickoff-rehearsal"
    }),
    phase({
      id: "public-launch",
      label: "Public launch",
      status: finalAnswerTraceReceipt.status === "valid-trace" && storageActivationChecklist.status === "ready-for-provider-dry-run" ? "current" : "locked",
      percent: finalAnswerTraceReceipt.status === "valid-trace" ? 35 : 10,
      evidence: `Final trace ${finalAnswerTraceReceipt.status}; publish, train, write, and stake remain locked.`,
      nextAction: finalAnswerTraceReceipt.nextAction.label,
      proofUrl: "/api/sports/decision/engine-activation-contract"
    })
  ];

  const percentages = {
    technicalMvp: technicalPercent(phases),
    liveProductionMvp: productionPercent(phases),
    dataReadiness: clamp((dataBackbone.readinessScore + storagePercent + providerPercent + blendedCorpusPercent) / 4),
    aiReadiness: aiPercent,
    publicLaunchReadiness: clamp(phases.find((item) => item.id === "public-launch")?.percent ?? 0)
  };
  const status = statusFromPhases(phases);
  const counts = phaseCounts(phases);
  const current = phases.filter((item) => item.status === "current");
  const blocked = phases.filter((item) => item.status === "blocked");

  return {
    mode: "decision-mvp-progress-receipt",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    progressHash: stableHash({
      date,
      sport,
      status,
      percentages,
      phases: phases.map((item) => [item.id, item.status, item.percent]),
      requirement: requirementPulse.pulseHash,
      promotion: answerPromotionGate.promotionHash,
      storage: storageActivationChecklist.checklistHash,
      storageLedger: supabaseStorageProofLedger?.ledgerHash ?? "not-attached",
      corpus: tenYearCorpusExecutionManifest.manifestHash,
      publicHistory: publicHistoricalTrainingEvidence?.evidenceHash ?? "not-attached",
      historicalDiscipline: historicalDisciplineReceipt?.disciplineHash ?? "not-attached"
    }),
    summary: summaryFor(status, percentages),
    percentages,
    counts,
    phases,
    completed: unique(phases.filter((item) => item.status === "done").map((item) => `${item.label}: ${item.evidence}`), 8),
    currentWork: unique((current.length ? current : phases.filter((item) => item.status === "locked")).map((item) => `${item.label}: ${item.nextAction}`), 8),
    blockers: unique(blocked.map((item) => `${item.label}: ${item.nextAction}`), 8),
    epl2026: {
      tracked: true,
      season: eplPreKickoffRehearsal.season.season,
      competition: eplPreKickoffRehearsal.season.competition,
      seasonStartDate: eplPreKickoffRehearsal.season.seasonStartDate,
      asOfDate: eplPreKickoffRehearsal.season.asOfDate,
      targetDate: eplPreKickoffRehearsal.season.targetDate,
      daysUntilStart: eplPreKickoffRehearsal.totals.daysUntilStart,
      openingFixtures: eplPreKickoffRehearsal.totals.openingFixtures,
      status: eplPreKickoffRehearsal.status,
      nextAction: eplPreKickoffRehearsal.fixtures[0]?.nextAction.label ?? eplPreKickoffRehearsal.summary
    },
    diagnosticHistory: {
      attached: Boolean(publicHistoricalTrainingEvidence),
      source: publicHistoricalTrainingEvidence?.source.label ?? null,
      status: publicHistoricalTrainingEvidence?.status ?? null,
      seasons: publicHistoricalTrainingEvidence?.source.seasons ?? null,
      fixtures: publicHistoricalTrainingEvidence?.scorecard.fixtures ?? 0,
      oddsRows: publicHistoricalTrainingEvidence?.scorecard.oddsRows ?? 0,
      bookmakerMarkets: publicHistoricalTrainingEvidence?.scorecard.bookmakerMarkets ?? 0,
      diagnosticScore: publicHistoricalTrainingEvidence?.diagnosticScore ?? 0,
      mvpCorpusPercent: publicHistoricalTrainingEvidence?.contribution.mvpCorpusPercent ?? 0,
      dataReadinessPercent: publicHistoricalTrainingEvidence?.contribution.dataReadinessPercent ?? 0,
      benchmarkVerdict: publicHistoricalTrainingEvidence?.scorecard.benchmarkVerdict ?? null,
      canCreditDiagnosticProgress: Boolean(publicHistoricalTrainingEvidence?.controls.canCreditMvpDiagnosticProgress),
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      nextAction:
        publicHistoricalTrainingEvidence?.nextAction.label ??
        "Attach public historical evidence with publicHistory=1, then compare diagnostic progress against provider-enriched corpus readiness.",
      proofUrl: publicHistoricalTrainingEvidence
        ? "/api/sports/decision/training/public-historical-training-evidence"
        : "/api/sports/decision/mvp-progress?publicHistory=1"
    },
    controls: {
      canInspectReadOnly: true,
      canRunLiveAIReview: openAiLiveReviewReceipt.controls.canRequestLiveReview || brainReviewRunner.controls.canRequestOpenAI,
      canRunProviderDryRun: providerBatchManifest.controls.canRunProviderDryRun || tenYearCorpusExecutionManifest.controls.canRunDryRun,
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-progress",
      "/api/sports/decision/requirement-pulse",
      "/api/sports/decision/training/supabase-training-corpus-census",
      "/api/sports/decision/training/first-corpus-import-queue",
      "/api/sports/decision/training/football-provider-fixture-feature-readiness",
      "/api/sports/decision/answer-promotion-gate",
      publicHistoricalTrainingEvidence ? "/api/sports/decision/training/public-historical-training-evidence" : null,
      ...answerPromotionGate.proofUrls,
      "/api/sports/decision/market-calibrated-fusion",
      historicalDisciplineReceipt ? "/api/sports/decision/historical-discipline" : null,
      "/api/sports/decision/data-backbone",
      "/api/sports/decision/storage-activation-checklist",
      "/api/sports/decision/supabase-storage-proof-ledger",
      "/api/sports/decision/provider-batch-manifest",
      "/api/sports/decision/training/ten-year-corpus-execution",
      "/api/sports/decision/epl-pre-kickoff-rehearsal",
      "/api/sports/decision/epl-provider-fixture-map",
      "/api/sports/decision/brain-review-runner",
      "/api/sports/decision/final-answer-trace"
    ], 80)
  };
}
