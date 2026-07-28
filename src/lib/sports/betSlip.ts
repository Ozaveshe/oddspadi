import type { Prediction } from "@/lib/sports/types";
import type { MatchSummary, PredictionSummary } from "@/lib/sports/prediction/listRow";

export const BET_SLIP_STORAGE_KEY = "oddspadi-bet-slip-v1";
export const BET_SLIP_CHANGED_EVENT = "oddspadi:bet-slip-changed";
export type SlipLeg = { id: string; matchId: string; matchLabel: string; league: string; kickoffTime: string; selection: string; decimalOdds: number; modelProbability: number; noVigProbability: number; risk: Prediction["risk"] };
export type SlipAnalysis = {
  combinedOdds: number;
  modelProbability: number;
  /** Implied probability of the combined price, bookmaker margin included. */
  bookmakerProbability: number;
  /** Margin-free market probability — the benchmark an edge is measured against. */
  fairProbability: number;
  probabilityGap: number;
  weakestLegId: string | null;
};

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1;
}

function isSlipLeg(value: unknown): value is SlipLeg {
  if (!value || typeof value !== "object") return false;
  const leg = value as Partial<SlipLeg>;
  return typeof leg.id === "string"
    && typeof leg.matchId === "string"
    && typeof leg.matchLabel === "string"
    && typeof leg.league === "string"
    && typeof leg.kickoffTime === "string"
    && typeof leg.selection === "string"
    && typeof leg.decimalOdds === "number"
    && Number.isFinite(leg.decimalOdds)
    && leg.decimalOdds > 1
    && isProbability(leg.modelProbability)
    // `noVigProbability` was declared `number` but never validated, so a
    // corrupt or hand-edited localStorage entry could put a string or NaN into
    // a typed numeric field and propagate it straight into the analysis.
    && isProbability(leg.noVigProbability);
}

export function slipLegFromPrediction(match: MatchSummary, prediction: PredictionSummary): SlipLeg | null {
  const canonical = prediction.canonicalDecision;
  const pick = canonical.bestPublishedPick;
  if (
    canonical.publicStatus !== "value_pick" ||
    !pick ||
    !pick.publicationEligible ||
    pick.odds <= 1 ||
    pick.modelProbability <= 0 ||
    pick.modelProbability > 1
  ) return null;

  return {
    id: `${match.id}:${pick.marketId}:${pick.selectionId}`,
    matchId: match.id,
    matchLabel: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
    league: match.league.name,
    kickoffTime: match.kickoffTime,
    selection: pick.label,
    decimalOdds: pick.odds,
    modelProbability: pick.modelProbability,
    noVigProbability: pick.noVigImpliedProbability,
    risk: pick.risk
  };
}
/**
 * Combines a slip's legs as independent events.
 *
 * The gap is measured against the **no-vig** market probability, matching the
 * engine's own published formula (`edge = modelProbability - noVigProbability`).
 * It previously used `1 / combinedOdds`, which is the vigged price: that folds
 * the bookmaker's margin into the model's favour on every leg and compounds it,
 * so a three-leg slip overstated its own edge by roughly the cube of the
 * per-leg margin. Each leg already carries the no-vig figure the engine
 * computed for it — it was captured and then never read.
 *
 * The vigged probability is still reported, because it is the real price of the
 * slip; it just is not the benchmark an edge is measured against.
 */
export function analyzeSlip(legs: SlipLeg[]): SlipAnalysis {
  if (!legs.length) {
    return { combinedOdds: 1, modelProbability: 0, bookmakerProbability: 0, fairProbability: 0, probabilityGap: 0, weakestLegId: null };
  }
  const combinedOdds = legs.reduce((value, leg) => value * leg.decimalOdds, 1);
  const modelProbability = legs.reduce((value, leg) => value * leg.modelProbability, 1);
  const bookmakerProbability = 1 / combinedOdds;
  const fairProbability = legs.reduce((value, leg) => value * leg.noVigProbability, 1);
  const weakest = legs.reduce<SlipLeg | null>((current, leg) => !current || leg.modelProbability < current.modelProbability ? leg : current, null);
  return {
    combinedOdds,
    modelProbability,
    bookmakerProbability,
    fairProbability,
    probabilityGap: modelProbability - fairProbability,
    weakestLegId: weakest?.id ?? null
  };
}

export function readSlip(): SlipLeg[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(BET_SLIP_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isSlipLeg).slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function writeSlip(legs: SlipLeg[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(BET_SLIP_STORAGE_KEY, JSON.stringify(legs.filter(isSlipLeg).slice(0, 20)));
    window.dispatchEvent(new Event(BET_SLIP_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}
