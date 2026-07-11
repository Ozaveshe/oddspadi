import type { DecisionOddsSelectionAction, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionMarketAuditSport = Extract<Sport, "football" | "basketball" | "tennis">;
export type DecisionMarketAuditStatus = "positive-ev" | "watch" | "blocked";
export type DecisionMarketAuditVerdict = "positive-ev" | "watch" | "avoid" | "unpriced";

export type DecisionMarketAuditMatrixRow = {
  id: string;
  rank: number;
  sport: DecisionMarketAuditSport;
  matchId: string;
  match: string;
  league: string;
  kickoffTime: string;
  marketId: string;
  marketName: string;
  marketStatus: string;
  selectionId: string;
  selection: string;
  action: DecisionOddsSelectionAction;
  verdict: DecisionMarketAuditVerdict;
  decimalOdds: number;
  rawImpliedProbability: number;
  noVigProbability: number;
  modelProbability: number;
  posteriorProbability: number;
  fairOdds: number | null;
  bookmakerMargin: number;
  edge: number;
  expectedValue: number;
  valueRankScore: number;
  confidence: string;
  risk: string;
  whyModelFavorsIt: string;
  riskNote: string;
  avoidReason: string | null;
  saferAlternatives: string[];
  proofUrl: string;
};

export type DecisionMarketAuditMatrixGroup = {
  id: string;
  sport: DecisionMarketAuditSport;
  marketId: string;
  marketName: string;
  rows: number;
  positiveEv: number;
  watch: number;
  avoid: number;
  bestExpectedValue: number | null;
  bestEdge: number | null;
  averageBookmakerMargin: number | null;
  summary: string;
};

export type DecisionMarketAuditMatrix = {
  mode: "market-audit-matrix";
  generatedAt: string;
  date: string;
  status: DecisionMarketAuditStatus;
  matrixHash: string;
  summary: string;
  totals: {
    sports: number;
    matches: number;
    markets: number;
    selections: number;
    positiveEv: number;
    watch: number;
    avoid: number;
    unpriced: number;
    averageBookmakerMargin: number | null;
    bestExpectedValue: number | null;
    bestEdge: number | null;
  };
  sports: Array<{
    sport: DecisionMarketAuditSport;
    matches: number;
    markets: number;
    selections: number;
    positiveEv: number;
    watch: number;
    avoid: number;
    bestExpectedValue: number | null;
  }>;
  marketGroups: DecisionMarketAuditMatrixGroup[];
  rows: DecisionMarketAuditMatrixRow[];
  controls: {
    canInspectReadOnly: true;
    canStake: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canCallOpenAI: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

export type DecisionMarketAuditMatrixSlateInput = {
  sport: DecisionMarketAuditSport;
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

function maxOrNull(values: number[]): number | null {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return null;
  return round(Math.max(...finite));
}

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number | null): string {
  if (value === null) return "N/A";
  const display = value * 100;
  return `${display >= 0 ? "+" : ""}${display.toFixed(1)}%`;
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function verdictFor(action: DecisionOddsSelectionAction, odds: number, edge: number, expectedValue: number): DecisionMarketAuditVerdict {
  if (odds <= 1 || !Number.isFinite(odds)) return "unpriced";
  if (action === "value" && edge > 0 && expectedValue > 0) return "positive-ev";
  if (action === "watch" || edge > 0 || expectedValue > 0) return "watch";
  return "avoid";
}

function valueRankScore(row: {
  verdict: DecisionMarketAuditVerdict;
  expectedValue: number;
  edge: number;
  modelProbability: number;
  bookmakerMargin: number;
}): number {
  const verdictScore: Record<DecisionMarketAuditVerdict, number> = {
    "positive-ev": 100,
    watch: 55,
    avoid: 20,
    unpriced: 0
  };
  return round(
    verdictScore[row.verdict] +
      Math.max(0, row.expectedValue) * 100 +
      Math.max(0, row.edge) * 80 +
      row.modelProbability * 12 -
      Math.max(0, row.bookmakerMargin) * 25,
    2
  );
}

function saferAlternativesFor(prediction: Prediction): string[] {
  return prediction.decision.saferAlternatives.slice(0, 3).map((alternative) =>
    compact(
      `${alternative.market}: ${alternative.selection}. ${alternative.rationale}${
        alternative.fairOdds ? ` Fair odds ${alternative.fairOdds.toFixed(2)}.` : ""
      }`,
      180
    )
  );
}

function avoidReasonFor(prediction: Prediction, selectionReason: string, verdict: DecisionMarketAuditVerdict): string | null {
  const reasons = [...prediction.decision.avoidReasons, ...prediction.decision.oddsIntelligence.avoidReasons];
  if (verdict === "positive-ev") return null;
  if (reasons.length) return compact(reasons.join(" "), 220);
  if (verdict === "watch") return "Watch only: one of edge or EV is positive, but the full value guardrail set is not cleared.";
  if (verdict === "unpriced") return "Avoid because the market is not priced with usable decimal odds.";
  return compact(selectionReason, 220);
}

function riskNoteFor(prediction: Prediction): string {
  const [risk] = prediction.decision.risks;
  const [required] = prediction.decision.actionability.requiredBeforeAction;
  return compact(`${risk ?? prediction.decision.actionability.summary}${required ? ` Required before action: ${required}` : ""}`, 220);
}

function rowsForSlate(slate: DecisionMarketAuditMatrixSlateInput): DecisionMarketAuditMatrixRow[] {
  return slate.rows.flatMap((row) =>
    row.prediction.decision.oddsIntelligence.marketAudits.flatMap((market) =>
      market.selections.map((selection) => {
        const verdict = verdictFor(selection.action, selection.odds, selection.edge, selection.expectedValue);
        const rankScore = valueRankScore({
          verdict,
          expectedValue: selection.expectedValue,
          edge: selection.edge,
          modelProbability: selection.modelProbability,
          bookmakerMargin: selection.bookmakerMargin
        });

        return {
          id: `${slate.sport}:${row.match.id}:${selection.marketId}:${selection.selectionId}`,
          rank: 0,
          sport: slate.sport,
          matchId: row.match.id,
          match: matchLabel(row.match),
          league: row.match.league.name,
          kickoffTime: row.match.kickoffTime,
          marketId: selection.marketId,
          marketName: market.marketName,
          marketStatus: market.status,
          selectionId: selection.selectionId,
          selection: selection.label,
          action: selection.action,
          verdict,
          decimalOdds: round(selection.odds, 2),
          rawImpliedProbability: round(selection.rawImpliedProbability),
          noVigProbability: round(selection.noVigImpliedProbability),
          modelProbability: round(selection.modelProbability),
          posteriorProbability: round(selection.modelProbability),
          fairOdds: selection.fairOdds === null ? null : round(selection.fairOdds, 2),
          bookmakerMargin: round(selection.bookmakerMargin),
          edge: round(selection.edge),
          expectedValue: round(selection.expectedValue),
          valueRankScore: rankScore,
          confidence: selection.confidence,
          risk: selection.risk,
          whyModelFavorsIt: compact(
            `${selection.reason} Model ${percent(selection.modelProbability)} versus no-vig ${percent(
              selection.noVigImpliedProbability
            )}; edge ${signedPercent(selection.edge)} and EV ${signedPercent(selection.expectedValue)}.`,
            240
          ),
          riskNote: riskNoteFor(row.prediction),
          avoidReason: avoidReasonFor(row.prediction, selection.reason, verdict),
          saferAlternatives: saferAlternativesFor(row.prediction),
          proofUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`
        };
      })
    )
  );
}

function sortRows(rows: DecisionMarketAuditMatrixRow[]): DecisionMarketAuditMatrixRow[] {
  const verdictRank: Record<DecisionMarketAuditVerdict, number> = {
    "positive-ev": 4,
    watch: 3,
    avoid: 2,
    unpriced: 1
  };
  return rows
    .slice()
    .sort((a, b) => {
      if (verdictRank[b.verdict] !== verdictRank[a.verdict]) return verdictRank[b.verdict] - verdictRank[a.verdict];
      if (b.valueRankScore !== a.valueRankScore) return b.valueRankScore - a.valueRankScore;
      if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
      if (b.edge !== a.edge) return b.edge - a.edge;
      return a.id.localeCompare(b.id);
    })
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function sportSummaries(slates: DecisionMarketAuditMatrixSlateInput[], rows: DecisionMarketAuditMatrixRow[]): DecisionMarketAuditMatrix["sports"] {
  return slates.map((slate) => {
    const sportRows = rows.filter((row) => row.sport === slate.sport);
    return {
      sport: slate.sport,
      matches: slate.rows.length,
      markets: new Set(sportRows.map((row) => `${row.matchId}:${row.marketId}`)).size,
      selections: sportRows.length,
      positiveEv: sportRows.filter((row) => row.verdict === "positive-ev").length,
      watch: sportRows.filter((row) => row.verdict === "watch").length,
      avoid: sportRows.filter((row) => row.verdict === "avoid").length,
      bestExpectedValue: maxOrNull(sportRows.map((row) => row.expectedValue))
    };
  });
}

function marketGroups(rows: DecisionMarketAuditMatrixRow[]): DecisionMarketAuditMatrixGroup[] {
  const grouped = new Map<string, DecisionMarketAuditMatrixRow[]>();
  for (const row of rows) {
    const key = `${row.sport}:${row.marketId}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  return Array.from(grouped.entries())
    .map(([id, groupRows]) => {
      const [first] = groupRows;
      const positiveEv = groupRows.filter((row) => row.verdict === "positive-ev").length;
      const watch = groupRows.filter((row) => row.verdict === "watch").length;
      const avoid = groupRows.filter((row) => row.verdict === "avoid").length;
      const bestExpectedValue = maxOrNull(groupRows.map((row) => row.expectedValue));
      const bestEdge = maxOrNull(groupRows.map((row) => row.edge));
      return {
        id,
        sport: first?.sport ?? "football",
        marketId: first?.marketId ?? "unknown",
        marketName: first?.marketName ?? "Unknown market",
        rows: groupRows.length,
        positiveEv,
        watch,
        avoid,
        bestExpectedValue,
        bestEdge,
        averageBookmakerMargin: average(groupRows.map((row) => row.bookmakerMargin)),
        summary: positiveEv
          ? `${first?.sport ?? "sport"} ${first?.marketName ?? "market"} has ${positiveEv} positive-EV row(s); best EV ${signedPercent(bestExpectedValue)}.`
          : watch
            ? `${first?.sport ?? "sport"} ${first?.marketName ?? "market"} is watch-only after no-vig and model checks.`
            : `${first?.sport ?? "sport"} ${first?.marketName ?? "market"} is avoid-only or efficiently priced in this slate.`
      };
    })
    .sort((a, b) => {
      if (b.positiveEv !== a.positiveEv) return b.positiveEv - a.positiveEv;
      if ((b.bestExpectedValue ?? -1) !== (a.bestExpectedValue ?? -1)) return (b.bestExpectedValue ?? -1) - (a.bestExpectedValue ?? -1);
      return a.id.localeCompare(b.id);
    });
}

function statusFor(rows: DecisionMarketAuditMatrixRow[]): DecisionMarketAuditStatus {
  if (rows.some((row) => row.verdict === "positive-ev")) return "positive-ev";
  if (rows.some((row) => row.verdict === "watch")) return "watch";
  return "blocked";
}

function selectVisibleRows(rows: DecisionMarketAuditMatrixRow[], limit: number): DecisionMarketAuditMatrixRow[] {
  const visibleLimit = Math.max(1, Math.min(160, limit));
  const visible = rows.slice(0, visibleLimit);
  const requiredVerdicts: DecisionMarketAuditVerdict[] = ["positive-ev", "watch", "avoid", "unpriced"];

  for (const verdict of requiredVerdicts) {
    if (visible.some((row) => row.verdict === verdict)) continue;
    const representative = rows.find((row) => row.verdict === verdict);
    if (!representative) continue;
    if (visible.length < visibleLimit) {
      visible.push(representative);
      continue;
    }
    visible[visible.length - 1] = representative;
  }

  return visible;
}

export function buildDecisionMarketAuditMatrix({
  date,
  slates,
  limit = 120
}: {
  date: string;
  slates: DecisionMarketAuditMatrixSlateInput[];
  limit?: number;
}): DecisionMarketAuditMatrix {
  const allRows = sortRows(slates.flatMap(rowsForSlate));
  const visibleRows = selectVisibleRows(allRows, limit);
  const status = statusFor(allRows);
  const groups = marketGroups(allRows);
  const positiveEv = allRows.filter((row) => row.verdict === "positive-ev").length;
  const watch = allRows.filter((row) => row.verdict === "watch").length;
  const avoid = allRows.filter((row) => row.verdict === "avoid").length;
  const unpriced = allRows.filter((row) => row.verdict === "unpriced").length;
  const bestExpectedValue = maxOrNull(allRows.map((row) => row.expectedValue));
  const bestEdge = maxOrNull(allRows.map((row) => row.edge));
  const matrixHash = stableHash({
    date,
    status,
    rows: allRows.map((row) => [row.id, row.verdict, row.edge, row.expectedValue, row.valueRankScore])
  });

  return {
    mode: "market-audit-matrix",
    generatedAt: new Date().toISOString(),
    date,
    status,
    matrixHash,
    summary: allRows.length
      ? `Market audit matrix inspected ${allRows.length} selections across ${groups.length} sport-market group(s): ${positiveEv} positive EV, ${watch} watch, ${avoid} avoid, ${unpriced} unpriced.`
      : "Market audit matrix is blocked because no priced market selections were loaded.",
    totals: {
      sports: slates.length,
      matches: slates.reduce((sum, slate) => sum + slate.rows.length, 0),
      markets: new Set(allRows.map((row) => `${row.matchId}:${row.marketId}`)).size,
      selections: allRows.length,
      positiveEv,
      watch,
      avoid,
      unpriced,
      averageBookmakerMargin: average(allRows.map((row) => row.bookmakerMargin)),
      bestExpectedValue,
      bestEdge
    },
    sports: sportSummaries(slates, allRows),
    marketGroups: groups,
    rows: visibleRows,
    controls: {
      canInspectReadOnly: true,
      canStake: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canCallOpenAI: false,
      canUpgradePublicAction: false
    },
    proofUrls: ["/api/sports/decision/market-audit-matrix", "/api/sports/decision/odds-board", "/api/sports/decision/odds-intelligence-proof"],
    locks: [
      "The matrix ranks expected value as evidence only; it cannot stake, publish, persist, train, call OpenAI, or upgrade public action.",
      "Positive EV still requires provider freshness, lineups or injury/news confirmation, Supabase proof, backtests, and operator controls before action.",
      "Avoid rows remain visible so the model can explain why a market should be skipped instead of hiding negative evidence."
    ]
  };
}
