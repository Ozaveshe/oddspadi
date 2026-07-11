import type { DecisionOddsBoard, DecisionOddsBoardSelection, DecisionOddsBoardSportSummary } from "@/lib/sports/prediction/decisionOddsBoard";

export type DecisionOddsIntelligenceProofStatus = "ready-proof" | "watch" | "blocked";
export type DecisionOddsIntelligenceProofCheckStatus = "pass" | "watch" | "blocked";

export type DecisionOddsIntelligenceProofSelection = {
  rank: number;
  sport: string;
  matchId: string;
  match: string;
  league: string;
  marketId: string;
  marketName: string;
  selectionId: string;
  selection: string;
  action: string;
  decimalOdds: number;
  impliedProbability: number;
  noVigProbability: number;
  modelProbability: number;
  edge: number;
  expectedValue: number;
  bookmakerMargin: number;
  fairOdds: number | null;
  verdict: string;
  whyModelLikesIt: string;
  risks: string[];
  saferAlternatives: string[];
  avoidReason: string | null;
  verifyUrl: string;
};

export type DecisionOddsIntelligenceProofMarketFamily = {
  marketId: string;
  selections: number;
  positiveValue: number;
  watch: number;
  avoid: number;
  averageMargin: number | null;
  bestEdge: number | null;
  bestExpectedValue: number | null;
  status: DecisionOddsIntelligenceProofStatus;
  explanation: string;
};

export type DecisionOddsIntelligenceProofCheck = {
  id:
    | "implied-probability"
    | "no-vig-margin-removal"
    | "model-vs-market-edge"
    | "expected-value"
    | "risk-and-safer-alternatives"
    | "no-publish-lock";
  label: string;
  status: DecisionOddsIntelligenceProofCheckStatus;
  detail: string;
};

