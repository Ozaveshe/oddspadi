import type {
  BestPickResult,
  DecisionCaseMemoryBank,
  DecisionCaseMemoryRun,
  DecisionLearningProfile,
  FootballModelDiagnostics,
  MarketPriorAdjustment,
  OddsMarket,
  PredictionMarket,
  ValueEdge
} from "@/lib/sports/types";
import { confidenceFromEdgeAndProbability, riskLevelFromConfidenceAndOdds } from "./confidence";

export function clampProbability(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function decimalOddsToImpliedProbability(odds: number): number {
  if (odds <= 1) return 1;
  return clampProbability(1 / odds);
}

export function normalizeImpliedProbabilities(probabilities: number[]): number[] {
  const total = probabilities.reduce((sum, probability) => sum + probability, 0);
  if (total <= 0) return probabilities.map(() => 0);
  return probabilities.map((probability) => clampProbability(probability / total));
}

export function calculateBookmakerMargin(probabilities: number[]): number {
  return probabilities.reduce((sum, probability) => sum + clampProbability(probability), 0) - 1;
}

export function removeBookmakerMargin(probabilities: number[]): number[] {
  return normalizeImpliedProbabilities(probabilities);
}

export function calculateValueEdge(modelProbability: number, impliedProbability: number): number {
  return clampProbability(modelProbability) - clampProbability(impliedProbability);
}

export function calculateExpectedValue(modelProbability: number, odds: number): number {
  const probability = clampProbability(modelProbability);
  if (odds <= 1) return -1;
  return probability * odds - 1;
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function learnedWeight(
  learningProfile: DecisionLearningProfile | undefined,
  key: "minimumEdge" | "valueEdgeWeight" | "dataQualityWeight" | "marketAdjustmentWeight",
  fallback: number,
  min: number,
  max: number
): number {
  if (!learningProfile?.active) return fallback;
  const value = learningProfile[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clampRange(value, min, max);
}

function confidenceMultiplier(confidence: ValueEdge["confidence"]): number {
  if (confidence === "high") return 1.15;
  if (confidence === "medium") return 1;
  return 0.62;
}

function riskPenalty(risk: ValueEdge["risk"]): number {
  if (risk === "high") return 0.14;
  if (risk === "medium") return 0.045;
  return 0;
}

function oddsVolatilityPenalty(odds: number): number {
  return round(clampRange(Math.max(0, odds - 3.2) * 0.07, 0, 0.24));
}

function fairOddsForProbability(probability: number): number | null {
  const value = clampProbability(probability);
  return value > 0 ? 1 / value : null;
}

function priceShorteningTolerance(edge: ValueEdge): number | null {
  const fairOdds = fairOddsForProbability(edge.modelProbability);
  if (fairOdds === null || edge.odds <= 1) return null;
  return round(clampRange(1 - fairOdds / edge.odds, 0, 0.95));
}

function edgeAfterOddsShortening(edge: ValueEdge, shortening: number): number {
  const movedOdds = Math.max(1.01, edge.odds * (1 - shortening));
  const movedRawImplied = 1 / movedOdds;
  const currentRawTotal = Math.max(edge.rawImpliedProbability, 1 + edge.bookmakerMargin);
  const otherSelectionsRaw = Math.max(0, currentRawTotal - edge.rawImpliedProbability);
  const movedNoVigImplied =
    movedRawImplied + otherSelectionsRaw > 0 ? movedRawImplied / (movedRawImplied + otherSelectionsRaw) : movedRawImplied;
  return edge.modelProbability - movedNoVigImplied;
}

function priceFragilityPenalty(edge: ValueEdge): { tolerance: number | null; penalty: number } {
  const tolerance = priceShorteningTolerance(edge);
  if (tolerance === null) return { tolerance, penalty: 0.14 };

  const fivePercentExpectedValue = edge.modelProbability * edge.odds * 0.95 - 1;
  const fivePercentEdge = edgeAfterOddsShortening(edge, 0.05);
  const tolerancePenalty = clampRange((0.08 - tolerance) * 1.15, 0, 0.12);
  const evBreakPenalty = fivePercentExpectedValue <= 0 ? 0.055 : fivePercentExpectedValue < 0.03 ? 0.025 : 0;
  const edgeBreakPenalty = fivePercentEdge <= 0 ? 0.04 : fivePercentEdge < 0.02 ? 0.018 : 0;

  return {
    tolerance,
    penalty: round(clampRange(tolerancePenalty + evBreakPenalty + edgeBreakPenalty, 0, 0.19))
  };
}

export type BestPickSelectionOptions = {
  learningProfile?: DecisionLearningProfile;
  caseMemoryBank?: DecisionCaseMemoryBank;
};

export function learnedMinimumEdge(options: BestPickSelectionOptions = {}): number | null {
  if (!options.learningProfile?.active) return null;
  return learnedWeight(options.learningProfile, "minimumEdge", 0.035, 0.02, 0.09);
}

function similarityFromDifference(a: number, b: number, tolerance: number): number {
  return clampRange(1 - Math.abs(a - b) / tolerance, 0, 1);
}

function valueEdgeCaseSimilarity(edge: ValueEdge, run: DecisionCaseMemoryRun): number {
  if (!run.bestPick.hasValue) return 0;

  const parts = [
    { weight: 0.18, score: edge.marketId === run.bestPick.marketId ? 1 : 0.1 },
    { weight: 0.12, score: edge.selectionId === run.bestPick.selectionId || edge.label === run.bestPick.label ? 1 : 0.25 },
    { weight: 0.18, score: similarityFromDifference(edge.modelProbability, run.bestPick.modelProbability, 0.16) },
    { weight: 0.18, score: similarityFromDifference(edge.edge, run.bestPick.edge, 0.12) },
    { weight: 0.18, score: similarityFromDifference(edge.expectedValue, run.bestPick.expectedValue, 0.2) },
    { weight: 0.08, score: edge.confidence === run.confidence ? 1 : 0.35 },
    { weight: 0.08, score: edge.risk === run.risk ? 1 : 0.35 }
  ];
  const totalWeight = parts.reduce((sum, item) => sum + item.weight, 0);
  return round(parts.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight, 3);
}

function caseMemoryPressure(edge: ValueEdge, options: BestPickSelectionOptions): {
  penalty: number;
  similarity: number | null;
  avoidShare: number | null;
  reliability: number | null;
} {
  const bank = options.caseMemoryBank;
  if (bank?.status !== "ready" || !bank.runs.length) {
    return { penalty: 0, similarity: null, avoidShare: null, reliability: null };
  }

  const similar = bank.runs
    .map((run) => ({ run, similarity: valueEdgeCaseSimilarity(edge, run) }))
    .filter((item) => item.run.bestPick.hasValue && (item.run.bestPick.selectionId === edge.selectionId || item.run.bestPick.label === edge.label))
    .filter((item) => item.similarity >= 0.58)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, 5);

  if (!similar.length) return { penalty: 0, similarity: null, avoidShare: null, reliability: null };

  const totalSimilarity = similar.reduce((sum, item) => sum + item.similarity, 0);
  const weighted = (predicate: (run: DecisionCaseMemoryRun) => boolean) =>
    totalSimilarity > 0 ? similar.reduce((sum, item) => sum + (predicate(item.run) ? item.similarity : 0), 0) / totalSimilarity : 0;
  const avoidShare = weighted((run) => run.action === "avoid");
  const monitorShare = weighted((run) => run.action === "monitor");
  const fragileShare = weighted((run) => run.health === "fragile");
  const reliabilityRows = similar.filter((item) => typeof item.run.reliabilityScore === "number");
  const reliability =
    reliabilityRows.length > 0
      ? reliabilityRows.reduce((sum, item) => sum + (item.run.reliabilityScore ?? 0) * item.similarity, 0) /
        reliabilityRows.reduce((sum, item) => sum + item.similarity, 0)
      : null;
  const reliabilityPenalty = reliability === null ? 0.025 : clampRange((55 - reliability) / 100, 0, 0.22);
  const penalty = round(clampRange(avoidShare * 0.18 + monitorShare * 0.035 + fragileShare * 0.06 + reliabilityPenalty, 0, 0.36));

  return {
    penalty,
    similarity: round(totalSimilarity / similar.length, 3),
    avoidShare: round(avoidShare, 3),
    reliability: reliability === null ? null : Math.round(reliability)
  };
}

export function scoreValueEdge(edge: ValueEdge, options: BestPickSelectionOptions = {}): {
  score: number;
  components: NonNullable<ValueEdge["scoreComponents"]>;
} {
  const minimumEdge = learnedMinimumEdge(options);
  const valueEdgeWeight = options.learningProfile?.active
    ? learnedWeight(options.learningProfile, "valueEdgeWeight", 0.32, 0.18, 0.7)
    : null;
  const dataQualityWeight = options.learningProfile?.active
    ? learnedWeight(options.learningProfile, "dataQualityWeight", 0.18, 0.14, 0.3)
    : null;
  const marketAdjustmentWeight = options.learningProfile?.active
    ? learnedWeight(options.learningProfile, "marketAdjustmentWeight", 0.14, 0.08, 0.24)
    : null;
  const valueWeight = valueEdgeWeight ?? 0.32;
  const dataWeight = dataQualityWeight ?? 0.18;
  const marketWeight = marketAdjustmentWeight ?? 0.14;
  const memoryPressure = caseMemoryPressure(edge, options);
  const pricePressure = priceFragilityPenalty(edge);
  const components = {
    expectedValue: round(Math.max(0, edge.expectedValue) * confidenceMultiplier(edge.confidence) * (0.78 + valueWeight)),
    edge: round(Math.max(0, edge.edge) * (0.65 + valueWeight)),
    probabilityStability: round(clampProbability(edge.modelProbability) * (0.05 + dataWeight * 0.18)),
    confidenceMultiplier: confidenceMultiplier(edge.confidence),
    bookmakerMarginPenalty: round(clampRange(Math.max(0, edge.bookmakerMargin) * (0.42 + marketWeight), 0, 0.18)),
    oddsVolatilityPenalty: oddsVolatilityPenalty(edge.odds),
    priceShorteningTolerance: pricePressure.tolerance,
    priceFragilityPenalty: pricePressure.penalty,
    riskPenalty: round(riskPenalty(edge.risk) * (1 + dataWeight * 0.8)),
    caseMemoryPenalty: memoryPressure.penalty,
    caseMemorySimilarity: memoryPressure.similarity,
    caseMemoryAvoidShare: memoryPressure.avoidShare,
    caseMemoryReliability: memoryPressure.reliability,
    learnedMinimumEdge: minimumEdge,
    learnedValueEdgeWeight: valueEdgeWeight,
    learnedDataQualityWeight: dataQualityWeight,
    learnedMarketAdjustmentWeight: marketAdjustmentWeight
  };
  const score =
    components.expectedValue +
    components.edge +
    components.probabilityStability -
    components.bookmakerMarginPenalty -
    components.oddsVolatilityPenalty -
    components.priceFragilityPenalty -
    components.riskPenalty -
    components.caseMemoryPenalty;

  return {
    score: round(score),
    components
  };
}

export type MarketPriorEvidencePolicy = {
  minimumWeight: number;
  reason: string;
};

function marketPriorWeight(
  dataQuality: number,
  bookmakerMargin: number,
  selectionCount: number,
  evidencePolicy?: MarketPriorEvidencePolicy
): number {
  const quality = clampProbability(dataQuality);
  const qualityWeight = 0.08 + (1 - quality) * 0.16;
  const marginDiscount = clampRange(1 - Math.max(0, bookmakerMargin) / 0.18, 0.25, 1);
  const selectionDepth = selectionCount >= 3 ? 1 : 0.92;
  const standardWeight = qualityWeight * marginDiscount * selectionDepth;
  const coherentMarket = bookmakerMargin >= -0.03 && bookmakerMargin <= 0.12;
  const evidenceMarketReliability = bookmakerMargin <= 0.08
    ? 1
    : clampRange(1 - (bookmakerMargin - 0.08) / 0.05, 0.25, 1);
  const evidenceFloor = coherentMarket && evidencePolicy
    ? clampProbability(evidencePolicy.minimumWeight) * evidenceMarketReliability * selectionDepth
    : 0;
  return round(clampRange(Math.max(standardWeight, evidenceFloor), 0.03, 0.9));
}

function normalizeSelectionSubset(probabilities: Record<string, number>, selectionIds: string[]): Record<string, number> {
  const total = selectionIds.reduce((sum, id) => sum + clampProbability(probabilities[id] ?? 0), 0);
  if (total <= 0) return probabilities;

  return {
    ...probabilities,
    ...Object.fromEntries(selectionIds.map((id) => [id, clampProbability((probabilities[id] ?? 0) / total)]))
  };
}

export function applyMarketPriorAdjustmentToMarkets(
  predictionMarkets: PredictionMarket[],
  oddsMarkets: OddsMarket[],
  dataQuality: number,
  evidencePolicy?: MarketPriorEvidencePolicy
): { markets: PredictionMarket[]; adjustment: MarketPriorAdjustment } {
  const marketAdjustments: MarketPriorAdjustment["markets"] = [];
  let adjustedSelections = 0;

  const markets = predictionMarkets.map((predictionMarket) => {
    const oddsMarket = oddsMarkets.find((market) => market.id === predictionMarket.marketId);
    if (!oddsMarket) return predictionMarket;

    const rawImpliedProbabilities = oddsMarket.selections.map((selection) => decimalOddsToImpliedProbability(selection.decimalOdds));
    const noVigProbabilities = removeBookmakerMargin(rawImpliedProbabilities);
    const matchedSelections = oddsMarket.selections
      .map((selection, index) => ({
        ...selection,
        noVigProbability: noVigProbabilities[index] ?? rawImpliedProbabilities[index] ?? 0
      }))
      .filter((selection) => selection.decimalOdds > 1 && predictionMarket.probabilities[selection.id] !== undefined);

    if (matchedSelections.length < 2) return predictionMarket;

    const bookmakerMargin = calculateBookmakerMargin(rawImpliedProbabilities);
    const weight = marketPriorWeight(dataQuality, bookmakerMargin, matchedSelections.length, evidencePolicy);
    const blended = { ...predictionMarket.probabilities };

    for (const selection of matchedSelections) {
      const modelProbability = clampProbability(predictionMarket.probabilities[selection.id] ?? 0);
      blended[selection.id] = clampProbability(modelProbability * (1 - weight) + selection.noVigProbability * weight);
    }

    const selectionIds = matchedSelections.map((selection) => selection.id);
    const normalized = normalizeSelectionSubset(blended, selectionIds);
    adjustedSelections += matchedSelections.length;
    marketAdjustments.push({
      marketId: predictionMarket.marketId,
      selectionCount: matchedSelections.length,
      bookmakerMargin: round(bookmakerMargin),
      weight
    });

    return {
      ...predictionMarket,
      probabilities: normalized
    };
  });

  const averageWeight =
    marketAdjustments.length === 0 ? 0 : round(marketAdjustments.reduce((sum, market) => sum + market.weight, 0) / marketAdjustments.length);
  const averageBookmakerMargin =
    marketAdjustments.length === 0
      ? null
      : round(marketAdjustments.reduce((sum, market) => sum + market.bookmakerMargin, 0) / marketAdjustments.length);
  const applied = marketAdjustments.length > 0;

  return {
    markets,
    adjustment: {
      applied,
      adjustedMarkets: marketAdjustments.length,
      adjustedSelections,
      averageWeight,
      averageBookmakerMargin,
      markets: marketAdjustments,
      notes: applied
        ? [
            `Blended ${marketAdjustments.length} priced market${marketAdjustments.length === 1 ? "" : "s"} toward no-vig bookmaker probabilities before EV ranking.`,
            "Market-prior weight increases when model data quality is lower and decreases when bookmaker margin is high.",
            ...(evidencePolicy
              ? [`Evidence-aware market-prior floor requested at ${Math.round(evidencePolicy.minimumWeight * 100)}%: ${evidencePolicy.reason}`]
              : [])
          ]
        : ["No priced bookmaker market matched the model output, so odds were used only for edge comparison."]
    }
  };
}

export function applyMarketPriorAdjustmentToDiagnostics(
  diagnostics: FootballModelDiagnostics,
  adjustment: MarketPriorAdjustment
): FootballModelDiagnostics {
  return {
    ...diagnostics,
    signalScores: [
      ...diagnostics.signalScores,
      {
        label: "Market prior weight",
        value: adjustment.averageWeight,
        note: adjustment.applied
          ? `No-vig market probabilities adjusted ${adjustment.adjustedSelections} selection probabilities before value-edge ranking.`
          : "No market prior was applied because no priced market matched the model output."
      },
      {
        label: "Average bookmaker margin",
        value: adjustment.averageBookmakerMargin ?? 0,
        note: "Bookmaker margin is removed before edge calculation and also discounts the market-prior blend."
      }
    ],
    calibrationNotes: [
      ...diagnostics.calibrationNotes,
      adjustment.applied
        ? "Market-prior calibration blends context-adjusted model probabilities toward no-vig bookmaker probabilities before EV ranking; high-margin markets get less influence."
        : "Market-prior calibration was skipped because no priced bookmaker market matched the model output."
    ]
  };
}

export function buildValueEdges(
  predictionMarkets: PredictionMarket[],
  oddsMarkets: OddsMarket[],
  dataQuality: number
): ValueEdge[] {
  return oddsMarkets.flatMap((market) => {
    const predictionMarket = predictionMarkets.find((item) => item.marketId === market.id);
    if (!predictionMarket) return [];
    const rawImpliedProbabilities = market.selections.map((selection) => decimalOddsToImpliedProbability(selection.decimalOdds));
    const noVigImpliedProbabilities = removeBookmakerMargin(rawImpliedProbabilities);
    const bookmakerMargin = calculateBookmakerMargin(rawImpliedProbabilities);

    return market.selections.map((selection, index) => {
      const modelProbability = clampProbability(predictionMarket.probabilities[selection.id] ?? 0);
      const rawImpliedProbability = rawImpliedProbabilities[index] ?? decimalOddsToImpliedProbability(selection.decimalOdds);
      const noVigImpliedProbability = noVigImpliedProbabilities[index] ?? rawImpliedProbability;
      const impliedProbability = noVigImpliedProbability;
      const edge = calculateValueEdge(modelProbability, impliedProbability);
      const expectedValue = calculateExpectedValue(modelProbability, selection.decimalOdds);
      const confidence = confidenceFromEdgeAndProbability(edge, modelProbability, dataQuality);
      const risk = riskLevelFromConfidenceAndOdds(confidence, selection.decimalOdds);
      const valueEdge: ValueEdge = {
        marketId: market.id,
        selectionId: selection.id,
        label: selection.label,
        modelProbability,
        rawImpliedProbability,
        noVigImpliedProbability,
        impliedProbability,
        bookmakerMargin,
        edge,
        expectedValue,
        expectedRoi: expectedValue,
        odds: selection.decimalOdds,
        confidence,
        risk
      };
      const scoring = scoreValueEdge(valueEdge);

      return {
        ...valueEdge,
        uncertaintyAdjustedScore: scoring.score,
        scoreComponents: scoring.components
      };
    });
  });
}

export function selectBestPick(valueEdges: ValueEdge[], options: BestPickSelectionOptions = {}): BestPickResult {
  const minimumEdge = learnedMinimumEdge(options);
  const viable = valueEdges
    .filter((edge) => edge.edge > 0 && (minimumEdge === null || edge.edge >= minimumEdge) && edge.expectedValue > 0 && edge.confidence !== "low")
    .map((edge) => {
      const scoring = scoreValueEdge(edge, options);
      return {
        ...edge,
        uncertaintyAdjustedScore: scoring.score,
        scoreComponents: scoring.components
      };
    })
    .sort((a, b) => {
      const bScore = b.uncertaintyAdjustedScore ?? scoreValueEdge(b, options).score;
      const aScore = a.uncertaintyAdjustedScore ?? scoreValueEdge(a, options).score;
      if (bScore !== aScore) return bScore - aScore;
      if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
      if (b.edge !== a.edge) return b.edge - a.edge;
      if (b.modelProbability !== a.modelProbability) return b.modelProbability - a.modelProbability;
      return a.odds - b.odds;
    });

  if (!viable[0]) {
    return {
      hasValue: false,
      label: "No clear value found"
    };
  }

  return {
    ...viable[0],
    hasValue: true
  };
}
