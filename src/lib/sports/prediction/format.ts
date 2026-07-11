import type { ConfidenceLevel, RiskLevel } from "@/lib/sports/types";

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function formatSignedPercent(value: number): string {
  const percent = value * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(1)}%`;
}

export function formatOdds(value: number): string {
  return value.toFixed(2);
}

export function confidenceRank(confidence: ConfidenceLevel): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

export function riskCopy(risk: RiskLevel): string {
  return `${risk.charAt(0).toUpperCase()}${risk.slice(1)} risk`;
}