export type DecisionOddsIntelligenceProof = {
  mode: "odds-intelligence-proof";
  generatedAt: string;
  date: string;
  status: DecisionOddsIntelligenceProofStatus;
  proofHash: string;
  summary: string;
  totals: {
    sports: number;
    matches: number;
    markets: number;
    selections: number;
    positiveValue: number;
    watch: number;
    avoid: number;
    positiveExpectedValue: number;
    averageMargin: number | null;
    bestEdge: number | null;
    bestExpectedValue: number | null;
    saferAlternatives: number;
  };
  sports: DecisionOddsBoardSportSummary[];
  topEdges: DecisionOddsIntelligenceProofSelection[];
  marketFamilies: DecisionOddsIntelligenceProofMarketFamily[];
  proofChecks: DecisionOddsIntelligenceProofCheck[];
  controls: {
    canInspectReadOnly: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
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

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function splitEvidence(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/(?<=\.)\s+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number | null): string {
  if (value === null) return "N/A";
  const display = value * 100;
  return `${display > 0 ? "+" : ""}${display.toFixed(1)}%`;
}

function selectionVerdict(selection: DecisionOddsBoardSelection): string {
  if (selection.action === "value") {
    return `Positive EV ${signedPercent(selection.expectedValue)} and no-vig edge ${signedPercent(selection.edge)}.`;
  }
  if (selection.action === "watch") {
    return `Watch only: one of edge or EV is positive, but the full guardrail set is not cleared.`;
  }
  return selection.avoidReason ?? "Avoid: model probability does not beat the no-vig market price after risk checks.";
}

function proofSelection(selection: DecisionOddsBoardSelection, rank: number): DecisionOddsIntelligenceProofSelection {
  return {
    rank,
    sport: selection.sport,
    matchId: selection.matchId,
    match: selection.match,
    league: selection.league,
    marketId: selection.marketId,
    marketName: selection.marketName,
    selectionId: selection.selectionId,
    selection: selection.selection,
    action: selection.action,
    decimalOdds: selection.odds,
    impliedProbability: selection.rawImpliedProbability,
    noVigProbability: selection.noVigImpliedProbability,
    modelProbability: selection.modelProbability,
    edge: selection.edge,
    expectedValue: selection.expectedValue,
    bookmakerMargin: selection.bookmakerMargin,
    fairOdds: selection.fairOdds,
    verdict: compact(selectionVerdict(selection), 220),
    whyModelLikesIt: compact(selection.whyModelLikesIt, 260),
    risks: splitEvidence(selection.riskNote),
    saferAlternatives: splitEvidence(selection.saferAlternative),
    avoidReason: selection.avoidReason ? compact(selection.avoidReason, 220) : null,
    verifyUrl: selection.verifyUrl
  };
}

function marketFamilies(selections: DecisionOddsBoardSelection[]): DecisionOddsIntelligenceProofMarketFamily[] {
  const grouped = new Map<string, DecisionOddsBoardSelection[]>();
  for (const selection of selections) {
    const key = selection.marketId;
    grouped.set(key, [...(grouped.get(key) ?? []), selection]);
  }

  return [...grouped.entries()]
    .map(([marketId, rows]) => {
      const positiveValue = rows.filter((row) => row.action === "value").length;
      const watch = rows.filter((row) => row.action === "watch").length;
      const avoid = rows.filter((row) => row.action === "avoid").length;
      const bestEdge = maxOrNull(rows.map((row) => row.edge));
      const bestExpectedValue = maxOrNull(rows.map((row) => row.expectedValue));
      const status: DecisionOddsIntelligenceProofStatus = positiveValue ? "ready-proof" : watch || rows.some((row) => row.expectedValue > 0) ? "watch" : "blocked";

      return {
        marketId,
        selections: rows.length,
        positiveValue,
        watch,
        avoid,
        averageMargin: average(rows.map((row) => row.bookmakerMargin)),
        bestEdge,
        bestExpectedValue,
        status,
        explanation:
          status === "ready-proof"
            ? `${marketId} has ${positiveValue} positive-value selection(s); best edge ${signedPercent(bestEdge)} and EV ${signedPercent(bestExpectedValue)}.`
            : status === "watch"
              ? `${marketId} has watch signals, but the full value guardrail set is not cleared.`
              : `${marketId} is priced efficiently or lacks model coverage after margin removal.`
      };
    })
    .sort((a, b) => {
      if (b.positiveValue !== a.positiveValue) return b.positiveValue - a.positiveValue;
      if ((b.bestExpectedValue ?? -1) !== (a.bestExpectedValue ?? -1)) return (b.bestExpectedValue ?? -1) - (a.bestExpectedValue ?? -1);
      return a.marketId.localeCompare(b.marketId);
    });
}

function proofChecks(board: DecisionOddsBoard, selections: DecisionOddsBoardSelection[]): DecisionOddsIntelligenceProofCheck[] {
  const hasSelections = selections.length > 0;
  const hasNoVig = selections.some(
    (selection) => selection.noVigImpliedProbability > 0 && selection.rawImpliedProbability !== selection.noVigImpliedProbability
  );
  const implausibleMargins = selections.filter((selection) => selection.bookmakerMargin < -0.1 || selection.bookmakerMargin > 0.25);
  const hasEdges = selections.some((selection) => Number.isFinite(selection.edge));
  const hasEv = selections.some((selection) => Number.isFinite(selection.expectedValue));
  const hasSaferAlternatives = selections.some((selection) => Boolean(selection.saferAlternative));
  const locksHeld = !board.policy.canPromote && !board.policy.canPersist && !board.policy.canPublish && !board.policy.canTrain;

  return [
    {
      id: "implied-probability",
      label: "Convert odds to implied probability",
      status: hasSelections ? "pass" : "blocked",
      detail: hasSelections
        ? "Each priced selection carries raw implied probability from decimal odds."
        : "No priced selections were loaded, so implied probability cannot be audited."
    },
    {
      id: "no-vig-margin-removal",
      label: "Remove bookmaker margin",
      status: !hasSelections || implausibleMargins.length ? "blocked" : hasNoVig ? "pass" : "watch",
      detail: implausibleMargins.length
        ? `${implausibleMargins.length} selection(s) have an implausible bookmaker margin outside -10% to +25%; reject the affected market grouping before calculating EV.`
        : hasNoVig
          ? `Average bookmaker margin is ${board.totals.averageMargin === null ? "N/A" : signedPercent(board.totals.averageMargin)} after no-vig normalization.`
          : hasSelections
            ? "No-vig probability is not distinguishable from raw implied probability in the current slate."
            : "No priced selections were loaded, so bookmaker margin cannot be audited."
    },
    {
      id: "model-vs-market-edge",
      label: "Compare model to market",
      status: hasEdges ? "pass" : "blocked",
      detail: hasEdges ? "Edge is model probability minus no-vig implied probability for every audited selection." : "No model-market edge rows were available."
    },
    {
      id: "expected-value",
      label: "Calculate expected value",
      status: hasEv ? "pass" : "blocked",
      detail: hasEv
        ? `Found ${board.totals.positiveEv} positive-EV selection(s), with value actions still gated by confidence and risk.`
        : "Expected value could not be calculated for the slate."
    },
    {
      id: "risk-and-safer-alternatives",
      label: "Explain risk and safer alternatives",
      status: hasSaferAlternatives ? "pass" : hasSelections ? "watch" : "blocked",
      detail: hasSaferAlternatives
        ? "Ranked rows include risk notes, avoid reasons, and safer alternatives such as softer market variants."
        : "Selections exist, but safer alternatives are missing from the current rows."
    },
    {
      id: "no-publish-lock",
      label: "Keep money controls locked",
      status: locksHeld ? "pass" : "blocked",
      detail: locksHeld
        ? "The odds proof is read-only: no stake, promote, publish, persist, or train control is unlocked."
        : "One or more promotion, persistence, publishing, or training controls are unexpectedly open."
    }
  ];
}

function statusFor(board: DecisionOddsBoard, selections: DecisionOddsBoardSelection[], checks: DecisionOddsIntelligenceProofCheck[]): DecisionOddsIntelligenceProofStatus {
  if (!selections.length || checks.some((check) => check.status === "blocked")) return "blocked";
  if (board.status === "value-found") return "ready-proof";
  return "watch";
}

export function buildDecisionOddsIntelligenceProof({
  board,
  limit = 12,
  now = new Date()
}: {
  board: DecisionOddsBoard;
  limit?: number;
  now?: Date;
}): DecisionOddsIntelligenceProof {
  const selections = board.selections;
  const checks = proofChecks(board, selections);
  const status = statusFor(board, selections, checks);
  const topEdges = selections.slice(0, Math.max(1, Math.min(30, limit))).map((selection, index) => proofSelection(selection, index + 1));
  const families = marketFamilies(selections);
  const positiveValue = board.totals.value;
  const watch = board.totals.watch;
  const avoid = board.totals.avoid;
  const bestEdge = maxOrNull(selections.map((selection) => selection.edge));
  const bestExpectedValue = maxOrNull(selections.map((selection) => selection.expectedValue));
  const proofHash = stableHash({
    date: board.date,
    status,
    selections: topEdges.map((selection) => [
      selection.sport,
      selection.matchId,
      selection.marketId,
      selection.selectionId,
      selection.action,
      selection.edge,
      selection.expectedValue
    ]),
    checks: checks.map((check) => [check.id, check.status])
  });

  return {
    mode: "odds-intelligence-proof",
    generatedAt: now.toISOString(),
    date: board.date,
    status,
    proofHash,
    summary:
      status === "ready-proof"
        ? `Odds intelligence proves ${positiveValue} positive-value selection(s) across ${board.totals.sports} sport(s): implied probability, no-vig price, model edge, EV, risk, and safer alternatives are all inspectable.`
        : status === "watch"
          ? `Odds intelligence is watch-only: ${watch} selection(s) have partial value signals, but no public promotion is unlocked.`
          : "Odds intelligence proof is blocked because priced selections or required math checks are missing.",
    totals: {
      sports: board.totals.sports,
      matches: board.totals.matches,
      markets: board.totals.markets,
      selections: board.totals.selections,
      positiveValue,
      watch,
      avoid,
      positiveExpectedValue: board.totals.positiveEv,
      averageMargin: board.totals.averageMargin,
      bestEdge,
      bestExpectedValue,
      saferAlternatives: selections.filter((selection) => Boolean(selection.saferAlternative)).length
    },
    sports: board.sports,
    topEdges,
    marketFamilies: families,
    proofChecks: checks,
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: ["/api/sports/decision/odds-intelligence-proof", "/api/sports/decision/odds-board"],
    locks: [
      "Read-only proof cannot stake, publish, persist decisions, persist training rows, train models, or upgrade a public action.",
      "Positive expected value is only an audited signal; provider freshness, Supabase proof, historical backtests, lineups, injury/news, and operator controls still gate action.",
      `Best edge ${signedPercent(bestEdge)} and best EV ${signedPercent(bestExpectedValue)} remain evidence fields, not instructions.`
    ]
  };
}
