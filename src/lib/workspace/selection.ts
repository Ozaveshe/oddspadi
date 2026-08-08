import type { DecisionStatus, FixtureStatus } from "@/lib/domain/states";

/**
 * A selection the Bet Workspace is allowed to analyse.
 *
 * Everything here resolves to canonical OddsPadi data. Free text is not
 * analysable: "Arsenal to win" names no fixture, no market and no price, and
 * anything computed from it would be a guess dressed as analysis. Text must be
 * resolved to a fixture and market first, or rejected.
 *
 * A leg in this workspace is a *user's* selection. It is never an OddsPadi
 * pick, and adding one must never write to the publication ledger.
 */

/** Where the leg entered the workspace from. A closed list, not free text. */
export type LegEntryPoint =
  | "today"
  | "explore"
  | "match_intelligence"
  | "official_publication"
  | "watchlist"
  | "manual"
  | "import";

export type CanonicalSelection = {
  legId: string;
  fixtureId: string;
  marketId: string;
  selectionId: string;
  /**
   * The canonical selection key (`football.1x2.regulation.home`), resolved at
   * add time via the legacy bridge. Null when the legacy market id has no
   * canonical mapping — such a leg is carried and displayed, but platform
   * conversion and canonical settlement are unavailable for it, and the
   * interface says so rather than guessing.
   */
  canonicalSelectionKey?: string | null;
  /** Sport, when the entry point knew it. Needed for canonical resolution. */
  sport?: "football" | "basketball" | "tennis" | null;
  /** Line for handicap/totals markets, when the leg carries one. */
  marketLine?: number | null;
  /** Human label for the leg, e.g. "Arsenal to win". */
  label: string;
  fixtureLabel: string;
  competition: string;
  /** Where the price came from: a bookmaker name, "manual", or an import. */
  source: string;
  /** Which surface the leg was added from. Defaults to "manual" when absent. */
  entryPoint?: LegEntryPoint;
  userOdds: number;
  /**
   * De-vigged market probability for this selection at the time the leg was
   * added, from the same odds snapshot as `oddsObservedAt`. Null when the
   * entry point had no full market to de-vig (manual entry, imports).
   */
  marketNoVigProbability?: number | null;
  /** When the user's price was observed, if known. Manual entry has none. */
  oddsObservedAt: string | null;
  /** Null when OddsPadi has no model for this market. Never substituted. */
  modelProbability: number | null;
  modelGeneratedAt: string | null;
  decisionState: DecisionStatus | null;
  /** Set only when OddsPadi published an official pick on this selection. */
  publicationId: string | null;
  kickoffAt: string;
  fixtureStatus: FixtureStatus;
  /** False when the market is outside OddsPadi's modelled set. */
  marketSupported: boolean;
  /** Model uncertainty band, when the decision produced one. */
  modelInterval: { low: number; high: number } | null;
  /** The user's own note on this selection. Private; stripped from shares. */
  note?: string | null;
};

export type LegDiagnostic =
  | "no-model"
  | "unsupported-market"
  | "stale-odds"
  | "stale-model"
  | "match-started"
  | "match-finished"
  | "no-odds-timestamp";

export type AnalysedLeg = {
  selection: CanonicalSelection;
  impliedProbability: number;
  /** De-vigged market probability carried from the add-time snapshot. */
  noVigProbability: number | null;
  /** Model's fair price. Null whenever the model probability is null. */
  modelFairOdds: number | null;
  /** userOdds implied vs model probability. Null without a model. */
  modelMarketDifference: number | null;
  /**
   * The cautious read: the lower bound of the model interval when one exists,
   * otherwise the smaller of model and de-vigged market probability. Null when
   * neither view exists — a conservative number invented from nothing would
   * not be conservative, it would be fiction.
   */
  conservativeProbability: number | null;
  /** Expected value per unit stake at the user's odds, on the model view. */
  expectedValue: number | null;
  /** Width of the model interval; null when the model gave no band. */
  uncertaintyWidth: number | null;
  /** True when OddsPadi published an official pick on this exact selection. */
  isOfficialPick: boolean;
  diagnostics: LegDiagnostic[];
  /** True when this leg can contribute to a combined model probability. */
  usableForCombination: boolean;
  /** Plain sentence for the leg, avoiding value language. */
  note: string;
};

/** Odds older than this are context, not a price you could take. */
const STALE_ODDS_MS = 12 * 60 * 60_000;
/** A model view older than this needs re-checking before it is leaned on. */
const STALE_MODEL_MS = 12 * 60 * 60_000;

export function impliedProbability(decimalOdds: number): number {
  return 1 / decimalOdds;
}

