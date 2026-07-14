import type { PublicPredictionHistoryItem } from "@/lib/sports/prediction/history";

export type PerformanceRow = {
  label: string;
  picks: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  accuracy: number | null;
  roi: number | null;
  averageOdds: number | null;
  averageEdge: number | null;
  brierScore: number | null;
};

export type CalibrationBucket = {
  id: string;
  label: string;
  minProbability: number;
  maxProbability: number | null;
  predictions: number;
  wins: number;
  expectedWins: number;
  averageProbability: number | null;
  actualWinRate: number | null;
  calibrationGap: number | null;
};

export type SettlementHealth = {
  totalPublicPicks: number;
  settled: number;
  pending: number;
  manualReview: number;
  providerMissing: number;
  stale: number;
  backlog: number;
  pendingRatio: number;
  statuses: Record<string, number>;
};

const BUCKETS = [
  { id: "40-50", label: "40–50%", min: 0.4, max: 0.5 },
  { id: "50-55", label: "50–55%", min: 0.5, max: 0.55 },
  { id: "55-60", label: "55–60%", min: 0.55, max: 0.6 },
  { id: "60-65", label: "60–65%", min: 0.6, max: 0.65 },
  { id: "65-70", label: "65–70%", min: 0.65, max: 0.7 },
  { id: "70-plus", label: "70%+", min: 0.7, max: null }
] as const;

