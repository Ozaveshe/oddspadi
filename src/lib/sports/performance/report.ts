import { getPublicPredictionHistory } from "@/lib/sports/prediction/history";
import { getDailyTipsProduct } from "@/lib/sports/tips/product";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import {
  calculateAccuracy,
  calculateBrierScore,
  calculateCalibrationBuckets,
  calculateClosingLineValue,
  calculateConfidencePerformance,
  calculateDataQualityPerformance,
  calculateLeaguePerformance,
  calculateMarketPerformance,
  calculateRoiSimulation,
  calculateSettlementHealth,
  calculateSportPerformance,
  isPublicPerformancePick,
  settledPublicPicks
} from "./analytics";

export type EnginePerformanceWarning = {
  id: "small-sample" | "settlement-backlog" | "provider-gap" | "negative-roi" | "calibration-gap" | "data-quality-coverage";
  severity: "info" | "watch" | "action";
  title: string;
  detail: string;
};

export function buildEnginePerformanceWarnings({
  settledCount,
  settlement,
  providerStatus,
  providerGapCount,
  roi,
  calibration,
  publicPickCount,
  qualityCoverage
}: {
  settledCount: number;
  settlement: ReturnType<typeof calculateSettlementHealth>;
  providerStatus: string;
  providerGapCount: number;
  roi: number | null;
  calibration: ReturnType<typeof calculateCalibrationBuckets>;
  publicPickCount: number;
  qualityCoverage: number;
}): EnginePerformanceWarning[] {
  const warnings: EnginePerformanceWarning[] = [];
  if (settledCount < 30) warnings.push({
    id: "small-sample",
    severity: "info",
    title: "Too few settled picks for a strong conclusion",
    detail: `${settledCount} settled public pick${settledCount === 1 ? " is" : "s are"} available. Treat accuracy, ROI and calibration as early evidence until at least 30 settle.`
  });
  if (settlement.totalPublicPicks > 0 && settlement.pendingRatio > 0.35) warnings.push({
    id: "settlement-backlog",
    severity: "action",
    title: "Settlement backlog is high",
    detail: `${Math.round(settlement.pendingRatio * 100)}% of public picks are pending or need review. Accuracy and ROI exclude that backlog.`
  });
  if (providerStatus !== "completed" || providerGapCount > 0) warnings.push({
    id: "provider-gap",
    severity: "watch",
    title: "Provider coverage has gaps",
    detail: `${providerStatus} provider state with ${providerGapCount} recorded gap${providerGapCount === 1 ? "" : "s"}. The engine does not substitute demo fixtures.`
  });
  if (roi !== null && roi < 0) warnings.push({
    id: "negative-roi",
    severity: "action",
    title: "One-unit ROI is negative",
    detail: `${(roi * 100).toFixed(1)}% simulated ROI across ${settledCount} settled picks. This is a result to investigate, not hide.`
  });
  const badBucket = calibration.find((bucket) => bucket.predictions >= 5 && bucket.calibrationGap !== null && Math.abs(bucket.calibrationGap) >= 0.1);
  if (badBucket) warnings.push({
    id: "calibration-gap",
    severity: "watch",
    title: `${badBucket.label} probability bucket is poorly calibrated`,
    detail: `${badBucket.predictions} predictions produced a ${Math.abs((badBucket.calibrationGap ?? 0) * 100).toFixed(1)} percentage-point gap between model confidence and outcomes.`
  });
  if (publicPickCount > 0 && qualityCoverage / publicPickCount < 0.8) warnings.push({
    id: "data-quality-coverage",
    severity: "info",
    title: "Older picks are missing data-quality scores",
    detail: `${qualityCoverage} of ${publicPickCount} public picks retain a publication-time data-quality score. Missing values remain unscored.`
  });
  return warnings;
}

