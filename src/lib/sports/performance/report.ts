import { getPublicPredictionHistory } from "@/lib/sports/prediction/history";
import { getDailyTipsProduct } from "@/lib/sports/tips/product";
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

export async function getEnginePerformanceReport() {
  const [ledger, daily] = await Promise.all([getPublicPredictionHistory(), getDailyTipsProduct()]);
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
