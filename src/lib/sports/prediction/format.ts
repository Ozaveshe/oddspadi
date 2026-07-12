import type { ConfidenceLevel, RiskLevel } from "@/lib/sports/types";

/** Clamp a 0–1 probability into range, treating non-finite input as 0 so a bad
 *  upstream value never renders as "NaN%" or an overflowing bar. */
export function clampProbability(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function formatPercent(value: number): string {
  return `${Math.round(clampProbability(value) * 100)}%`;
}

export function formatSignedPercent(value: number): string {
  const percent = (Number.isFinite(value) ? value : 0) * 100;
  const sign = percent > 0 ? "+" : "";
  return `${sign}${percent.toFixed(1)}%`;
}

export function formatOdds(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  return value.toFixed(2);
}

export function confidenceRank(confidence: ConfidenceLevel): number {
  return confidence === "high" ? 3 : confidence === "medium" ? 2 : 1;
}

export function riskCopy(risk: RiskLevel): string {
  return `${risk.charAt(0).toUpperCase()}${risk.slice(1)} risk`;
}