function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function getHistoricalEngineEvidence() {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";
  const census = await readSupabaseTrainingCorpusCensus({ origin }).catch((error: unknown) => ({
    status: "failed" as const,
    summary: error instanceof Error ? error.message : "Training corpus census failed.",
    totals: { fixtures: 0, finishedFixtures: 0, oddsSnapshots: 0, featureSnapshots: 0, completeFeatureSnapshots: 0, completedBacktests: 0 },
    sports: []
  }));
  const client = getSupabaseServerClient();
  if (!client) {
    return {
      source: "unavailable" as const,
      census,
      latestBacktests: [],
      models: [],
      learningPipeline: { calibrationRuns: 0, promotionCandidates: 0, reviewReadyCandidates: 0, approvedPromotions: 0 },
      playerAvailabilitySnapshots: 0,
      lineupSnapshots: 0,
      playerMatchPerformances: 0,
      limitations: [
        "Historical evidence is stored server-side, but this runtime cannot read the OddsPadi Supabase project.",
        "Player-level coverage currently tracks availability and lineups, not a complete match-by-match player performance corpus."
      ]
    };
  }

  const [backtests, models, calibrationRuns, calibrationCandidates, calibrationPromotions, availability, lineups, playerPerformances] = await Promise.all([
    client
      .from("op_backtest_runs")
      .select("sport,model_key,engine_version,status,data_source,sample_size,test_size,pick_count,brier_score,log_loss,yield,closing_line_value,calibration_error,created_at")
      .eq("status", "completed")
      .order("created_at", { ascending: false })
      .limit(30),
    client
      .from("op_model_versions")
      .select("sport,model_key,version_label,is_active,metrics,updated_at")
      .order("sport", { ascending: true }),
    client.from("op_calibration_runs").select("id", { count: "exact", head: true }),
    client.from("op_calibration_candidates").select("id,metrics").order("created_at", { ascending: false }).limit(100),
    client.from("op_calibration_promotions").select("id,status,expires_at").order("approved_at", { ascending: false }).limit(100),
    client.from("op_player_availability_snapshots").select("id", { count: "exact", head: true }),
    client.from("op_lineup_snapshots").select("id", { count: "exact", head: true }),
    client.from("op_player_match_performances").select("id", { count: "exact", head: true })
  ]);
  const errors = [...new Set(
    [backtests.error, models.error, calibrationRuns.error, calibrationCandidates.error, calibrationPromotions.error, availability.error, lineups.error, playerPerformances.error]
      .flatMap((error) => {
        const message = error?.message?.trim();
        return message ? [message] : [];
      })
  )];
  const latestBySport = new Map<string, Record<string, unknown>>();
  for (const row of (backtests.data ?? []) as Array<Record<string, unknown>>) {
    const sport = String(row.sport ?? "unknown");
    if (!latestBySport.has(sport)) latestBySport.set(sport, row);
  }
  const reviewReadyCandidates = ((calibrationCandidates.data ?? []) as Array<Record<string, unknown>>).filter((row) => {
    const readiness = record(record(row.metrics).promotionReadiness);
    return readiness.status === "ready-shadow-review";
  }).length;
  const now = Date.now();
  const approvedPromotions = ((calibrationPromotions.data ?? []) as Array<Record<string, unknown>>).filter((row) => {
    if (row.status !== "approved") return false;
    const expiresAt = typeof row.expires_at === "string" ? Date.parse(row.expires_at) : Number.NaN;
    return !Number.isFinite(expiresAt) || expiresAt > now;
  }).length;

  return {
    source: errors.length ? "degraded" as const : "supabase" as const,
    census,
    latestBacktests: [...latestBySport.values()].map((row) => ({
      sport: String(row.sport ?? "unknown"),
      modelKey: String(row.model_key ?? "unknown"),
      engineVersion: String(row.engine_version ?? "unknown"),
      dataSource: String(row.data_source ?? "unknown"),
      sampleSize: finiteNumber(row.sample_size) ?? 0,
      testSize: finiteNumber(row.test_size) ?? 0,
      pickCount: finiteNumber(row.pick_count) ?? 0,
      brierScore: finiteNumber(row.brier_score),
      logLoss: finiteNumber(row.log_loss),
      yield: finiteNumber(row.yield),
      closingLineValue: finiteNumber(row.closing_line_value),
      calibrationError: finiteNumber(row.calibration_error),
      createdAt: String(row.created_at ?? "")
    })),
    models: ((models.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      sport: String(row.sport ?? "unknown"),
      modelKey: String(row.model_key ?? "unknown"),
      versionLabel: String(row.version_label ?? "unknown"),
      active: row.is_active === true,
      updatedAt: String(row.updated_at ?? "")
    })),
    learningPipeline: {
      calibrationRuns: calibrationRuns.count ?? 0,
      promotionCandidates: calibrationCandidates.data?.length ?? 0,
      reviewReadyCandidates,
      approvedPromotions
    },
    playerAvailabilitySnapshots: availability.count ?? 0,
    lineupSnapshots: lineups.count ?? 0,
    playerMatchPerformances: playerPerformances.count ?? 0,
    limitations: [
      "Backtests measure historical behaviour; they do not count as settled public-pick performance.",
      (playerPerformances.count ?? 0) > 0
        ? "Player match-performance facts are available, but coverage and chronological sample depth must pass promotion gates before the signal receives material weight."
        : "No player match-performance facts are stored yet; player-form weighting remains inactive rather than inferred.",
      ...(errors.length ? [`Some historical evidence reads failed: ${errors.join("; ")}`] : [])
    ]
  };
}

