import type {
  BestPickResult,
  DecisionAction,
  DecisionMarketMovement,
  DecisionMarketMovementScenario,
  DecisionOddsIntelligence,
  DecisionOddsMarketAudit,
  DecisionOddsSelectionAudit,
  Match,
  ValueEdge
} from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "./format";
import { scoreValueEdge } from "./odds";

export function fairOdds(probability: number): number | null {
  if (probability <= 0) return null;
  return 1 / probability;
}

export function formatFairOdds(probability: number): string {
  const odds = fairOdds(probability);
  return odds ? formatOdds(odds) : "N/A";
}

export function edgeAfterOddsMultiplier(bestPick: BestPickResult, oddsMultiplier: number): number {
  if (!bestPick.hasValue) return 0;
  const movedOdds = Math.max(1.01, bestPick.odds * oddsMultiplier);
  const movedRawImplied = 1 / movedOdds;
  const currentRawTotal = Math.max(bestPick.rawImpliedProbability, 1 + bestPick.bookmakerMargin);
  const otherSelectionsRaw = Math.max(0, currentRawTotal - bestPick.rawImpliedProbability);
  const movedNoVigImplied =
    movedRawImplied + otherSelectionsRaw > 0 ? movedRawImplied / (movedRawImplied + otherSelectionsRaw) : movedRawImplied;
  return bestPick.modelProbability - movedNoVigImplied;
}

function oddsSelectionAction(edge: ValueEdge): DecisionOddsSelectionAudit["action"] {
  if (edge.edge > 0 && edge.expectedValue > 0 && edge.confidence !== "low") return "value";
  if (edge.edge > 0 || edge.expectedValue > 0) return "watch";
  return "avoid";
}

function oddsSelectionReason(edge: ValueEdge): string {
  if (edge.edge > 0 && edge.expectedValue > 0 && edge.confidence !== "low") {
    return `${edge.label} has positive no-vig edge ${formatSignedPercent(edge.edge)} and EV ${formatSignedPercent(edge.expectedValue)}.`;
  }
  if (edge.edge > 0 && edge.expectedValue <= 0) {
    return `${edge.label} has positive probability edge but negative EV at quoted odds ${formatOdds(edge.odds)}.`;
  }
  if (edge.expectedValue > 0 && edge.confidence === "low") {
    return `${edge.label} has positive EV but confidence is low, so it stays on watch.`;
  }
  if (edge.edge <= 0) {
    return `${edge.label} is priced efficiently or short versus the model after margin removal.`;
  }
  return `${edge.label} does not clear both edge and EV guardrails.`;
}

function movementAction(edge: number | null, expectedValue: number | null, fallback: DecisionAction): DecisionAction {
  if (edge === null || expectedValue === null) return "avoid";
  if (edge <= 0 || expectedValue <= 0) return "avoid";
  if (edge < 0.03 || expectedValue < 0.03) return "monitor";
  return fallback === "avoid" ? "monitor" : fallback;
}

function marketMovementScenario({
  bestPick,
  action,
  id,
  label,
  oddsMultiplier,
  detail
}: {
  bestPick: BestPickResult;
  action: DecisionAction;
  id: string;
  label: string;
  oddsMultiplier: number;
  detail: string;
}): DecisionMarketMovementScenario {
  if (!bestPick.hasValue) {
    return {
      id,
      label,
      odds: null,
      modelProbability: null,
      noVigImpliedProbability: null,
      edge: null,
      expectedValue: null,
      actionAfterMove: "avoid",
      detail: "No priced value candidate is available for this market movement scenario."
    };
  }

  const movedOdds = Math.max(1.01, bestPick.odds * oddsMultiplier);
  const movedEdge = edgeAfterOddsMultiplier(bestPick, oddsMultiplier);
  const movedExpectedValue = bestPick.modelProbability * movedOdds - 1;

  return {
    id,
    label,
    odds: movedOdds,
    modelProbability: bestPick.modelProbability,
    noVigImpliedProbability: bestPick.modelProbability - movedEdge,
    edge: movedEdge,
    expectedValue: movedExpectedValue,
    actionAfterMove: movementAction(movedEdge, movedExpectedValue, action),
    detail
  };
}