function round(value: number, places = 6): number {
  const factor = 10 ** places;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function average(values: number[]): number | null {
  return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function realProvider(item: PublicPredictionHistoryItem): boolean {
  const provider = item.provider?.toLowerCase() ?? "";
  return !provider.includes("mock") && !provider.includes("demo");
}

/** The public-pick ledger is the only admissible source for performance claims. */
export function isPublicPerformancePick(item: PublicPredictionHistoryItem): boolean {
  return item.recordSource === "public-pick-ledger" && item.edge > 0 && realProvider(item);
}

export function settledPublicPicks(items: PublicPredictionHistoryItem[]): PublicPredictionHistoryItem[] {
  return items.filter((item) =>
    isPublicPerformancePick(item) &&
    item.settlementStatus === "settled" &&
    ["won", "lost", "push"].includes(item.result)
  );
}

function resolvedBinaryPicks(items: PublicPredictionHistoryItem[]): PublicPredictionHistoryItem[] {
  return settledPublicPicks(items).filter((item) => item.result === "won" || item.result === "lost");
}

export function calculateAccuracy(items: PublicPredictionHistoryItem[]): number | null {
  const resolved = resolvedBinaryPicks(items);
  if (!resolved.length) return null;
  return round(resolved.filter((item) => item.result === "won").length / resolved.length);
}

export function calculateRoiSimulation(items: PublicPredictionHistoryItem[]) {
  const picks = settledPublicPicks(items);
  const staked = picks.length;
  const returned = picks.reduce((sum, item) => {
    if (item.result === "won") return sum + item.odds;
    if (item.result === "push") return sum + 1;
    return sum;
  }, 0);
  const profit = returned - staked;
  return {
    picks: staked,
    unitsStaked: staked,
    unitsReturned: round(returned),
    profit: round(profit),
    roi: staked ? round(profit / staked) : null
  };
}

/** Binary selection Brier score: 0 is perfect; lower is better. */
export function calculateBrierScore(items: PublicPredictionHistoryItem[]): number | null {
  const resolved = resolvedBinaryPicks(items).filter((item) => Number.isFinite(item.modelProbability));
  if (!resolved.length) return null;
  return round(resolved.reduce((sum, item) => {
    const outcome = item.result === "won" ? 1 : 0;
    return sum + (item.modelProbability - outcome) ** 2;
  }, 0) / resolved.length);
}

export function calculateCalibrationBuckets(items: PublicPredictionHistoryItem[]): CalibrationBucket[] {
  const resolved = resolvedBinaryPicks(items);
  return BUCKETS.map((bucket) => {
    const rows = resolved.filter((item) => item.modelProbability >= bucket.min && (bucket.max === null || item.modelProbability < bucket.max));
    const wins = rows.filter((item) => item.result === "won").length;
    const expectedWins = round(rows.reduce((sum, item) => sum + item.modelProbability, 0), 3);
    const averageProbability = average(rows.map((item) => item.modelProbability));
    const actualWinRate = rows.length ? round(wins / rows.length) : null;
    return {
      id: bucket.id,
      label: bucket.label,
      minProbability: bucket.min,
      maxProbability: bucket.max,
      predictions: rows.length,
      wins,
      expectedWins,
      averageProbability,
      actualWinRate,
      calibrationGap: averageProbability !== null && actualWinRate !== null ? round(actualWinRate - averageProbability) : null
    };
  });
}

function performanceRow(label: string, items: PublicPredictionHistoryItem[]): PerformanceRow {
  const settled = settledPublicPicks(items);
  const roi = calculateRoiSimulation(settled);
  const binary = resolvedBinaryPicks(settled);
  return {
    label,
    picks: settled.length,
    wins: binary.filter((item) => item.result === "won").length,
    losses: binary.filter((item) => item.result === "lost").length,
    pushes: settled.filter((item) => item.result === "push").length,
    voids: items.filter((item) => isPublicPerformancePick(item) && item.result === "void").length,
    accuracy: calculateAccuracy(settled),
    roi: roi.roi,
    averageOdds: average(settled.map((item) => item.odds)),
    averageEdge: average(settled.map((item) => item.edge)),
    brierScore: calculateBrierScore(settled)
  };
}

function groupedPerformance(items: PublicPredictionHistoryItem[], labelFor: (item: PublicPredictionHistoryItem) => string, required: string[] = []): PerformanceRow[] {
  const publicRows = items.filter(isPublicPerformancePick);
  const groups = new Map<string, PublicPredictionHistoryItem[]>();
  for (const label of required) groups.set(label, []);
  for (const item of publicRows) {
    const label = labelFor(item);
    groups.set(label, [...(groups.get(label) ?? []), item]);
  }
  return [...groups].map(([label, rows]) => performanceRow(label, rows)).sort((left, right) => right.picks - left.picks || left.label.localeCompare(right.label));
}

export function calculateSportPerformance(items: PublicPredictionHistoryItem[]): PerformanceRow[] {
  return groupedPerformance(items, (item) => item.sport || "Unknown sport", ["football", "basketball", "tennis"]);
}

export function calculateLeaguePerformance(items: PublicPredictionHistoryItem[]): PerformanceRow[] {
  return groupedPerformance(items, (item) => item.league || "Unlabelled league");
}

export function marketFamily(item: Pick<PublicPredictionHistoryItem, "market" | "sport">): string {
  const market = item.market.toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
  if (market.includes("btts") || market.includes("both_teams")) return "BTTS";
  if (market.includes("total") || market.includes("over_under") || market.includes("over") || market.includes("under")) return "Over/Under";
  if (market.includes("spread") || market.includes("handicap")) return "Spread";
  if (item.sport === "tennis" && (market.includes("winner") || market.includes("h2h") || market.includes("moneyline"))) return "Tennis winner";
  if (item.sport === "basketball" && (market.includes("winner") || market.includes("h2h") || market.includes("moneyline"))) return "Moneyline";
  if (market.includes("1x2") || market.includes("match_winner") || market.includes("winner")) return "1X2";
  if (market.includes("moneyline") || market.includes("h2h")) return "Moneyline";
  return item.market.replaceAll("_", " ");
}

export function calculateMarketPerformance(items: PublicPredictionHistoryItem[]): PerformanceRow[] {
  return groupedPerformance(items, marketFamily, ["1X2", "BTTS", "Over/Under", "Spread", "Moneyline", "Tennis winner"]);
}

export function calculateConfidencePerformance(items: PublicPredictionHistoryItem[]): PerformanceRow[] {
  return groupedPerformance(items, (item) => item.confidence.toLowerCase(), ["low", "medium", "high"]);
}

export function dataQualityBand(score: number | null | undefined): "low" | "medium" | "high" | "unscored" {
  if (score === null || score === undefined || !Number.isFinite(score)) return "unscored";
  if (score < 0.62) return "low";
  if (score < 0.8) return "medium";
  return "high";
}

export function calculateDataQualityPerformance(items: PublicPredictionHistoryItem[]): PerformanceRow[] {
  return groupedPerformance(items, (item) => dataQualityBand(item.dataQuality), ["low", "medium", "high", "unscored"]);
}

export function calculateClosingLineValue(items: PublicPredictionHistoryItem[]) {
  const rows = settledPublicPicks(items).filter((item) => item.closingOdds !== null && item.closingOdds > 1).map((item) => {
    const value = item.closingLineValue ?? item.odds / (item.closingOdds as number) - 1;
    return {
      id: item.id,
      match: item.match,
      market: item.market,
      openingOdds: null as number | null,
      publishedOdds: item.odds,
      closingOdds: item.closingOdds as number,
      value: round(value)
    };
  });
  return {
    available: rows.length > 0,
    picksWithClosingOdds: rows.length,
    positive: rows.filter((row) => row.value > 0).length,
    negative: rows.filter((row) => row.value < 0).length,
    neutral: rows.filter((row) => row.value === 0).length,
    average: average(rows.map((row) => row.value)),
    averagePublishedOdds: average(rows.map((row) => row.publishedOdds)),
    averageClosingOdds: average(rows.map((row) => row.closingOdds)),
    rows
  };
}

export function calculateSettlementHealth(items: PublicPredictionHistoryItem[]): SettlementHealth {
  const publicRows = items.filter(isPublicPerformancePick);
  const statuses = publicRows.reduce<Record<string, number>>((counts, item) => {
    counts[item.settlementStatus] = (counts[item.settlementStatus] ?? 0) + 1;
    return counts;
  }, {});
  const settled = statuses.settled ?? 0;
  const manualReview = statuses.needs_manual_review ?? 0;
  const providerMissing = statuses.provider_missing ?? 0;
  const pending = publicRows.filter((item) => !["settled", "void", "needs_manual_review"].includes(item.settlementStatus)).length;
  const backlog = pending + manualReview;
  return {
    totalPublicPicks: publicRows.length,
    settled,
    pending,
    manualReview,
    providerMissing,
    stale: publicRows.filter((item) => item.publicStatus === "stale").length,
    backlog,
    pendingRatio: publicRows.length ? round(backlog / publicRows.length) : 0,
    statuses
  };
}
