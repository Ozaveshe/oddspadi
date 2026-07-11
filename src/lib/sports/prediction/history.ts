import type { PredictionHistoryItem } from "@/lib/sports/types";

export const predictionHistory: PredictionHistoryItem[] = [
  {
    id: "hist-001",
    date: "2026-06-20",
    match: "Kano Pillars vs Enyimba",
    pick: "Kano Pillars",
    odds: 2.15,
    modelProbability: 0.53,
    edge: 0.065,
    result: "won"
  },
  {
    id: "hist-002",
    date: "2026-06-20",
    match: "Arsenal vs Chelsea",
    pick: "Over 2.5 Goals",
    odds: 1.88,
    modelProbability: 0.57,
    edge: 0.038,
    result: "lost"
  },
  {
    id: "hist-003",
    date: "2026-06-21",
    match: "Barcelona vs Sevilla",
    pick: "Barcelona",
    odds: 1.72,
    modelProbability: 0.64,
    edge: 0.059,
    result: "won"
  },
  {
    id: "hist-004",
    date: "2026-06-21",
    match: "Sundowns vs Orlando Pirates",
    pick: "Both Teams To Score",
    odds: 2.05,
    modelProbability: 0.52,
    edge: 0.032,
    result: "push"
  },
  {
    id: "hist-005",
    date: "2026-06-22",
    match: "Milan vs Lazio",
    pick: "Milan",
    odds: 2.2,
    modelProbability: 0.51,
    edge: 0.055,
    result: "lost"
  },
  {
    id: "hist-006",
    date: "2026-06-23",
    match: "Hearts of Oak vs Asante Kotoko",
    pick: "Under 2.5 Goals",
    odds: 1.93,
    modelProbability: 0.55,
    edge: 0.032,
    result: "pending"
  }
];

export function getHistorySummary(items = predictionHistory) {
  const settled = items.filter((item) => item.result === "won" || item.result === "lost");
  const wins = settled.filter((item) => item.result === "won").length;
  const losses = settled.filter((item) => item.result === "lost").length;
  const stake = settled.length;
  const returns = settled.reduce((sum, item) => (item.result === "won" ? sum + item.odds : sum), 0);
  const profit = returns - stake;

  return {
    settled: settled.length,
    wins,
    losses,
    accuracy: settled.length ? wins / settled.length : 0,
    roi: stake ? profit / stake : 0
  };
}