/** Stress-tests the selected price against shortening and drift scenarios. */
export function buildDecisionMarketMovement({
  bestPick,
  action
}: {
  bestPick: BestPickResult;
  action: DecisionAction;
}): DecisionMarketMovement {
  if (!bestPick.hasValue) {
    return {
      status: "no-market",
      summary: "Market movement cannot be evaluated because no positive-value candidate is selected.",
      selection: null,
      marketId: null,
      currentOdds: null,
      fairOdds: null,
      breakEvenProbability: null,
      noVigImpliedProbability: null,
      currentEdge: null,
      currentExpectedValue: null,
      oddsBuffer: null,
      maxShorteningBeforeNoValue: null,
      targetClosingLineValue: null,
      scenarios: [
        {
          id: "no-market",
          label: "No priced candidate",
          odds: null,
          modelProbability: null,
          noVigImpliedProbability: null,
          edge: null,
          expectedValue: null,
          actionAfterMove: "avoid",
          detail: "Wait for a priced candidate before evaluating odds movement."
        }
      ],
      alerts: ["No priced candidate is available; do not manufacture market movement intelligence."],
      nextAction: "Refresh bookmaker markets and rerun value-edge ranking."
    };
  }

  const currentFairOdds = fairOdds(bestPick.modelProbability);
  const oddsBuffer = currentFairOdds === null ? null : bestPick.odds - currentFairOdds;
  const maxShorteningBeforeNoValue =
    currentFairOdds === null || bestPick.odds <= 0 ? null : Math.max(0, Math.min(0.95, 1 - currentFairOdds / bestPick.odds));
  const targetClosingLineValue = 0.02;
  const scenarios = [
    marketMovementScenario({
      bestPick,
      action,
      id: "current-price",
      label: "Current price",
      oddsMultiplier: 1,
      detail: "Current quoted odds and model probability before any market move."
    }),
    marketMovementScenario({
      bestPick,
      action,
      id: "three-percent-shortening",
      label: "Odds shorten 3%",
      oddsMultiplier: 0.97,
      detail: "Small price move against the model thesis."
    }),
    marketMovementScenario({
      bestPick,
      action,
      id: "five-percent-shortening",
      label: "Odds shorten 5%",
      oddsMultiplier: 0.95,
      detail: "Standard pre-action price stress used by the decision engine."
    }),
    marketMovementScenario({
      bestPick,
      action,
      id: "ten-percent-shortening",
      label: "Odds shorten 10%",
      oddsMultiplier: 0.9,
      detail: "Aggressive market move against the quoted value."
    }),
    marketMovementScenario({
      bestPick,
      action,
      id: "five-percent-drift",
      label: "Odds drift 5%",
      oddsMultiplier: 1.05,
      detail: "Market drifts longer; value may improve but could indicate adverse news."
    })
  ];
  const survivesFivePercent = scenarios.find((scenario) => scenario.id === "five-percent-shortening")?.actionAfterMove !== "avoid";
  const survivesTenPercent = scenarios.find((scenario) => scenario.id === "ten-percent-shortening")?.actionAfterMove !== "avoid";
  const status: DecisionMarketMovement["status"] =
    maxShorteningBeforeNoValue === null || maxShorteningBeforeNoValue <= 0.02
      ? "fragile"
      : survivesTenPercent && maxShorteningBeforeNoValue >= 0.09
        ? "resilient"
        : survivesFivePercent
          ? "sensitive"
          : "fragile";
  const alerts = [
    oddsBuffer !== null && oddsBuffer <= 0 ? `Current odds ${formatOdds(bestPick.odds)} are at or below fair odds ${formatFairOdds(bestPick.modelProbability)}.` : "",
    maxShorteningBeforeNoValue !== null
      ? `Remove or downgrade if odds shorten more than ${formatPercent(maxShorteningBeforeNoValue)} from the current quote.`
      : "",
    bestPick.expectedValue < 0.05 ? "Expected value buffer is thin; refresh odds before showing the selection." : "",
    scenarios.some((scenario) => scenario.id === "five-percent-shortening" && scenario.actionAfterMove === "avoid")
      ? "A 5% odds shortening breaks the thesis."
      : "A 5% odds shortening does not fully break the thesis, but still requires a refresh."
  ].filter(Boolean);
  const summary =
    status === "resilient"
      ? `${bestPick.label} has a resilient market buffer: current odds ${formatOdds(bestPick.odds)}, fair odds ${formatFairOdds(
          bestPick.modelProbability
        )}, and ${formatPercent(maxShorteningBeforeNoValue ?? 0)} shortening tolerance before EV reaches zero.`
      : status === "sensitive"
        ? `${bestPick.label} is market-sensitive: current odds ${formatOdds(bestPick.odds)} can tolerate about ${formatPercent(
            maxShorteningBeforeNoValue ?? 0
          )} shortening before value disappears.`
        : `${bestPick.label} is market-fragile: the quoted edge has little room before fair odds ${formatFairOdds(bestPick.modelProbability)}.`;

  return {
    status,
    summary,
    selection: bestPick.label,
    marketId: bestPick.marketId,
    currentOdds: bestPick.odds,
    fairOdds: currentFairOdds,
    breakEvenProbability: 1 / bestPick.odds,
    noVigImpliedProbability: bestPick.noVigImpliedProbability,
    currentEdge: bestPick.edge,
    currentExpectedValue: bestPick.expectedValue,
    oddsBuffer,
    maxShorteningBeforeNoValue,
    targetClosingLineValue,
    scenarios,
    alerts,
    nextAction: "Refresh odds, recompute no-vig probability, and downgrade if the latest quote crosses the fair-odds or EV threshold."
  };
}

