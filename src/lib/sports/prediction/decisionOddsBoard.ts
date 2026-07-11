import type {
  DecisionActionabilityStatus,
  DecisionControlStatus,
  DecisionOddsSelectionAction,
  DecisionOddsSelectionAudit,
  Match,
  Prediction
} from "@/lib/sports/types";
import type { DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionOddsBoardStatus = "value-found" | "watchlist" | "blocked";

export type DecisionOddsBoardSelection = {
  id: string;
  sport: DecisionMultiSport;
  matchId: string;
  match: string;
  league: string;
  kickoffTime: string;
  marketId: string;
  marketName: string;
  selectionId: string;
  selection: string;
  action: DecisionOddsSelectionAction;
  odds: number;
  modelProbability: number;
  rawImpliedProbability: number;
  noVigImpliedProbability: number;
  bookmakerMargin: number;
  fairOdds: number | null;
  edge: number;
  expectedValue: number;
  expectedRoi: number;
  confidence: string;
  risk: string;
  valueScore: number;
  dataQualityScore: number;
  controlStatus: DecisionControlStatus;
  actionabilityStatus: DecisionActionabilityStatus;
  learningStatus: string;
  learningActive: boolean;
  whyModelLikesIt: string;
  riskNote: string;
  saferAlternative: string;
  avoidReason: string | null;
  verifyUrl: string;
};

export type DecisionOddsBoardSportSummary = {
  sport: DecisionMultiSport;
  matches: number;
  markets: number;
  selections: number;
  value: number;
  watch: number;
  avoid: number;
  positiveEv: number;
  averageMargin: number | null;
  bestSelection: string | null;
};

export type DecisionOddsBoard = {
  generatedAt: string;
  date: string;
  status: DecisionOddsBoardStatus;
  boardHash: string;
  summary: string;
  totals: {
    sports: number;
    matches: number;
    markets: number;
    selections: number;
    value: number;
    watch: number;
    avoid: number;
    positiveEv: number;
    averageMargin: number | null;
  };
  bestValue: DecisionOddsBoardSelection | null;
  selections: DecisionOddsBoardSelection[];
  sports: DecisionOddsBoardSportSummary[];
  policy: {
    canPromote: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    rule: string;
    verificationUrl: string;
  };
};

export type DecisionOddsBoardSlateInput = {
  sport: DecisionMultiSport;
  rows: DecisionRow[];
};

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

function average(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function signedPercent(value: number): string {
  const display = value * 100;
  const sign = display > 0 ? "+" : "";
  return `${sign}${display.toFixed(1)}%`;
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function scoreAction(action: DecisionOddsSelectionAction): number {
  if (action === "value") return 100;
  if (action === "watch") return 45;
  return 0;
}

function scoreConfidence(confidence: string): number {
  if (confidence === "high") return 16;
  if (confidence === "medium") return 8;
  return 0;
}

function riskPenalty(risk: string): number {
  if (risk === "high") return 12;
  if (risk === "medium") return 5;
  return 0;
}

function controlPenalty(status: DecisionControlStatus): number {
  if (status === "blocked") return 22;
  if (status === "needs-rerun") return 14;
  if (status === "monitor-only") return 7;
  return 0;
}

function actionabilityPenalty(status: DecisionActionabilityStatus): number {
  if (status === "blocked") return 18;
  if (status === "watch-only") return 8;
  return 0;
}

function valueScore({
  selection,
  dataQualityScore,
  controlStatus,
  actionabilityStatus,
  learningActive
}: {
  selection: DecisionOddsSelectionAudit;
  dataQualityScore: number;
  controlStatus: DecisionControlStatus;
  actionabilityStatus: DecisionActionabilityStatus;
  learningActive: boolean;
}): number {
  const score =
    scoreAction(selection.action) +
    Math.max(0, selection.expectedValue) * 95 +
    Math.max(0, selection.edge) * 75 +
    dataQualityScore * 0.18 +
    scoreConfidence(selection.confidence) -
    riskPenalty(selection.risk) -
    controlPenalty(controlStatus) -
    actionabilityPenalty(actionabilityStatus) -
    (learningActive ? 0 : 5);
  return Math.max(0, round(score, 2));
}

function marketAwareSaferAlternative(row: DecisionRow, selection: DecisionOddsSelectionAudit): string | null {
  const match = row.match;

  if (match.sport === "football") {
    if (selection.marketId === "match_winner") {
      if (selection.selectionId === "home") {
        return compact(
          `Double chance: ${match.homeTeam.name} or Draw. Draw no bet: ${match.homeTeam.name}. These reduce outright-win variance, but still need fresh no-vig pricing.`,
          210
        );
      }
      if (selection.selectionId === "away") {
        return compact(
          `Double chance: Draw or ${match.awayTeam.name}. Draw no bet: ${match.awayTeam.name}. These reduce outright-win variance, but still need fresh no-vig pricing.`,
          210
        );
      }
      return compact("Under 3.5 goals or monitor-only draw exposure. Draw prices are fragile, so confirm lineups and tempo before treating the draw as value.", 210);
    }

    if (selection.marketId === "over_under_25") {
      return selection.selectionId === "over_25"
        ? compact("Over 1.5 goals is the softer total to inspect first; keep BTTS Yes as a related but lineup-sensitive alternative.", 210)
        : compact("Under 3.5 goals is the softer total to inspect first; keep BTTS No as a related but lineup-sensitive alternative.", 210);
    }

    if (selection.marketId === "both_teams_to_score") {
      return selection.selectionId === "yes"
        ? compact("Over 1.5 goals is the lower-threshold companion market; compare it with BTTS only after lineup and weather checks.", 210)
        : compact("Under 3.5 goals is the lower-variance companion market; compare it with BTTS No only after lineup and attacking-news checks.", 210);
    }
  }

  if (match.sport === "basketball") {
    if (selection.marketId === "match_winner") {
      return compact("Spread is the related market to inspect after injury, rest, and lineup checks; moneyline stays lower complexity than spread exposure.", 210);
    }
    if (selection.marketId === "spread") {
      return compact("Moneyline is the lower-variance side alternative; use the spread only when the projected margin clears the posted line after injury/rest updates.", 210);
    }
    if (selection.marketId === "total_points") {
      return compact("Inspect an alternate total closer to the model projection, then re-check pace, injuries, rest days, and starting lineups.", 210);
    }
  }

  if (match.sport === "tennis") {
    if (selection.marketId === "match_winner") {
      return compact("Set handicap is the related upside market, but match winner remains lower variance until fitness, surface, and fatigue checks are provider-backed.", 210);
    }
    if (selection.marketId === "set_handicap") {
      return compact("Match winner is the lower-variance alternative to set handicap; re-check player fitness, fatigue, surface, and head-to-head data.", 210);
    }
    if (selection.marketId === "total_games") {
      return compact("Match winner or monitor-only is safer than total games until serve quality, fatigue, and retirement-risk news are checked.", 210);
    }
  }

  return null;
}

function saferAlternativeFor(row: DecisionRow, selection: DecisionOddsSelectionAudit): string {
  const marketAware = marketAwareSaferAlternative(row, selection);
  if (marketAware) return marketAware;

  const [available] = row.prediction.decision.saferAlternatives.filter((alternative) => alternative.availableInMvp);
  const [fallback] = row.prediction.decision.saferAlternatives;
  const alternative = available ?? fallback;
  if (!alternative) return "Wait for sharper lineups, injury news, and market movement before treating this as actionable.";
  return compact(`${alternative.market}: ${alternative.selection}. ${alternative.rationale}`, 180);
}

function avoidReasonFor(row: DecisionRow, selection: DecisionOddsSelectionAudit): string | null {
  const reasons = [...row.prediction.decision.avoidReasons, ...row.prediction.decision.oddsIntelligence.avoidReasons];
  if (selection.action === "avoid" && !reasons.length) return selection.reason;
  if (!reasons.length) return null;
  return compact(reasons.join(" "), 220);
}

function whyModelLikes(row: DecisionRow, selection: DecisionOddsSelectionAudit): string {
  if (selection.action === "avoid") {
    return compact(selection.reason, 180);
  }

  const decision = row.prediction.decision;
  return compact(
    `${selection.reason} Model probability is ${percent(selection.modelProbability)} versus ${percent(
      selection.noVigImpliedProbability
    )} no-vig, with ${signedPercent(selection.edge)} edge and ${signedPercent(selection.expectedValue)} EV. ${decision.summary}`,
    260
  );
}

function marketSensitiveRiskSignal(row: DecisionRow, selection: DecisionOddsSelectionAudit): string | null {
  const decision = row.prediction.decision;
  const openSignals = decision.dataCoverage.signals.filter(
    (signal) => signal.requiredForProduction && (signal.status === "missing" || signal.status === "mock" || signal.status === "stale")
  );
  const marketSignal =
    openSignals.find((signal) => {
      if (selection.marketId === "match_winner" || selection.marketId === "spread" || selection.marketId === "set_handicap") {
        return ["injuries", "suspensions", "lineups", "news", "home-away", "recent-form", "standings"].includes(signal.category);
      }
      if (selection.marketId === "over_under_25" || selection.marketId === "total_points" || selection.marketId === "total_games") {
        return ["weather", "lineups", "injuries", "news", "live-scores", "match-events"].includes(signal.category);
      }
      if (selection.marketId === "both_teams_to_score") {
        return ["lineups", "injuries", "suspensions", "news", "weather"].includes(signal.category);
      }
      return false;
    }) ?? openSignals[0];

  return marketSignal ? `${marketSignal.label}: ${marketSignal.detail}` : null;
}

function riskNoteFor(row: DecisionRow, selection: DecisionOddsSelectionAudit): string {
  const [risk] = row.prediction.decision.risks;
  const required = row.prediction.decision.actionability.requiredBeforeAction[0];
  const marketRisk = marketSensitiveRiskSignal(row, selection);
  return compact(
    `${selection.risk} risk. ${risk ?? row.prediction.decision.actionability.summary}${
      marketRisk ? ` Market-sensitive news/context: ${marketRisk}` : ""
    }${required ? ` Required before action: ${required}` : ""}`,
    300
  );
}

function selectionCardsFor(sport: DecisionMultiSport, row: DecisionRow): DecisionOddsBoardSelection[] {
  const decision = row.prediction.decision;
  const dataQualityScore = round(row.match.dataQualityScore * 100, 2);

  return decision.oddsIntelligence.marketAudits.flatMap((market) =>
    market.selections.map((selection) => {
      const score = valueScore({
        selection,
        dataQualityScore,
        controlStatus: decision.controlPolicy.status,
        actionabilityStatus: decision.actionability.status,
        learningActive: Boolean(decision.learningProfile?.active)
      });

      return {
        id: `${sport}:${row.match.id}:${selection.marketId}:${selection.selectionId}`,
        sport,
        matchId: row.match.id,
        match: matchLabel(row.match),
        league: row.match.league.name,
        kickoffTime: row.match.kickoffTime,
        marketId: selection.marketId,
        marketName: market.marketName,
        selectionId: selection.selectionId,
        selection: selection.label,
        action: selection.action,
        odds: selection.odds,
        modelProbability: round(selection.modelProbability),
        rawImpliedProbability: round(selection.rawImpliedProbability),
        noVigImpliedProbability: round(selection.noVigImpliedProbability),
        bookmakerMargin: round(selection.bookmakerMargin),
        fairOdds: selection.fairOdds == null ? null : round(selection.fairOdds, 2),
        edge: round(selection.edge),
        expectedValue: round(selection.expectedValue),
        expectedRoi: round(selection.expectedValue),
        confidence: selection.confidence,
        risk: selection.risk,
        valueScore: score,
        dataQualityScore,
        controlStatus: decision.controlPolicy.status,
        actionabilityStatus: decision.actionability.status,
        learningStatus: decision.learningProfile?.status ?? "missing",
        learningActive: Boolean(decision.learningProfile?.active),
        whyModelLikesIt: whyModelLikes(row, selection),
        riskNote: riskNoteFor(row, selection),
        saferAlternative: saferAlternativeFor(row, selection),
        avoidReason: avoidReasonFor(row, selection),
        verifyUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`
      };
    })
  );
}

function sortSelections(selections: DecisionOddsBoardSelection[]): DecisionOddsBoardSelection[] {
  const actionRank: Record<DecisionOddsSelectionAction, number> = { value: 3, watch: 2, avoid: 1 };
  return selections.slice().sort((a, b) => {
    const action = actionRank[b.action] - actionRank[a.action];
    if (action !== 0) return action;
    if (b.valueScore !== a.valueScore) return b.valueScore - a.valueScore;
    if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
    if (b.edge !== a.edge) return b.edge - a.edge;
    return a.match.localeCompare(b.match);
  });
}

function summarizeSport(sport: DecisionMultiSport, rows: DecisionRow[], selections: DecisionOddsBoardSelection[]): DecisionOddsBoardSportSummary {
  const value = selections.filter((selection) => selection.action === "value").length;
  const watch = selections.filter((selection) => selection.action === "watch").length;
  const avoid = selections.filter((selection) => selection.action === "avoid").length;
  const best = selections.find((selection) => selection.action === "value" && selection.expectedValue > 0);
  const markets = rows.reduce((sum, row) => sum + row.prediction.decision.oddsIntelligence.totalMarkets, 0);

  return {
    sport,
    matches: rows.length,
    markets,
    selections: selections.length,
    value,
    watch,
    avoid,
    positiveEv: selections.filter((selection) => selection.expectedValue > 0).length,
    averageMargin: average(selections.map((selection) => selection.bookmakerMargin)),
    bestSelection: best ? `${best.match} - ${best.selection}` : null
  };
}

function statusFor(selections: DecisionOddsBoardSelection[]): DecisionOddsBoardStatus {
  if (selections.some((selection) => selection.action === "value" && selection.expectedValue > 0)) return "value-found";
  if (selections.some((selection) => selection.action === "watch" || selection.edge > 0 || selection.expectedValue > 0)) return "watchlist";
  return "blocked";
}

export function buildDecisionOddsBoard({
  date,
  slates,
  limit = 20
}: {
  date: string;
  slates: DecisionOddsBoardSlateInput[];
  limit?: number;
}): DecisionOddsBoard {
  const sportSelections = slates.map((slate) => ({
    sport: slate.sport,
    rows: slate.rows,
    selections: sortSelections(slate.rows.flatMap((row) => selectionCardsFor(slate.sport, row)))
  }));
  const allSelections = sortSelections(sportSelections.flatMap((sport) => sport.selections));
  const visibleSelections = allSelections.slice(0, Math.max(1, Math.min(80, limit)));
  const status = statusFor(allSelections);
  const bestValue = allSelections.find((selection) => selection.action === "value" && selection.expectedValue > 0) ?? null;
  const value = allSelections.filter((selection) => selection.action === "value").length;
  const watch = allSelections.filter((selection) => selection.action === "watch").length;
  const avoid = allSelections.filter((selection) => selection.action === "avoid").length;
  const sports = sportSelections.map((sport) => summarizeSport(sport.sport, sport.rows, sport.selections));
  const boardHash = stableHash({
    date,
    status,
    selections: allSelections.map((selection) => [
      selection.sport,
      selection.matchId,
      selection.marketId,
      selection.selectionId,
      selection.action,
      selection.edge,
      selection.expectedValue,
      selection.valueScore
    ])
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    status,
    boardHash,
    summary: bestValue
      ? `Odds board found ${value} value candidate(s); best is ${bestValue.selection} in ${bestValue.match} at ${bestValue.odds.toFixed(2)} odds with ${signedPercent(
          bestValue.expectedValue
        )} EV.`
      : allSelections.length
        ? `Odds board is ${status}; ${watch} watch item(s), ${avoid} avoid item(s), and no promoted value candidate passed the board sort.`
        : "Odds board is blocked because no priced market selections were loaded.",
    totals: {
      sports: slates.length,
      matches: slates.reduce((sum, slate) => sum + slate.rows.length, 0),
      markets: slates.reduce(
        (sum, slate) => sum + slate.rows.reduce((rowSum, row) => rowSum + row.prediction.decision.oddsIntelligence.totalMarkets, 0),
        0
      ),
      selections: allSelections.length,
      value,
      watch,
      avoid,
      positiveEv: allSelections.filter((selection) => selection.expectedValue > 0).length,
      averageMargin: average(allSelections.map((selection) => selection.bookmakerMargin))
    },
    bestValue,
    selections: visibleSelections,
    sports,
    policy: {
      canPromote: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      rule: "Cross-sport odds board ranks value, watch, and avoid candidates only. Promotion, persistence, publishing, and training stay locked until provider data, Supabase keys, backtests, and operator controls pass readiness.",
      verificationUrl: `/api/sports/decision/odds-board?date=${encodeURIComponent(date)}`
    }
  };
}
