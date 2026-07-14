import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  calculateAccuracy,
  calculateBrierScore,
  calculateCalibrationBuckets,
  calculateRoiSimulation,
  calculateSettlementHealth,
  settledPublicPicks
} from "@/lib/sports/performance/analytics";
import { buildEnginePerformanceVerdict, buildEnginePerformanceWarnings } from "@/lib/sports/performance/report";
import type { PublicPredictionHistoryItem } from "@/lib/sports/prediction/history";

function pick(overrides: Partial<PublicPredictionHistoryItem> = {}): PublicPredictionHistoryItem {
  return {
    id: "pick-1",
    date: "2026-07-14",
    match: "Home FC vs Away FC",
    pick: "Home FC",
    odds: 2,
    modelProbability: 0.6,
    edge: 0.08,
    result: "won",
    sport: "football",
    market: "match_winner",
    league: "NPFL",
    country: "Nigeria",
    kickoffTime: "2026-07-14T18:00:00.000Z",
    createdAt: "2026-07-14T10:00:00.000Z",
    publishedAt: "2026-07-14T10:00:00.000Z",
    settledAt: "2026-07-14T20:00:00.000Z",
    publicStatus: "settled",
    settlementStatus: "settled",
    settlementReason: "Provider result verified.",
    pendingReasonLabel: null,
    confidence: "medium",
    risk: "medium",
    expectedValue: 0.12,
    dataQuality: 0.84,
    impliedProbability: 0.5,
    noVigProbability: 0.52,
    closingOdds: 1.9,
    closingLineValue: 0.052632,
    modelVersion: "model-1",
    provider: "api-football",
    recordSource: "public-pick-ledger",
    ...overrides
  };
}

describe("engine performance analytics", () => {
  it("calculates accuracy from settled public wins and losses only", () => {
    const rows = [
      pick({ id: "won" }),
      pick({ id: "lost", result: "lost" }),
      pick({ id: "push", result: "push" }),
      pick({ id: "pending", result: "pending", settlementStatus: "awaiting_final_score", settledAt: null }),
      pick({ id: "mock", provider: "mockSportsProvider" })
    ];
    expect(calculateAccuracy(rows)).toBe(0.5);
    expect(settledPublicPicks(rows).map((row) => row.id)).toEqual(["won", "lost", "push"]);
  });

  it("uses a one-unit stake simulation for ROI", () => {
    const roi = calculateRoiSimulation([pick({ id: "won", odds: 2.5 }), pick({ id: "lost", result: "lost" })]);
    expect(roi.unitsStaked).toBe(2);
    expect(roi.profit).toBe(0.5);
    expect(roi.roi).toBe(0.25);
  });

  it("excludes pending picks from both accuracy and ROI", () => {
    const rows = [pick({ id: "won" }), pick({ id: "pending", result: "pending", settlementStatus: "provider_missing", settledAt: null, odds: 10 })];
    expect(calculateAccuracy(rows)).toBe(1);
    expect(calculateRoiSimulation(rows)).toMatchObject({ picks: 1, unitsStaked: 1, profit: 1, roi: 1 });
  });

  it("calculates probability bucket expectations and calibration gaps", () => {
    const bucket = calculateCalibrationBuckets([
      pick({ id: "a", modelProbability: 0.52 }),
      pick({ id: "b", modelProbability: 0.54, result: "lost" })
    ]).find((row) => row.id === "50-55");
    expect(bucket).toMatchObject({ predictions: 2, wins: 1, expectedWins: 1.06, actualWinRate: 0.5 });
    expect(bucket?.averageProbability).toBeCloseTo(0.53);
    expect(bucket?.calibrationGap).toBeCloseTo(-0.03);
  });

  it("calculates a binary Brier score for resolved selections", () => {
    const score = calculateBrierScore([
      pick({ id: "won", modelProbability: 0.8 }),
      pick({ id: "lost", modelProbability: 0.3, result: "lost" })
    ]);
    expect(score).toBeCloseTo(0.065);
  });

  it("excludes negative-edge and internal model outcomes", () => {
    const internal = pick({ id: "internal" }) as unknown as PublicPredictionHistoryItem;
    Object.assign(internal, { recordSource: "internal-model-run" });
    const rows = [pick({ id: "public" }), pick({ id: "negative", edge: -0.04 }), internal];
    expect(settledPublicPicks(rows).map((row) => row.id)).toEqual(["public"]);
    expect(calculateAccuracy(rows)).toBe(1);
  });

  it("raises a settlement backlog warning when the pending ratio is high", () => {
    const rows = [
      pick({ id: "settled" }),
      ...[1, 2, 3].map((id) => pick({ id: `pending-${id}`, result: "pending", settlementStatus: "awaiting_final_score", settledAt: null }))
    ];
    const settlement = calculateSettlementHealth(rows);
    const warnings = buildEnginePerformanceWarnings({ settledCount: 1, settlement, providerStatus: "completed", providerGapCount: 0, roi: 0.1, calibration: [], publicPickCount: 4, qualityCoverage: 4 });
    expect(settlement.pendingRatio).toBe(0.75);
    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ id: "settlement-backlog", severity: "action" })]));
  });

  it("withholds performance claims when the public ledger is unavailable", () => {
    const settlement = calculateSettlementHealth([]);
    const warnings = buildEnginePerformanceWarnings({
      settledCount: 0,
      settlement,
      providerStatus: "empty",
      providerGapCount: 0,
      roi: null,
      calibration: [],
      publicPickCount: 0,
      qualityCoverage: 0,
      ledgerAvailable: false
    });

    expect(warnings).toEqual(expect.arrayContaining([expect.objectContaining({ id: "ledger-unavailable", severity: "action" })]));
    expect(warnings).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "small-sample" })]));
    expect(buildEnginePerformanceVerdict({ ledgerAvailable: false, settledCount: 0, blockingWarnings: 1 })).toMatchObject({
      status: "unavailable",
      label: "Evidence unavailable"
    });
  });

  it("ships a transparent dashboard and JSON/CSV export routes", () => {
    const page = readFileSync("src/app/engine/performance/page.tsx", "utf8");
    expect(page).toContain("Is the OddsPadi engine");
    for (const section of ["Engine Health", "Learning pipeline", "Public Pick Performance", "Calibration", "Market Performance", "Data Quality", "Closing Line Value", "Warnings"]) expect(page).toContain(section);
    expect(readFileSync("src/app/api/engine/performance/route.ts", "utf8")).toContain("getEnginePerformanceReport");
    expect(readFileSync("src/app/api/engine/performance.csv/route.ts", "utf8")).toContain("formatEnginePerformanceCsv");
  });
});