function buildOddsSelectionAudit(edge: ValueEdge): DecisionOddsSelectionAudit {
  const score = edge.uncertaintyAdjustedScore ?? scoreValueEdge(edge).score;
  const scoreComponents = edge.scoreComponents ?? scoreValueEdge(edge).components;

  return {
    marketId: edge.marketId,
    selectionId: edge.selectionId,
    label: edge.label,
    action: oddsSelectionAction(edge),
    odds: edge.odds,
    fairOdds: fairOdds(edge.modelProbability),
    modelProbability: edge.modelProbability,
    rawImpliedProbability: edge.rawImpliedProbability,
    noVigImpliedProbability: edge.noVigImpliedProbability,
    bookmakerMargin: edge.bookmakerMargin,
    edge: edge.edge,
    expectedValue: edge.expectedValue,
    uncertaintyAdjustedScore: score,
    priceShorteningTolerance: scoreComponents.priceShorteningTolerance ?? null,
    priceFragilityPenalty: scoreComponents.priceFragilityPenalty ?? null,
    confidence: edge.confidence,
    risk: edge.risk,
    reason: oddsSelectionReason(edge)
  };
}

function oddsAuditScore(audit: DecisionOddsSelectionAudit): number {
  return audit.uncertaintyAdjustedScore ?? 0;
}

