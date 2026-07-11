import type { ScorelineProbability } from "@/lib/sports/types";
import { clampProbability } from "./odds";

export type ScoreMatrixCell = ScorelineProbability;

export function factorial(value: number): number {
  if (value < 0 || !Number.isInteger(value)) {
    throw new Error("factorial requires a non-negative integer");
  }

  let result = 1;
  for (let index = 2; index <= value; index += 1) {
    result *= index;
  }
  return result;
}

export function poissonProbability(lambda: number, goals: number): number {
  if (lambda < 0 || goals < 0 || !Number.isInteger(goals)) return 0;
  return (Math.exp(-lambda) * lambda ** goals) / factorial(goals);
}

export function buildScoreMatrix(homeExpectedGoals: number, awayExpectedGoals: number, maxGoals = 8): ScoreMatrixCell[] {
  const cells: ScoreMatrixCell[] = [];

  for (let homeGoals = 0; homeGoals <= maxGoals; homeGoals += 1) {
    for (let awayGoals = 0; awayGoals <= maxGoals; awayGoals += 1) {
      cells.push({
        homeGoals,
        awayGoals,
        probability: poissonProbability(homeExpectedGoals, homeGoals) * poissonProbability(awayExpectedGoals, awayGoals)
      });
    }
  }

  const capturedProbability = cells.reduce((sum, cell) => sum + cell.probability, 0);
  if (capturedProbability <= 0) return cells;

  return cells.map((cell) => ({
    ...cell,
    probability: clampProbability(cell.probability / capturedProbability)
  }));
}

function dixonColesTau(homeGoals: number, awayGoals: number, homeExpectedGoals: number, awayExpectedGoals: number, rho: number): number {
  if (homeGoals === 0 && awayGoals === 0) return 1 - homeExpectedGoals * awayExpectedGoals * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + homeExpectedGoals * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + awayExpectedGoals * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

export function applyDixonColesAdjustment(
  matrix: ScoreMatrixCell[],
  homeExpectedGoals: number,
  awayExpectedGoals: number,
  rho: number
): ScoreMatrixCell[] {
  const adjusted = matrix.map((cell) => ({
    ...cell,
    probability: Math.max(0, cell.probability * Math.max(0.01, dixonColesTau(cell.homeGoals, cell.awayGoals, homeExpectedGoals, awayExpectedGoals, rho)))
  }));
  const total = adjusted.reduce((sum, cell) => sum + cell.probability, 0);
  if (total <= 0) return matrix;

  return adjusted.map((cell) => ({
    ...cell,
    probability: clampProbability(cell.probability / total)
  }));
}

export function probabilityFromScoreMatrix(
  matrix: ScoreMatrixCell[],
  predicate: (cell: ScoreMatrixCell) => boolean
): number {
  return clampProbability(matrix.filter(predicate).reduce((sum, cell) => sum + cell.probability, 0));
}

export function topScorelines(matrix: ScoreMatrixCell[], limit = 5): ScorelineProbability[] {
  return [...matrix].sort((a, b) => b.probability - a.probability).slice(0, limit);
}
