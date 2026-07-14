import { EPL_2026_OPENING_WINDOW, EPL_2026_SEASON } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import type { DecisionProviderEnvDiagnostic } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { ApiFootballEntitlementProbe } from "@/lib/sports/training/apiFootballEntitlementProbe";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { inspectRuntimeBacktestEvidence } from "@/lib/sports/training/runtimeBacktestEvidence";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpProgressSnapshotStatus = "local-mvp-ready" | "needs-provider-keys" | "needs-storage" | "needs-openai" | "needs-training";
export type DecisionMvpProgressSnapshotLaneStatus = "done" | "current" | "blocked" | "locked";

export type DecisionMvpProgressSnapshotLane = {
  id:
    | "models"
    | "odds"
    | "provider-data"
    | "openai-review"
    | "supabase-storage"
    | "training-corpus"
    | "public-history"
    | "epl-2026";
  label: string;
  status: DecisionMvpProgressSnapshotLaneStatus;
  percent: number;
  evidence: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionMvpProgressSnapshot = {
  mode: "decision-mvp-progress-snapshot";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpProgressSnapshotStatus;
  summary: string;
  percentages: {
    technicalMvp: number;
    liveProduction: number;
    dataReadiness: number;
    aiReadiness: number;
  };
  lanes: DecisionMvpProgressSnapshotLane[];
  completed: string[];
  blockers: string[];
  currentWork: string[];
  epl2026: {
    tracked: true;
    competition: typeof EPL_2026_SEASON.competition;
    season: typeof EPL_2026_SEASON.season;
    providerSeason: typeof EPL_2026_SEASON.providerSeason;
    fixtureReleaseDate: typeof EPL_2026_SEASON.fixtureReleaseDate;
    seasonStartDate: typeof EPL_2026_SEASON.seasonStartDate;
    finalMatchDate: typeof EPL_2026_SEASON.finalMatchDate;
    totalFixtures: typeof EPL_2026_SEASON.totalFixtures;
    openingWindowFixtures: number;
    openingFixture: string;
    daysUntilStart: number;
    sourceUrl: string;
    nextAction: string;
    entitlementStatus: ApiFootballEntitlementProbe["status"] | "not-attached";
    entitlementEvidence: string | null;
  };
  controls: {
    readOnly: true;
    canRunProviderDryRun: boolean;
    canRequestOpenAIReview: boolean;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
};

type DecisionRowLike = {
  prediction: {
    bestPick: {
      hasValue: boolean;
    };
    decision: {
      action: "consider" | "monitor" | "avoid";
    };
  };
};

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function dayDiff(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function lane(input: DecisionMvpProgressSnapshotLane): DecisionMvpProgressSnapshotLane {
  return {
    ...input,
    percent: clamp(input.percent)
  };
}

function statusFor(lanes: DecisionMvpProgressSnapshotLane[], readiness: DecisionEngineReadiness): DecisionMvpProgressSnapshotStatus {
  if (lanes.find((item) => item.id === "provider-data")?.status === "blocked") return "needs-provider-keys";
  if (lanes.find((item) => item.id === "supabase-storage")?.status === "blocked") return "needs-storage";
  if (readiness.openAi.status !== "ready") return "needs-openai";
  if (lanes.find((item) => item.id === "training-corpus")?.status !== "done") return "needs-training";
  return "local-mvp-ready";
}

function summaryFor(status: DecisionMvpProgressSnapshotStatus, percentages: DecisionMvpProgressSnapshot["percentages"]): string {
  if (status === "local-mvp-ready") return `Technical MVP is ${percentages.technicalMvp}% ready; live production is ${percentages.liveProduction}% while guarded launch controls remain on.`;
  if (status === "needs-provider-keys") return `Technical MVP is ${percentages.technicalMvp}% ready, but live production is ${percentages.liveProduction}% until sports and odds provider keys are configured.`;
  if (status === "needs-storage") return `Technical MVP is ${percentages.technicalMvp}% ready; Supabase storage proof is the next production blocker.`;
  if (status === "needs-openai") return `Technical MVP is ${percentages.technicalMvp}% ready; OpenAI review is not live yet, so AI reasoning stays deterministic and bounded.`;
  return `Technical MVP is ${percentages.technicalMvp}% ready; the remaining production work is the historical corpus, backtests, and learned-weight proof.`;
}

function weightedPercent(lanes: DecisionMvpProgressSnapshotLane[], weights: Record<DecisionMvpProgressSnapshotLane["id"], number>): number {
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const weighted = lanes.reduce((sum, item) => sum + item.percent * weights[item.id], 0);
  return clamp(weighted / Math.max(1, totalWeight));
}

function publicHistoryLaneStatus(evidence: PublicHistoricalTrainingEvidence | null | undefined): DecisionMvpProgressSnapshotLaneStatus {
  if (!evidence) return "current";
  if (evidence.status === "failed" || evidence.status === "insufficient-history") return "blocked";
  if (evidence.status === "provider-retest-ready" || evidence.status === "public-history-ready") return "done";
  return "current";
}

function publicHistoryNextAction(evidence: PublicHistoricalTrainingEvidence | null | undefined): string {
  if (!evidence) return "Run the public historical proof to credit the no-key EPL corpus in the fast progress snapshot.";
  if (evidence.status === "market-prior-dominant") return "Keep market prior dominant and queue provider-enriched retest before learned weights can matter.";
  if (evidence.status === "provider-retest-ready") return "Use provider keys to map fixture IDs, odds snapshots, and context features for the retest.";
  if (evidence.status === "failed" || evidence.status === "insufficient-history") return "Repair the public-history proof before using it as diagnostic AI evidence.";
  return evidence.nextAction.label;
}

function foreignSupabaseSchemaSignals(readiness: DecisionEngineReadiness): string[] {
  return readiness.supabase.schema.foreignSchemaSignals.filter((signal) => signal.status === "present").map((signal) => `${signal.table} (${signal.product})`);
}

function apiFootballEntitlementEvidence(probe: ApiFootballEntitlementProbe | null | undefined): string | null {
  if (!probe) return null;
  const current = probe.currentSeason;
  const reason = current.reason ? `: ${current.reason}` : "";
  const fallback =
    probe.totals.historicalAccessible > 0
      ? ` ${probe.totals.historicalAccessible} historical fallback season(s) accessible.`
      : " No historical fallback season passed in this probe.";
  return `API-Football entitlement ${probe.status}; 2026 EPL ${current.entitlementSignal}${reason}.${fallback}`;
}

function futureEplEntitlementBlocked(probe: ApiFootballEntitlementProbe | null | undefined): boolean {
  if (!probe) return false;
  return probe.status === "future-season-blocked" || probe.currentSeason.entitlementSignal === "plan-restricted";
}

function entitlementNextAction(probe: ApiFootballEntitlementProbe | null | undefined): string {
  if (!probe) return "Run the read-only API-Football entitlement probe before relying on 2026 EPL provider fixtures.";
  if (futureEplEntitlementBlocked(probe)) {
    return probe.nextAction || "Upgrade API-Football/APISports entitlement for 2026 EPL fixture access, then rerun the entitlement probe.";
  }
  if (probe.status === "historical-fallback-ready") return probe.nextAction;
  if (probe.status === "future-season-ready") return "Run EPL fixture map and odds/context dry-runs while writes stay locked.";
  return probe.nextAction;
}

export function buildDecisionMvpProgressSnapshot({
  date,
  sport,
  rows,
  readiness,
  providerEnvDiagnostic,
  publicHistoricalTrainingEvidence,
  apiFootballEntitlementProbe,
  trainingSnapshot,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  rows: DecisionRowLike[];
  readiness: DecisionEngineReadiness;
  providerEnvDiagnostic: DecisionProviderEnvDiagnostic;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  apiFootballEntitlementProbe?: ApiFootballEntitlementProbe | null;
  trainingSnapshot?: TrainingDataSnapshot | null;
  now?: Date;
}): DecisionMvpProgressSnapshot {
  const valueRows = rows.filter((row) => row.prediction.bestPick.hasValue).length;
  const actionableRows = rows.filter((row) => row.prediction.decision.action !== "avoid").length;
  const providerPercent = clamp((providerEnvDiagnostic.totals.configuredCriticalLanes / Math.max(1, providerEnvDiagnostic.totals.criticalLanes)) * 100);
  const foreignSchemaSignals = foreignSupabaseSchemaSignals(readiness);
  const storageIsForeignBlocked = foreignSchemaSignals.length > 0;
  const storagePercent = storageIsForeignBlocked ? 28 : readiness.supabase.status === "ready" ? 78 : readiness.supabase.configured ? 48 : 18;
  const aiPercent = readiness.openAi.status === "ready" ? 82 : readiness.openAi.configured ? 54 : 22;
  const latestBacktest = trainingSnapshot?.latestBacktest;
  const runtimeBacktest = inspectRuntimeBacktestEvidence(sport, latestBacktest);
  const storedTrainingReady = Boolean(
    trainingSnapshot?.status === "ready" &&
      trainingSnapshot.readiness.readyForTraining &&
      runtimeBacktest.exactRuntimeParity &&
      latestBacktest &&
      latestBacktest.calibrationError !== null &&
      latestBacktest.calibrationBuckets.length > 0 &&
      Object.keys(latestBacktest.learnedWeights).length > 0
  );
  const trainingPercent = storedTrainingReady ? 88 : readiness.trainingData.status === "ready" ? 72 : readiness.trainingData.configured ? 45 : 24;
  const publicHistoryPercent = publicHistoricalTrainingEvidence?.contribution.mvpCorpusPercent ?? 34;
  const publicHistoryProofUrl =
    "/api/sports/decision/training/public-historical-training-evidence?seasonFrom=2016&seasonTo=2025&maxSeasons=10&trainRatio=0.7&minEdge=0.02&minModelProbability=0.36&minPickCount=75&minTrainingSeasons=3&dryRun=1";
  const openingFixture = EPL_2026_OPENING_WINDOW[0]
    ? `${EPL_2026_OPENING_WINDOW[0].home} vs ${EPL_2026_OPENING_WINDOW[0].away}`
    : "EPL 2026/27 opening fixture";
  const daysUntilStart = Math.max(0, dayDiff(date, EPL_2026_SEASON.seasonStartDate));
  const entitlementEvidence = apiFootballEntitlementEvidence(apiFootballEntitlementProbe);
  const isFutureEplBlocked = futureEplEntitlementBlocked(apiFootballEntitlementProbe);
  const providerLaneStatus =
    providerEnvDiagnostic.status === "ready"
      ? isFutureEplBlocked
        ? "current"
        : "done"
      : providerEnvDiagnostic.status === "partial"
        ? "current"
        : "blocked";
  const providerLanePercent = isFutureEplBlocked ? Math.min(providerPercent, 62) : providerPercent;
  const providerLaneNextAction = isFutureEplBlocked ? entitlementNextAction(apiFootballEntitlementProbe) : providerEnvDiagnostic.footballMvpMinimum.nextAction;
  const eplLaneStatus =
    providerEnvDiagnostic.footballMvpMinimum.status === "ready" ? (isFutureEplBlocked ? "blocked" : "current") : "blocked";
  const eplLanePercent = providerEnvDiagnostic.footballMvpMinimum.status === "ready" ? (isFutureEplBlocked ? 52 : 70) : 38;
  const eplNextAction = isFutureEplBlocked
    ? `${entitlementNextAction(apiFootballEntitlementProbe)} Then rerun /api/sports/decision/training/api-football-entitlement-probe?run=1.`
    : "Use provider keys to map the EPL 2026/27 fixture IDs, odds markets, and pre-kickoff evidence before the opening weekend.";

  const lanes = [
    lane({
      id: "models",
      label: "Prediction models",
      status: rows.length ? "done" : "blocked",
      percent: rows.length ? 86 : 0,
      evidence: `${rows.length} slate row(s) available with football Poisson/Elo, basketball pace/efficiency, and tennis Elo pathways in the engine.`,
      nextAction: rows.length ? "Keep model outputs analysis-only until live provider and training proof are ready." : "Restore slate prediction rows before evaluating model readiness.",
      proofUrl: "/api/sports/predictions"
    }),
    lane({
      id: "odds",
      label: "Odds intelligence",
      status: valueRows ? "done" : "current",
      percent: valueRows ? 78 : rows.length ? 52 : 0,
      evidence: `${valueRows}/${rows.length} row(s) have positive value selections; ${actionableRows} row(s) are consider/monitor.`,
      nextAction: providerEnvDiagnostic.footballMvpMinimum.status === "ready" ? "Run bookmaker market dry-runs to replace synthetic odds evidence." : "Configure The Odds API before treating value-edge rankings as live.",
      proofUrl: "/api/sports/decision/odds-intelligence-proof"
    }),
    lane({
      id: "provider-data",
      label: "Provider data",
      status: providerLaneStatus,
      percent: providerLanePercent,
      evidence: [
        `${providerEnvDiagnostic.totals.configuredCriticalLanes}/${providerEnvDiagnostic.totals.criticalLanes} critical provider lane(s) configured; ${providerEnvDiagnostic.totals.missing} env name(s) missing.`,
        entitlementEvidence
      ]
        .filter(Boolean)
        .join(" "),
      nextAction: providerLaneNextAction,
      proofUrl: "/api/sports/decision/provider-env-diagnostic"
    }),
    lane({
      id: "openai-review",
      label: "OpenAI review",
      status: readiness.openAi.status === "ready" ? "done" : readiness.openAi.configured ? "current" : "locked",
      percent: aiPercent,
      evidence: readiness.openAi.detail,
      nextAction: readiness.openAi.configured ? "Run the bounded AI review receipt after provider evidence is present." : "Configure OPENAI_API_KEY to unlock live AI critique.",
      proofUrl: "/api/sports/decision/openai-key-diagnostic"
    }),
    lane({
      id: "supabase-storage",
      label: "Supabase storage",
      status: storageIsForeignBlocked ? "blocked" : readiness.supabase.status === "ready" ? "done" : readiness.supabase.configured ? "current" : "blocked",
      percent: storagePercent,
      evidence: storageIsForeignBlocked
        ? `${readiness.supabase.detail} Foreign schema signals: ${foreignSchemaSignals.slice(0, 4).join(", ")}.`
        : readiness.supabase.detail,
      nextAction: storageIsForeignBlocked
        ? "Do not write provider data or training rows until the OddsPadi Supabase project is isolated from foreign product tables."
        : readiness.supabase.configured
          ? "Verify OddsPadi schema/storage proof before provider writes."
          : "Configure the OddsPadi Supabase URL and service role key.",
      proofUrl: "/api/sports/decision/storage-activation-checklist"
    }),
    lane({
      id: "training-corpus",
      label: "Training corpus",
      status: storedTrainingReady || readiness.trainingData.status === "ready" ? "done" : readiness.trainingData.configured ? "current" : "locked",
      percent: trainingPercent,
      evidence:
        storedTrainingReady && trainingSnapshot?.latestBacktest
          ? `${trainingSnapshot.counts.realFinishedFixtures} real finished ${trainingSnapshot.sport} fixture(s), ${trainingSnapshot.counts.realOddsSnapshots} real odds snapshot(s), ${trainingSnapshot.counts.featureSnapshots} feature snapshot(s), and ${trainingSnapshot.counts.backtestRuns} backtest run(s). Latest calibration error ${trainingSnapshot.latestBacktest.calibrationError} with ${trainingSnapshot.latestBacktest.calibrationBuckets.length} bucket(s).`
          : readiness.trainingData.detail,
      nextAction: storedTrainingReady
        ? "Keep learned weights in shadow comparison until holdout yield, closing-line value, live feature governance, and explicit operator promotion pass."
        : "Backfill the 10-year football, basketball, and tennis corpus before promoting learned weights.",
      proofUrl: "/api/sports/decision/training/ten-year-corpus-execution"
    }),
    lane({
      id: "public-history",
      label: "Public EPL history",
      status: publicHistoryLaneStatus(publicHistoricalTrainingEvidence),
      percent: publicHistoryPercent,
      evidence: publicHistoricalTrainingEvidence
        ? `${publicHistoricalTrainingEvidence.scorecard.seasonsLoaded} season(s), ${publicHistoricalTrainingEvidence.scorecard.fixtures} fixture(s), ${publicHistoricalTrainingEvidence.scorecard.oddsRows} odds row(s), diagnostic score ${publicHistoricalTrainingEvidence.diagnosticScore}/100, verdict ${publicHistoricalTrainingEvidence.scorecard.benchmarkVerdict}.`
        : "No-key public-history proof is available on demand; run publicHistory=1 to attach the 2016-2025 EPL diagnostic corpus to this snapshot.",
      nextAction: publicHistoryNextAction(publicHistoricalTrainingEvidence),
      proofUrl: publicHistoryProofUrl
    }),
    lane({
      id: "epl-2026",
      label: "EPL 2026/27 launch lane",
      status: eplLaneStatus,
      percent: eplLanePercent,
      evidence: [
        `${EPL_2026_OPENING_WINDOW.length} opening-window fixture(s) tracked; season starts ${EPL_2026_SEASON.seasonStartDate}; ${daysUntilStart} day(s) from ${date}.`,
        entitlementEvidence
      ]
        .filter(Boolean)
        .join(" "),
      nextAction: eplNextAction,
      proofUrl: "/api/sports/decision/training/api-football-entitlement-probe"
    })
  ];

  const percentages = {
    technicalMvp: weightedPercent(lanes, {
      models: 22,
      odds: 18,
      "provider-data": 16,
      "openai-review": 12,
      "supabase-storage": 12,
      "training-corpus": 12,
      "public-history": 8,
      "epl-2026": 8
    }),
    liveProduction: weightedPercent(lanes, {
      models: 8,
      odds: 14,
      "provider-data": 24,
      "openai-review": 10,
      "supabase-storage": 18,
      "training-corpus": 18,
      "public-history": 6,
      "epl-2026": 8
    }),
    dataReadiness: clamp((providerPercent + storagePercent + trainingPercent + publicHistoryPercent) / 4),
    aiReadiness: aiPercent
  };
  const status = statusFor(lanes, readiness);
  const blockers = lanes.filter((item) => item.status === "blocked" || item.status === "locked").map((item) => `${item.label}: ${item.nextAction}`);
  const currentWork = lanes.filter((item) => item.status === "current").map((item) => `${item.label}: ${item.nextAction}`);

  return {
    mode: "decision-mvp-progress-snapshot",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    summary: summaryFor(status, percentages),
    percentages,
    lanes,
    completed: lanes.filter((item) => item.status === "done").map((item) => item.label),
    blockers,
    currentWork,
    epl2026: {
      tracked: true,
      competition: EPL_2026_SEASON.competition,
      season: EPL_2026_SEASON.season,
      providerSeason: EPL_2026_SEASON.providerSeason,
      fixtureReleaseDate: EPL_2026_SEASON.fixtureReleaseDate,
      seasonStartDate: EPL_2026_SEASON.seasonStartDate,
      finalMatchDate: EPL_2026_SEASON.finalMatchDate,
      totalFixtures: EPL_2026_SEASON.totalFixtures,
      openingWindowFixtures: EPL_2026_OPENING_WINDOW.length,
      openingFixture,
      daysUntilStart,
      sourceUrl: EPL_2026_SEASON.sourceUrl,
      nextAction: isFutureEplBlocked
        ? eplNextAction
        : "Prepare fixture, odds, lineup, injury, news, and weather provider evidence before the 2026/27 EPL opener.",
      entitlementStatus: apiFootballEntitlementProbe?.status ?? "not-attached",
      entitlementEvidence
    },
    controls: {
      readOnly: true,
      canRunProviderDryRun:
        providerEnvDiagnostic.footballMvpMinimum.status === "ready" && readiness.supabase.configured && !storageIsForeignBlocked && !isFutureEplBlocked,
      canRequestOpenAIReview: readiness.openAi.status === "ready",
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/mvp-progress-snapshot",
      "/api/sports/decision/provider-env-diagnostic",
      "/api/sports/decision/training/api-football-entitlement-probe",
      "/api/sports/decision/epl-pre-kickoff-rehearsal",
      "/api/sports/decision/training/ten-year-corpus-execution",
      publicHistoryProofUrl
    ]
  };
}