/** Audits every priced selection after margin removal and ranks value/watch/avoid candidates. */
export function buildDecisionOddsIntelligence({
  match,
  valueEdges
}: {
  match: Match;
  valueEdges: ValueEdge[];
}): DecisionOddsIntelligence {
  const selectionAudits = valueEdges.map(buildOddsSelectionAudit);
  const marketAudits: DecisionOddsMarketAudit[] = match.oddsMarkets.map((market) => {
    const selections = selectionAudits.filter((item) => item.marketId === market.id);
    const bestSelection = [...selections].sort((a, b) => {
      if (oddsAuditScore(b) !== oddsAuditScore(a)) return oddsAuditScore(b) - oddsAuditScore(a);
      if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
      if (b.edge !== a.edge) return b.edge - a.edge;
      return a.odds - b.odds;
    })[0] ?? null;
    const positiveEdgeCount = selections.filter((item) => item.edge > 0).length;
    const positiveExpectedValueCount = selections.filter((item) => item.expectedValue > 0).length;
    const hasActionable = selections.some((item) => item.action === "value");
    const bookmakerMargin = selections[0]?.bookmakerMargin ?? 0;
    const hasThinModel = selections.length === 0 || selections.every((item) => item.modelProbability <= 0);
    const status: DecisionOddsMarketAudit["status"] = hasActionable
      ? "value-found"
      : hasThinModel
        ? "thin-model"
        : bookmakerMargin > 0.08
          ? "overround-heavy"
          : "efficient";
    const summary =
      status === "value-found" && bestSelection
        ? `${market.name} has ${selections.filter((item) => item.action === "value").length} actionable value candidate(s); best is ${
            bestSelection.label
          } at ${formatSignedPercent(bestSelection.expectedValue)} EV.`
        : status === "overround-heavy"
          ? `${market.name} has a high bookmaker margin of ${formatSignedPercent(bookmakerMargin)}, so value needs extra caution.`
          : status === "thin-model"
            ? `${market.name} is missing model probability coverage.`
            : `${market.name} looks broadly efficient after margin removal; no selection clears value guardrails.`;

    return {
      marketId: market.id,
      marketName: market.name,
      status,
      bookmakerMargin,
      selectionCount: selections.length,
      positiveEdgeCount,
      positiveExpectedValueCount,
      bestSelection,
      summary,
      selections
    };
  });
  const topCandidates = [...selectionAudits]
    .sort((a, b) => {
      const actionDelta = (b.action === "value" ? 2 : b.action === "watch" ? 1 : 0) - (a.action === "value" ? 2 : a.action === "watch" ? 1 : 0);
      if (actionDelta !== 0) return actionDelta;
      if (oddsAuditScore(b) !== oddsAuditScore(a)) return oddsAuditScore(b) - oddsAuditScore(a);
      if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
      if (b.edge !== a.edge) return b.edge - a.edge;
      return a.odds - b.odds;
    })
    .slice(0, 6);
  const actionableSelections = selectionAudits.filter((item) => item.action === "value").length;
  const positiveEdgeSelections = selectionAudits.filter((item) => item.edge > 0).length;
  const positiveExpectedValueSelections = selectionAudits.filter((item) => item.expectedValue > 0).length;
  const margins = marketAudits.filter((item) => item.selectionCount > 0).map((item) => item.bookmakerMargin);
  const averageBookmakerMargin = margins.length ? margins.reduce((sum, margin) => sum + margin, 0) / margins.length : null;
  const bestActionableSelection = topCandidates.find((item) => item.action === "value") ?? null;
  const bestWatchlistSelection = topCandidates.find((item) => item.action === "watch") ?? null;
  const bestSelection = bestActionableSelection ?? bestWatchlistSelection ?? topCandidates[0] ?? null;
  const status: DecisionOddsIntelligence["status"] = actionableSelections
    ? "positive-ev"
    : positiveEdgeSelections || positiveExpectedValueSelections
      ? "watchlist"
      : "no-value";
  const avoidReasons = [
    ...marketAudits.filter((item) => item.status === "overround-heavy").map((item) => `${item.marketName}: high margin ${formatSignedPercent(item.bookmakerMargin)}.`),
    ...selectionAudits
      .filter((item) => item.action === "avoid")
      .slice(0, 4)
      .map((item) => `${item.label}: ${item.reason}`)
  ];
  const watchlistReasons = topCandidates
    .filter((item) => item.action === "watch")
    .slice(0, 4)
    .map((item) => `${item.label}: ${item.reason}`);
  const summary =
    status === "positive-ev"
      ? `Odds intelligence found ${actionableSelections} actionable value candidate(s) across ${marketAudits.length} market(s); best is ${
          bestActionableSelection?.label ?? "N/A"
        }.`
      : status === "watchlist"
        ? `Odds intelligence found ${positiveEdgeSelections} positive edge and ${positiveExpectedValueSelections} positive EV signal(s), but none fully clear action guardrails. Watchlist leader: ${
            bestWatchlistSelection?.label ?? "N/A"
          }.`
        : "Odds intelligence found no positive expected-value candidate after bookmaker-margin removal.";

  return {
    status,
    totalMarkets: marketAudits.length,
    totalSelections: selectionAudits.length,
    positiveEdgeSelections,
    positiveExpectedValueSelections,
    actionableSelections,
    averageBookmakerMargin,
    bestSelection,
    bestActionableSelection,
    bestWatchlistSelection,
    topCandidates,
    marketAudits,
    avoidReasons,
    watchlistReasons,
    summary
  };
}
