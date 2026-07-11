import type { DecisionActionabilityStatus, DecisionControlStatus } from "@/lib/sports/types";
import type { DecisionOddsBoard, DecisionOddsBoardSelection } from "@/lib/sports/prediction/decisionOddsBoard";
import type { DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";

export type DecisionPortfolioRiskStatus = "paper-ready" | "needs-review" | "blocked";
export type DecisionPortfolioItemAction = "paper-include" | "cap-exposure" | "watch-only" | "exclude";
export type DecisionPortfolioClusterType = "sport" | "market" | "match";
export type DecisionPortfolioClusterStatus = "within-cap" | "capped" | "empty";

export type DecisionPortfolioRiskItem = {
  id: string;
  rank: number;
  sport: DecisionMultiSport;
  matchId: string;
  match: string;
  league: string;
  marketId: string;
  marketName: string;
  selection: string;
  action: DecisionPortfolioItemAction;
  odds: number;
  modelProbability: number;
  noVigImpliedProbability: number;
  edge: number;
  expectedValue: number;
  confidence: string;
  risk: string;
  valueScore: number;
  rawKellyFraction: number;
  paperKellyFraction: number;
  adjustedKellyFraction: number;
  suggestedPaperUnits: number;
  expectedPaperReturnUnits: number;
  sportExposureAfter: number;
  marketExposureAfter: number;
  matchExposureAfter: number;
  capReasons: string[];
  riskControls: string[];
  sizingAudit: {
    rawKellyFraction: number;
    fractionalKellyFraction: number;
    confidenceMultiplier: number;
    riskMultiplier: number;
    controlMultiplier: number;
    actionabilityMultiplier: number;
    qualityMultiplier: number;
    rawUnits: number;
    capLimitedUnits: number;
    finalUnits: number;
    capHaircut: number;
    verdict: "included" | "capped" | "watch-only" | "excluded";
    explanation: string;
  };
  decision: string;
  verifyUrl: string;
};

export type DecisionPortfolioCluster = {
  id: string;
  type: DecisionPortfolioClusterType;
  label: string;
  status: DecisionPortfolioClusterStatus;
  units: number;
  cap: number;
  candidates: number;
};

export type DecisionPortfolioStressScenarioStatus = "survives" | "review" | "fails" | "empty";
export type DecisionPortfolioStressScenario = {
  id: "probability-haircut" | "odds-shortening" | "correlated-loss" | "data-quality-shock";
  label: string;
  status: DecisionPortfolioStressScenarioStatus;
  affectedUnits: number;
  stressedExpectedReturnUnits: number;
  drawdownUnits: number;
  detail: string;
};

export type DecisionPortfolioRisk = {
  generatedAt: string;
  date: string;
  status: DecisionPortfolioRiskStatus;
  portfolioHash: string;
  summary: string;
  budget: {
    paperBankrollUnits: number;
    fractionalKelly: number;
    maxCandidateUnits: number;
    maxSportUnits: number;
    maxMarketUnits: number;
    maxMatchUnits: number;
    suggestedPaperUnits: number;
    expectedPaperReturnUnits: number;
    unallocatedUnits: number;
    riskBudgetUsed: number;
  };
  sizingAudit: {
    includedRawUnits: number;
    includedCapLimitedUnits: number;
    finalPaperUnits: number;
    totalCapHaircutUnits: number;
    averageCapHaircut: number;
    zeroUnitCandidates: number;
    explanation: string;
  };
  totals: {
    candidates: number;
    included: number;
    capped: number;
    watchOnly: number;
    excluded: number;
    highRisk: number;
    blockedControls: number;
    sports: number;
    markets: number;
    matches: number;
  };
  portfolio: DecisionPortfolioRiskItem[];
  exclusions: DecisionPortfolioRiskItem[];
  clusters: DecisionPortfolioCluster[];
  stressTests: DecisionPortfolioStressScenario[];
  policy: {
    canStake: false;
    canPromote: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    rule: string;
    verificationUrl: string;
  };
};

const PAPER_BANKROLL_UNITS = 100;
const FRACTIONAL_KELLY = 0.25;
const MAX_CANDIDATE_UNITS = 1;
const MAX_SPORT_UNITS = 2.5;
const MAX_MARKET_UNITS = 2;
const MAX_MATCH_UNITS = 1.25;
const MIN_VISIBLE_UNITS = 0.05;
const MAX_REVIEW_DRAWDOWN_UNITS = 1.5;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function rawKellyFraction(candidate: DecisionOddsBoardSelection): number {
  const netOdds = candidate.odds - 1;
  if (netOdds <= 0 || candidate.expectedValue <= 0) return 0;
  return Math.max(0, round((netOdds * candidate.modelProbability - (1 - candidate.modelProbability)) / netOdds));
}

function paperKellyFraction(candidate: DecisionOddsBoardSelection): number {
  return round(rawKellyFraction(candidate) * FRACTIONAL_KELLY);
}

function confidenceMultiplier(confidence: string): number {
  if (confidence === "high") return 1;
  if (confidence === "medium") return 0.65;
  return 0.25;
}

function riskMultiplier(risk: string): number {
  if (risk === "low") return 1;
  if (risk === "medium") return 0.6;
  return 0.25;
}

function controlMultiplier(status: DecisionControlStatus): number {
  if (status === "publishable") return 1;
  if (status === "monitor-only") return 0.55;
  if (status === "needs-rerun") return 0.25;
  return 0.15;
}

function actionabilityMultiplier(status: DecisionActionabilityStatus): number {
  if (status === "actionable") return 1;
  if (status === "watch-only") return 0.45;
  return 0.2;
}

function qualityMultiplier(score: number): number {
  return 0.35 + Math.max(0, Math.min(100, score)) * 0.0065;
}

function capRemaining(map: Map<string, number>, key: string, cap: number): number {
  return Math.max(0, cap - (map.get(key) ?? 0));
}

function addExposure(map: Map<string, number>, key: string, units: number): number {
  const next = round((map.get(key) ?? 0) + units, 3);
  map.set(key, next);
  return next;
}

function riskControlsFor(candidate: DecisionOddsBoardSelection): string[] {
  return [
    `control:${candidate.controlStatus}`,
    `actionability:${candidate.actionabilityStatus}`,
    `risk:${candidate.risk}`,
    `confidence:${candidate.confidence}`,
    `data:${candidate.dataQualityScore}/100`,
    `learning:${candidate.learningStatus}`
  ];
}

function exclusionReasons(candidate: DecisionOddsBoardSelection): string[] {
  const reasons: string[] = [];
  if (candidate.action !== "value") reasons.push(`board action is ${candidate.action}`);
  if (candidate.expectedValue <= 0) reasons.push("expected value is not positive");
  if (candidate.edge <= 0) reasons.push("model edge is not positive");
  if (candidate.confidence === "low") reasons.push("confidence is low");
  return reasons;
}

function sortCandidates(candidates: DecisionOddsBoardSelection[]): DecisionOddsBoardSelection[] {
  return candidates.slice().sort((a, b) => {
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
    if (b.edge !== a.edge) return b.edge - a.edge;
    return a.id.localeCompare(b.id);
  });
}

function buildItem({
  candidate,
  action,
  rank,
  rawKelly,
  paperKelly,
  adjustedKelly,
  multipliers,
  rawUnits,
  capLimitedUnits,
  suggestedUnits,
  sportExposureAfter,
  marketExposureAfter,
  matchExposureAfter,
  capReasons
}: {
  candidate: DecisionOddsBoardSelection;
  action: DecisionPortfolioItemAction;
  rank: number;
  rawKelly: number;
  paperKelly: number;
  adjustedKelly: number;
  multipliers: {
    confidence: number;
    risk: number;
    control: number;
    actionability: number;
    quality: number;
  };
  rawUnits: number;
  capLimitedUnits: number;
  suggestedUnits: number;
  sportExposureAfter: number;
  marketExposureAfter: number;
  matchExposureAfter: number;
  capReasons: string[];
}): DecisionPortfolioRiskItem {
  const expectedReturn = round(suggestedUnits * candidate.expectedValue, 3);
  return {
    id: candidate.id,
    rank,
    sport: candidate.sport,
    matchId: candidate.matchId,
    match: candidate.match,
    league: candidate.league,
    marketId: candidate.marketId,
    marketName: candidate.marketName,
    selection: candidate.selection,
    action,
    odds: candidate.odds,
    modelProbability: candidate.modelProbability,
    noVigImpliedProbability: candidate.noVigImpliedProbability,
    edge: candidate.edge,
    expectedValue: candidate.expectedValue,
    confidence: candidate.confidence,
    risk: candidate.risk,
    valueScore: candidate.valueScore,
    rawKellyFraction: rawKelly,
    paperKellyFraction: paperKelly,
    adjustedKellyFraction: adjustedKelly,
    suggestedPaperUnits: suggestedUnits,
    expectedPaperReturnUnits: expectedReturn,
    sportExposureAfter,
    marketExposureAfter,
    matchExposureAfter,
    capReasons,
    riskControls: riskControlsFor(candidate),
    sizingAudit: {
      rawKellyFraction: rawKelly,
      fractionalKellyFraction: paperKelly,
      confidenceMultiplier: multipliers.confidence,
      riskMultiplier: multipliers.risk,
      controlMultiplier: multipliers.control,
      actionabilityMultiplier: multipliers.actionability,
      qualityMultiplier: multipliers.quality,
      rawUnits,
      capLimitedUnits,
      finalUnits: suggestedUnits,
      capHaircut: rawUnits > 0 ? round(1 - suggestedUnits / rawUnits) : 0,
      verdict: action === "paper-include" ? "included" : action === "cap-exposure" ? "capped" : action === "watch-only" ? "watch-only" : "excluded",
      explanation:
        action === "paper-include"
          ? `Raw Kelly ${round(rawKelly * 100, 2)}%, fractional Kelly ${round(paperKelly * 100, 2)}%, then risk/control/data haircuts leave ${suggestedUnits.toFixed(2)} paper unit(s).`
          : action === "cap-exposure"
            ? `Sizing was reduced by caps or risk controls: ${capReasons.join(", ")}. Final paper units ${suggestedUnits.toFixed(2)}.`
            : `Sizing is zero because ${capReasons.join(", ") || "the candidate did not clear the visible paper-unit threshold"}.`
    },
    decision:
      action === "paper-include" || action === "cap-exposure"
        ? compact(`Paper exposure only: ${suggestedUnits.toFixed(2)} unit(s). ${candidate.whyModelLikesIt}`, 260)
        : compact(candidate.avoidReason ?? candidate.riskNote, 240),
    verifyUrl: candidate.verifyUrl
  };
}

function clusterFrom(map: Map<string, number>, type: DecisionPortfolioClusterType, cap: number): DecisionPortfolioCluster[] {
  return Array.from(map.entries())
    .map(([id, units]) => {
      const status: DecisionPortfolioClusterStatus = units >= cap ? "capped" : units > 0 ? "within-cap" : "empty";
      return {
        id: `${type}:${id}`,
        type,
        label: id,
        status,
        units: round(units, 3),
        cap,
        candidates: 0
      };
    })
    .sort((a, b) => b.units - a.units || a.label.localeCompare(b.label));
}

function stressStatus(expectedReturn: number, drawdown: number): DecisionPortfolioStressScenarioStatus {
  if (drawdown <= 0 && expectedReturn >= 0) return "survives";
  if (drawdown > MAX_REVIEW_DRAWDOWN_UNITS || expectedReturn < -MAX_REVIEW_DRAWDOWN_UNITS) return "fails";
  if (expectedReturn < 0 || drawdown > MAX_MATCH_UNITS) return "review";
  return "survives";
}

function buildStressTests({
  portfolio,
  sportExposure,
  marketExposure,
  matchExposure
}: {
  portfolio: DecisionPortfolioRiskItem[];
  sportExposure: Map<string, number>;
  marketExposure: Map<string, number>;
  matchExposure: Map<string, number>;
}): DecisionPortfolioStressScenario[] {
  const affectedUnits = round(portfolio.reduce((sum, item) => sum + item.suggestedPaperUnits, 0), 3);
  if (!portfolio.length || affectedUnits <= 0) {
    return [
      {
        id: "probability-haircut",
        label: "Probability haircut",
        status: "empty",
        affectedUnits: 0,
        stressedExpectedReturnUnits: 0,
        drawdownUnits: 0,
        detail: "No paper exposure survived the portfolio filters, so stress testing has nothing to size."
      }
    ];
  }

  const probabilityHaircutReturn = round(
    portfolio.reduce((sum, item) => sum + item.suggestedPaperUnits * (Math.max(0, item.modelProbability * 0.9) * item.odds - 1), 0),
    3
  );
  const oddsShorteningReturn = round(
    portfolio.reduce((sum, item) => sum + item.suggestedPaperUnits * (item.modelProbability * Math.max(1.01, item.odds * 0.95) - 1), 0),
    3
  );
  const maxSportLoss = Math.max(0, ...Array.from(sportExposure.values()));
  const maxMarketLoss = Math.max(0, ...Array.from(marketExposure.values()));
  const maxMatchLoss = Math.max(0, ...Array.from(matchExposure.values()));
  const correlatedLoss = round(Math.max(maxSportLoss, maxMarketLoss, maxMatchLoss), 3);
  const weakControlUnits = round(
    portfolio
      .filter((item) => item.riskControls.some((control) => /data:[0-6][0-9]\/100|control:blocked|actionability:blocked|learning:not-configured/i.test(control)))
      .reduce((sum, item) => sum + item.suggestedPaperUnits, 0),
    3
  );
  const dataQualityShockReturn = round(
    portfolio.reduce((sum, item) => {
      const weakControl = item.riskControls.some((control) => /data:[0-6][0-9]\/100|learning:not-configured/i.test(control));
      const multiplier = weakControl ? 0.75 : 0.9;
      return sum + item.suggestedPaperUnits * (Math.max(0, item.modelProbability * multiplier) * item.odds - 1);
    }, 0),
    3
  );

  return [
    {
      id: "probability-haircut",
      label: "10% model probability haircut",
      status: stressStatus(probabilityHaircutReturn, Math.max(0, -probabilityHaircutReturn)),
      affectedUnits,
      stressedExpectedReturnUnits: probabilityHaircutReturn,
      drawdownUnits: round(Math.max(0, -probabilityHaircutReturn), 3),
      detail: "Reprices every paper candidate after reducing model probability by 10% to test overconfidence."
    },
    {
      id: "odds-shortening",
      label: "5% odds shortening",
      status: stressStatus(oddsShorteningReturn, Math.max(0, -oddsShorteningReturn)),
      affectedUnits,
      stressedExpectedReturnUnits: oddsShorteningReturn,
      drawdownUnits: round(Math.max(0, -oddsShorteningReturn), 3),
      detail: "Recalculates expected return after prices shorten by 5%, simulating missed market timing."
    },
    {
      id: "correlated-loss",
      label: "Worst correlated cluster loss",
      status: stressStatus(-correlatedLoss, correlatedLoss),
      affectedUnits: correlatedLoss,
      stressedExpectedReturnUnits: round(-correlatedLoss, 3),
      drawdownUnits: correlatedLoss,
      detail: "Assumes the largest sport, market, or match cluster loses together and checks exposure caps."
    },
    {
      id: "data-quality-shock",
      label: "Data quality shock",
      status: stressStatus(dataQualityShockReturn, Math.max(weakControlUnits, -dataQualityShockReturn)),
      affectedUnits: weakControlUnits,
      stressedExpectedReturnUnits: dataQualityShockReturn,
      drawdownUnits: round(Math.max(weakControlUnits, -dataQualityShockReturn), 3),
      detail: "Haircuts candidates with weak data, blocked controls, or unconfigured learning more aggressively than clean candidates."
    }
  ];
}

export function buildDecisionPortfolioRisk({
  board,
  limit = 12
}: {
  board: DecisionOddsBoard;
  limit?: number;
}): DecisionPortfolioRisk {
  const sportExposure = new Map<string, number>();
  const marketExposure = new Map<string, number>();
  const matchExposure = new Map<string, number>();
  const portfolio: DecisionPortfolioRiskItem[] = [];
  const exclusions: DecisionPortfolioRiskItem[] = [];
  const candidates = sortCandidates(board.selections);

  for (const candidate of candidates) {
    const rank = portfolio.length + exclusions.length + 1;
    const exclusion = exclusionReasons(candidate);
    const rawKelly = rawKellyFraction(candidate);
    const paperKelly = round(rawKelly * FRACTIONAL_KELLY);
    const multipliers = {
      confidence: confidenceMultiplier(candidate.confidence),
      risk: riskMultiplier(candidate.risk),
      control: controlMultiplier(candidate.controlStatus),
      actionability: actionabilityMultiplier(candidate.actionabilityStatus),
      quality: qualityMultiplier(candidate.dataQualityScore)
    };
    const adjustedKelly = round(
      paperKelly *
        multipliers.confidence *
        multipliers.risk *
        multipliers.control *
        multipliers.actionability *
        multipliers.quality
    );
    const rawUnits = round(PAPER_BANKROLL_UNITS * adjustedKelly, 3);
    const capReasons = [...exclusion];
    const sportKey = candidate.sport;
    const marketKey = `${candidate.sport}:${candidate.marketId}`;
    const matchKey = candidate.matchId;
    const sportRemaining = capRemaining(sportExposure, sportKey, MAX_SPORT_UNITS);
    const marketRemaining = capRemaining(marketExposure, marketKey, MAX_MARKET_UNITS);
    const matchRemaining = capRemaining(matchExposure, matchKey, MAX_MATCH_UNITS);
    const capLimitedUnits = round(Math.min(rawUnits, MAX_CANDIDATE_UNITS, sportRemaining, marketRemaining, matchRemaining), 3);
    let suggestedUnits = capLimitedUnits;

    if (rawUnits > MAX_CANDIDATE_UNITS) capReasons.push("candidate cap");
    if (rawUnits > sportRemaining) capReasons.push("sport cap");
    if (rawUnits > marketRemaining) capReasons.push("market cap");
    if (rawUnits > matchRemaining) capReasons.push("match cap");
    if (candidate.risk === "high") capReasons.push("high-risk haircut");
    if (candidate.controlStatus !== "publishable") capReasons.push(`control ${candidate.controlStatus}`);
    if (candidate.actionabilityStatus !== "actionable") capReasons.push(`actionability ${candidate.actionabilityStatus}`);

    if (exclusion.length || suggestedUnits < MIN_VISIBLE_UNITS) {
      suggestedUnits = 0;
      exclusions.push(
        buildItem({
          candidate,
          action: exclusion.length ? "exclude" : "watch-only",
          rank,
          rawKelly,
          paperKelly,
          adjustedKelly,
          multipliers,
          rawUnits,
          capLimitedUnits,
          suggestedUnits,
          sportExposureAfter: sportExposure.get(sportKey) ?? 0,
          marketExposureAfter: marketExposure.get(marketKey) ?? 0,
          matchExposureAfter: matchExposure.get(matchKey) ?? 0,
          capReasons: capReasons.length ? capReasons : ["paper unit estimate is below the visible minimum"]
        })
      );
      continue;
    }

    const sportExposureAfter = addExposure(sportExposure, sportKey, suggestedUnits);
    const marketExposureAfter = addExposure(marketExposure, marketKey, suggestedUnits);
    const matchExposureAfter = addExposure(matchExposure, matchKey, suggestedUnits);
    const action: DecisionPortfolioItemAction = capReasons.length ? "cap-exposure" : "paper-include";
    portfolio.push(
      buildItem({
        candidate,
        action,
        rank,
        rawKelly,
        paperKelly,
        adjustedKelly,
        multipliers,
        rawUnits,
        capLimitedUnits,
        suggestedUnits: round(suggestedUnits, 3),
        sportExposureAfter,
        marketExposureAfter,
        matchExposureAfter,
        capReasons
      })
    );
  }

  const visiblePortfolio = portfolio.slice(0, Math.max(1, Math.min(30, limit)));
  const visibleExclusions = exclusions.slice(0, Math.max(1, Math.min(30, limit)));
  const suggestedPaperUnits = round(portfolio.reduce((sum, item) => sum + item.suggestedPaperUnits, 0), 3);
  const expectedPaperReturnUnits = round(portfolio.reduce((sum, item) => sum + item.expectedPaperReturnUnits, 0), 3);
  const includedRawUnits = round(portfolio.reduce((sum, item) => sum + item.sizingAudit.rawUnits, 0), 3);
  const includedCapLimitedUnits = round(portfolio.reduce((sum, item) => sum + item.sizingAudit.capLimitedUnits, 0), 3);
  const totalCapHaircutUnits = round(Math.max(0, includedRawUnits - suggestedPaperUnits), 3);
  const averageCapHaircut = portfolio.length ? round(portfolio.reduce((sum, item) => sum + item.sizingAudit.capHaircut, 0) / portfolio.length) : 0;
  const capped = portfolio.filter((item) => item.action === "cap-exposure").length;
  const clusters = [
    ...clusterFrom(sportExposure, "sport", MAX_SPORT_UNITS),
    ...clusterFrom(marketExposure, "market", MAX_MARKET_UNITS),
    ...clusterFrom(matchExposure, "match", MAX_MATCH_UNITS)
  ].slice(0, 14);
  const stressTests = buildStressTests({ portfolio, sportExposure, marketExposure, matchExposure });
  const stressFailures = stressTests.filter((scenario) => scenario.status === "fails").length;
  const stressReviews = stressTests.filter((scenario) => scenario.status === "review").length;
  const stressAdjustedStatus: DecisionPortfolioRiskStatus =
    !portfolio.length ? "blocked" : stressFailures || capped > 0 || stressReviews || exclusions.length > portfolio.length ? "needs-review" : "paper-ready";
  const portfolioHash = stableHash({
    date: board.date,
    status: stressAdjustedStatus,
    portfolio: portfolio.map((item) => [item.id, item.action, item.suggestedPaperUnits, item.expectedPaperReturnUnits, item.capReasons]),
    stressTests: stressTests.map((scenario) => [scenario.id, scenario.status, scenario.stressedExpectedReturnUnits, scenario.drawdownUnits])
  });

  return {
    generatedAt: new Date().toISOString(),
    date: board.date,
    status: stressAdjustedStatus,
    portfolioHash,
    summary: portfolio.length
      ? `Portfolio risk is ${stressAdjustedStatus}; ${portfolio.length} paper exposure candidate(s), ${capped} capped, ${stressFailures} stress failure(s), ${stressReviews} stress review(s), ${exclusions.length} excluded or watch-only, expected paper return ${expectedPaperReturnUnits.toFixed(
          2
        )} unit(s).`
      : "Portfolio risk is blocked because no value candidate survived EV, edge, confidence, control, and actionability filters.",
    budget: {
      paperBankrollUnits: PAPER_BANKROLL_UNITS,
      fractionalKelly: FRACTIONAL_KELLY,
      maxCandidateUnits: MAX_CANDIDATE_UNITS,
      maxSportUnits: MAX_SPORT_UNITS,
      maxMarketUnits: MAX_MARKET_UNITS,
      maxMatchUnits: MAX_MATCH_UNITS,
      suggestedPaperUnits,
      expectedPaperReturnUnits,
      unallocatedUnits: round(PAPER_BANKROLL_UNITS - suggestedPaperUnits, 3),
      riskBudgetUsed: round(suggestedPaperUnits / PAPER_BANKROLL_UNITS)
    },
    sizingAudit: {
      includedRawUnits,
      includedCapLimitedUnits,
      finalPaperUnits: suggestedPaperUnits,
      totalCapHaircutUnits,
      averageCapHaircut,
      zeroUnitCandidates: exclusions.filter((item) => item.suggestedPaperUnits === 0).length,
      explanation: portfolio.length
        ? `Sizing starts with raw Kelly, applies ${FRACTIONAL_KELLY} fractional Kelly, confidence/risk/control/data haircuts, then caps exposure by candidate, sport, market, and match.`
        : "No candidate survived the sizing audit, so all paper exposure remains zero."
    },
    totals: {
      candidates: candidates.length,
      included: portfolio.filter((item) => item.action === "paper-include").length,
      capped,
      watchOnly: exclusions.filter((item) => item.action === "watch-only").length,
      excluded: exclusions.filter((item) => item.action === "exclude").length,
      highRisk: candidates.filter((candidate) => candidate.risk === "high").length,
      blockedControls: candidates.filter((candidate) => candidate.controlStatus === "blocked" || candidate.actionabilityStatus === "blocked").length,
      sports: new Set(candidates.map((candidate) => candidate.sport)).size,
      markets: new Set(candidates.map((candidate) => `${candidate.sport}:${candidate.marketId}`)).size,
      matches: new Set(candidates.map((candidate) => candidate.matchId)).size
    },
    portfolio: visiblePortfolio,
    exclusions: visibleExclusions,
    clusters,
    stressTests,
    policy: {
      canStake: false,
      canPromote: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule: "Portfolio risk is paper-only decision pressure. It is not staking, bankroll, financial, or gambling advice, and it cannot publish or persist picks.",
      verificationUrl: `/api/sports/decision/portfolio-risk?date=${encodeURIComponent(board.date)}`
    }
  };
}