export function analyseLeg(selection: CanonicalSelection, nowMs = Date.now()): AnalysedLeg {
  const diagnostics: LegDiagnostic[] = [];

  if (!selection.marketSupported) diagnostics.push("unsupported-market");
  if (selection.modelProbability === null) diagnostics.push("no-model");
  if (!selection.oddsObservedAt) diagnostics.push("no-odds-timestamp");
  else if (nowMs - Date.parse(selection.oddsObservedAt) > STALE_ODDS_MS) diagnostics.push("stale-odds");
  if (selection.modelGeneratedAt && nowMs - Date.parse(selection.modelGeneratedAt) > STALE_MODEL_MS) {
    diagnostics.push("stale-model");
  }
  if (selection.fixtureStatus === "live") diagnostics.push("match-started");
  if (selection.fixtureStatus === "finished") diagnostics.push("match-finished");

  const implied = impliedProbability(selection.userOdds);
  const modelFairOdds = selection.modelProbability ? 1 / selection.modelProbability : null;
  const difference = selection.modelProbability === null ? null : selection.modelProbability - implied;
  const noVig = selection.marketNoVigProbability ?? null;
  const interval = selection.modelInterval;

  const conservativeProbability =
    interval !== null && interval !== undefined
      ? interval.low
      : selection.modelProbability !== null && noVig !== null
        ? Math.min(selection.modelProbability, noVig)
        : null;

  const expectedValue =
    selection.modelProbability === null ? null : selection.modelProbability * selection.userOdds - 1;

  // A leg only contributes to a combined model number when it has a current
  // model on a supported market. Anything else would be filled in with an
  // assumption, and an assumed probability compounds silently across legs.
  const usableForCombination =
    selection.marketSupported &&
    selection.modelProbability !== null &&
    !diagnostics.includes("stale-model") &&
    selection.fixtureStatus !== "finished";

  return {
    selection,
    impliedProbability: implied,
    noVigProbability: noVig,
    modelFairOdds,
    modelMarketDifference: difference,
    conservativeProbability,
    expectedValue,
    uncertaintyWidth: interval ? Math.max(0, interval.high - interval.low) : null,
    isOfficialPick: selection.publicationId !== null,
    diagnostics,
    usableForCombination,
    note: legNote(selection, diagnostics, difference)
  };
}

/**
 * Per-leg copy.
 *
 * Deliberately free of "value", "safe" or "sure": the workspace describes the
 * relationship between a price and a model, and stops there.
 */
function legNote(selection: CanonicalSelection, diagnostics: LegDiagnostic[], difference: number | null): string {
  if (diagnostics.includes("unsupported-market")) {
    return "OddsPadi does not model this market, so this leg is carried for completeness only — no model comparison is available.";
  }
  if (diagnostics.includes("no-model")) {
    return "No current OddsPadi model covers this selection, so there is nothing to compare the price against.";
  }
  if (diagnostics.includes("match-finished")) {
    return "This match has finished. The figures shown are the analysis as it stood before kickoff.";
  }
  if (diagnostics.includes("match-started")) {
    return "This match is already under way. The model view is pre-match and does not account for the current state.";
  }
  const staleness = diagnostics.includes("stale-odds") ? " The price is more than 12 hours old and may have moved." : "";
  if (difference === null) return `Analysis only.${staleness}`;
  if (difference > 0.02) {
    return `The model's probability is above the price's implied probability${selection.publicationId ? "; OddsPadi published an official pick on this selection" : ""}.${staleness}`;
  }
  if (difference < -0.02) {
    return `The model's probability is below the price's implied probability.${staleness}`;
  }
  return `The model and the price broadly agree.${staleness}`;
}

/** Odds format conversion. Only the three formats actually supported. */
export type OddsFormat = "decimal" | "fractional" | "american";

export function toDecimalOdds(value: string | number, format: OddsFormat): number | null {
  if (format === "decimal") {
    const decimal = Number(value);
    return Number.isFinite(decimal) && decimal > 1 ? decimal : null;
  }
  if (format === "american") {
    const american = Number(value);
    if (!Number.isFinite(american) || american === 0) return null;
    return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
  }
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(String(value).trim());
  if (!match) return null;
  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  if (!denominator) return null;
  return numerator / denominator + 1;
}

export function formatDecimalOdds(decimalOdds: number, format: OddsFormat): string {
  if (format === "decimal") return decimalOdds.toFixed(2);
  if (format === "american") {
    const american = decimalOdds >= 2 ? (decimalOdds - 1) * 100 : -100 / (decimalOdds - 1);
    return `${american > 0 ? "+" : ""}${Math.round(american)}`;
  }
  // Fractional is approximated to a readable denominator rather than an exact
  // ratio: 2.37 has no tidy fraction, and a 137/100 helps nobody.
  const value = decimalOdds - 1;
  for (const denominator of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const numerator = value * denominator;
    if (Math.abs(numerator - Math.round(numerator)) < 0.02) return `${Math.round(numerator)}/${denominator}`;
  }
  return `${Math.round(value * 100)}/100`;
}