export async function getEnginePerformanceReport() {
  const [ledger, daily, historicalEvidence] = await Promise.all([
    getPublicPredictionHistory(),
    getDailyTipsProduct(),
    getHistoricalEngineEvidence()
  ]);
  const publicRows = ledger.items.filter(isPublicPerformancePick);
  const settled = settledPublicPicks(publicRows);
  const roi = calculateRoiSimulation(publicRows);
  const calibration = calculateCalibrationBuckets(publicRows);
  const settlement = calculateSettlementHealth(publicRows);
  const providerGapCount = daily.slate.provider.errors.length + daily.slate.fixtures.filter((row) => row.publicStatus === "needs_data" || row.publicStatus === "suspended").length;
  const qualityCoverage = publicRows.filter((item) => item.dataQuality !== null && item.dataQuality !== undefined).length;
  const warnings = buildEnginePerformanceWarnings({ settledCount: settled.length, settlement, providerStatus: daily.slate.provider.status, providerGapCount, roi: roi.roi, calibration, publicPickCount: publicRows.length, qualityCoverage });

  const blockingWarnings = warnings.filter((warning) => warning.severity === "action").length;
  const verdict = settled.length < 30
    ? { status: "early-evidence" as const, label: "Early evidence", detail: "The engine is measurable, but the settled sample is too small for a durable quality claim." }
    : blockingWarnings
      ? { status: "needs-attention" as const, label: "Needs attention", detail: "The engine is operating, but one or more outcome or settlement indicators require action." }
      : { status: "measurable" as const, label: "Measurable", detail: "The public sample is large enough to inspect. Continue monitoring calibration and ROI rather than treating either as permanent." };

  return {
    generatedAt: new Date().toISOString(),
    source: ledger.source,
    sourceReason: ledger.reason ?? null,
    methodology: {
      ledger: "op_public_picks only",
      stake: "One unit per settled public pick; pushes return the unit and voids are excluded from stake.",
      accuracy: "Wins divided by wins plus losses. Pending, push and void results are excluded.",
      brier: "Binary published-selection Brier score. Lower is better; pending, push and void results are excluded.",
      exclusions: ["mock or demo predictions", "internal model runs", "watchlist-only candidates", "non-positive-edge analyses", "unsettled picks"]
    },
    verdict,
    engineHealth: {
      latestRunTime: daily.slate.provider.lastRun?.finishedAt ?? null,
      providerHealth: daily.slate.provider.status,
      providers: daily.slate.provider.providers,
      fixturesAnalysed: daily.summary.fixturesAnalysed,
      decisionsGenerated: daily.slate.summary.predictionsGenerated,
      publicPicksPublished: daily.summary.valuePicks,
      staleDecisions: daily.slate.summary.staleDecisions,
      settlementBacklog: settlement.backlog,
      providerGaps: providerGapCount
    },
    historicalEvidence,
    publicPerformance: {
      totalPublicPicks: publicRows.length,
      settledPicks: settled.length,
      wins: settled.filter((item) => item.result === "won").length,
      losses: settled.filter((item) => item.result === "lost").length,
      pushes: settled.filter((item) => item.result === "push").length,
      voids: publicRows.filter((item) => item.result === "void").length,
      accuracy: calculateAccuracy(publicRows),
      roiSimulation: roi,
      brierScore: calculateBrierScore(publicRows),
      averageOdds: average(settled.map((item) => item.odds)),
      averageEdge: average(settled.map((item) => item.edge))
    },
    calibration,
    sports: calculateSportPerformance(publicRows),
    leagues: calculateLeaguePerformance(publicRows),
    markets: calculateMarketPerformance(publicRows),
    confidence: calculateConfidencePerformance(publicRows),
    dataQuality: calculateDataQualityPerformance(publicRows),
    closingLineValue: calculateClosingLineValue(publicRows),
    settlement,
    warnings
  };
}

export type EnginePerformanceReport = Awaited<ReturnType<typeof getEnginePerformanceReport>>;

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function formatEnginePerformanceCsv(report: EnginePerformanceReport): string {
  const rows: unknown[][] = [
    ["OddsPadi engine performance export"],
    ["Generated at", report.generatedAt],
    ["Source", report.source],
    ["Verdict", report.verdict.label],
    [],
    ["Public pick performance"],
    ["Settled picks", report.publicPerformance.settledPicks],
    ["Wins", report.publicPerformance.wins],
    ["Losses", report.publicPerformance.losses],
    ["Pushes", report.publicPerformance.pushes],
    ["Voids", report.publicPerformance.voids],
    ["Accuracy", report.publicPerformance.accuracy],
    ["ROI", report.publicPerformance.roiSimulation.roi],
    ["Brier score", report.publicPerformance.brierScore],
    [],
    ["Calibration bucket", "Predictions", "Wins", "Expected wins", "Actual win rate", "Calibration gap"],
    ...report.calibration.map((bucket) => [bucket.label, bucket.predictions, bucket.wins, bucket.expectedWins, bucket.actualWinRate, bucket.calibrationGap]),
    [],
    ["Market", "Settled picks", "Wins", "Losses", "Accuracy", "ROI", "Brier score"],
    ...report.markets.map((row) => [row.label, row.picks, row.wins, row.losses, row.accuracy, row.roi, row.brierScore]),
    [],
    ["Warning", "Severity", "Detail"],
    ...report.warnings.map((warning) => [warning.title, warning.severity, warning.detail])
  ];
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
