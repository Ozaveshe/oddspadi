import { calculateExpectedValue } from "@/lib/sports/prediction/odds";
import type { PredictionOutcomeInput, PredictionOutcomeResult } from "@/lib/sports/prediction/decisionOutcomes";
import type { Sport } from "@/lib/sports/types";

export type OutcomeSettlementStatus = "graded" | "unsupported" | "invalid";

export type OutcomeSettlementInput = {
  decisionRunId?: string | null;
  fixtureExternalId: string;
  sport: Sport;
  market: string;
  selection: string;
  homeScore: number;
  awayScore: number;
  line?: number | null;
  modelProbability?: number | null;
  impliedProbability?: number | null;
  valueEdge?: number | null;
  odds?: number | null;
  closingOdds?: number | null;
  settledAt?: string | null;
  source?: string;
  metadata?: Record<string, unknown>;
};

export type OutcomeSettlementPreview = {
  generatedAt: string;
  mode: "decision-outcome-settlement";
  status: OutcomeSettlementStatus;
  summary: string;
  input: OutcomeSettlementInput;
  result: PredictionOutcomeResult | null;
  settlement: {
    market: string;
    selection: string;
    line: number | null;
    totalScore: number;
    scoreMargin: number;
    roiUnits: number | null;
    brierScore: number | null;
    expectedValue: number | null;
    closingLineValue: number | null;
  };
  outcomeInput: PredictionOutcomeInput | null;
  reasons: string[];
  controls: {
    canPreview: true;
    canPersist: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
  };
  proofUrls: string[];
};

const TOTAL_MARKETS = new Set(["over_under_25", "total_points", "total_games"]);
const SPREAD_MARKETS = new Set(["spread", "set_handicap"]);

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round(value: number | null, digits = 6): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_").replace(/-/g, "_");
}

function compare(value: number, threshold: number): "over" | "under" | "push" {
  if (value > threshold) return "over";
  if (value < threshold) return "under";
  return "push";
}

function winLossPush(won: boolean, pushed = false): PredictionOutcomeResult {
  if (pushed) return "push";
  return won ? "won" : "lost";
}

function gradeMatchWinner(selection: string, homeScore: number, awayScore: number): PredictionOutcomeResult | null {
  const selected = normalize(selection);
  const actual = homeScore > awayScore ? "home" : awayScore > homeScore ? "away" : "draw";
  if (!["home", "away", "draw"].includes(selected)) return null;
  return selected === actual ? "won" : "lost";
}

function gradeBothTeamsToScore(selection: string, homeScore: number, awayScore: number): PredictionOutcomeResult | null {
  const selected = normalize(selection);
  const bothScored = homeScore > 0 && awayScore > 0;
  if (selected === "yes" || selected === "btts_yes") return bothScored ? "won" : "lost";
  if (selected === "no" || selected === "btts_no") return bothScored ? "lost" : "won";
  return null;
}

function gradeTotal(selection: string, homeScore: number, awayScore: number, line: number | null): PredictionOutcomeResult | null {
  if (line === null) return null;
  const selected = normalize(selection);
  const total = homeScore + awayScore;
  const side = compare(total, line);
  if (side === "push") return "push";
  if (selected.startsWith("over")) return side === "over" ? "won" : "lost";
  if (selected.startsWith("under")) return side === "under" ? "won" : "lost";
  return null;
}

function gradeSpread(selection: string, homeScore: number, awayScore: number, line: number | null): PredictionOutcomeResult | null {
  if (line === null) return null;
  const selected = normalize(selection);
  const margin = homeScore - awayScore;
  const threshold = Math.abs(line);
  if (selected.includes("home")) return winLossPush(margin > threshold, margin === threshold);
  if (selected.includes("away")) return winLossPush(margin < threshold, margin === threshold);
  return null;
}

function gradeOutcome(input: OutcomeSettlementInput): { result: PredictionOutcomeResult | null; reasons: string[]; line: number | null } {
  const market = normalize(input.market);
  const line = finiteNumber(input.line) ?? (market === "over_under_25" ? 2.5 : null);
  const reasons: string[] = [];
  let result: PredictionOutcomeResult | null = null;

  if (market === "match_winner" || market === "moneyline") {
    result = gradeMatchWinner(input.selection, input.homeScore, input.awayScore);
    reasons.push("Match winner is graded from final home/away score.");
  } else if (market === "both_teams_to_score") {
    result = gradeBothTeamsToScore(input.selection, input.homeScore, input.awayScore);
    reasons.push("BTTS is graded from whether both teams scored at least once.");
  } else if (TOTAL_MARKETS.has(market)) {
    result = gradeTotal(input.selection, input.homeScore, input.awayScore, line);
    reasons.push(line === null ? "Total market needs a line before grading." : `Total market is graded against line ${line}.`);
  } else if (SPREAD_MARKETS.has(market)) {
    result = gradeSpread(input.selection, input.homeScore, input.awayScore, line);
    reasons.push(line === null ? "Spread or set-handicap market needs a line before grading." : `Spread/set handicap is graded against line ${Math.abs(line)}.`);
  } else {
    reasons.push(`Unsupported market: ${input.market}.`);
  }

  if (!result) reasons.push(`Unsupported selection ${input.selection} for market ${input.market}.`);
  return { result, reasons, line };
}

function unitReturn(result: PredictionOutcomeResult | null, odds: number | null): number | null {
  if (!result) return null;
  if (result === "won") return round(Math.max(0, odds ?? 0) - 1);
  if (result === "lost") return -1;
  return 0;
}

function brierScore(result: PredictionOutcomeResult | null, modelProbability: number | null): number | null {
  if (result !== "won" && result !== "lost") return null;
  if (modelProbability === null) return null;
  const actual = result === "won" ? 1 : 0;
  return round((modelProbability - actual) ** 2);
}

function closingLineValue(odds: number | null, closingOdds: number | null): number | null {
  if (!odds || !closingOdds || closingOdds <= 0) return null;
  return round(odds / closingOdds - 1);
}

function summaryFor(status: OutcomeSettlementStatus, input: OutcomeSettlementInput, result: PredictionOutcomeResult | null): string {
  if (status === "invalid") return "Outcome settlement input is invalid.";
  if (status === "unsupported") return `Outcome settlement cannot grade ${input.market}:${input.selection} yet.`;
  return `Outcome settlement graded ${input.market}:${input.selection} as ${result}.`;
}

export function buildDecisionOutcomeSettlement(input: OutcomeSettlementInput, now = new Date()): OutcomeSettlementPreview {
  const homeScore = finiteNumber(input.homeScore);
  const awayScore = finiteNumber(input.awayScore);
  const modelProbability = finiteNumber(input.modelProbability);
  const odds = finiteNumber(input.odds);
  const closingOdds = finiteNumber(input.closingOdds);
  const impliedProbability = finiteNumber(input.impliedProbability);
  const valueEdge = finiteNumber(input.valueEdge);

  if (!input.fixtureExternalId.trim() || !input.market.trim() || !input.selection.trim() || homeScore === null || awayScore === null) {
    const invalid: OutcomeSettlementPreview = {
      generatedAt: now.toISOString(),
      mode: "decision-outcome-settlement",
      status: "invalid",
      summary: "Outcome settlement input is invalid.",
      input,
      result: null,
      settlement: {
        market: input.market,
        selection: input.selection,
        line: finiteNumber(input.line),
        totalScore: 0,
        scoreMargin: 0,
        roiUnits: null,
        brierScore: null,
        expectedValue: null,
        closingLineValue: null
      },
      outcomeInput: null,
      reasons: ["fixtureExternalId, market, selection, homeScore, and awayScore are required."],
      controls: {
        canPreview: true,
        canPersist: false,
        canTrainModels: false,
        canPublishPicks: false,
        canStake: false,
        canUseHiddenChainOfThought: false
      },
      proofUrls: ["/api/sports/decision/outcome-settlement", "/api/sports/decision/outcomes", "/api/sports/decision/calibration"]
    };
    return invalid;
  }

  const graded = gradeOutcome({ ...input, homeScore, awayScore });
  const status: OutcomeSettlementStatus = graded.result ? "graded" : "unsupported";
  const outcomeInput: PredictionOutcomeInput | null = graded.result
    ? {
        decisionRunId: input.decisionRunId ?? null,
        fixtureExternalId: input.fixtureExternalId,
        sport: input.sport,
        market: input.market,
        selection: input.selection,
        modelProbability,
        impliedProbability,
        valueEdge,
        odds,
        closingOdds,
        result: graded.result,
        settledAt: input.settledAt ?? now.toISOString(),
        source: input.source ?? "settlement-preview",
        metadata: {
          ...(input.metadata ?? {}),
          homeScore,
          awayScore,
          line: graded.line,
          settlementMode: "deterministic-score-grader"
        }
      }
    : null;

  return {
    generatedAt: now.toISOString(),
    mode: "decision-outcome-settlement",
    status,
    summary: summaryFor(status, input, graded.result),
    input: { ...input, homeScore, awayScore, line: graded.line },
    result: graded.result,
    settlement: {
      market: input.market,
      selection: input.selection,
      line: graded.line,
      totalScore: homeScore + awayScore,
      scoreMargin: homeScore - awayScore,
      roiUnits: unitReturn(graded.result, odds),
      brierScore: brierScore(graded.result, modelProbability),
      expectedValue: odds ? round(calculateExpectedValue(modelProbability ?? 0, odds)) : null,
      closingLineValue: closingLineValue(odds, closingOdds)
    },
    outcomeInput,
    reasons: graded.reasons,
    controls: {
      canPreview: true,
      canPersist: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: ["/api/sports/decision/outcome-settlement", "/api/sports/decision/outcomes", "/api/sports/decision/calibration"]
  };
}
