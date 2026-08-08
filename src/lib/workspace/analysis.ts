import { analyseLeg, type AnalysedLeg, type CanonicalSelection } from "@/lib/workspace/selection";
import {
  COMBINATION_BASIS_COPY,
  detectCorrelations,
  resolveCombinationBasis,
  type CombinationBasis,
  type CorrelationFinding
} from "@/lib/workspace/correlation";

/**
 * Whole-workspace analysis.
 *
 * The output is deliberately conservative: where the data or the correlation
 * structure does not support a number, none is given. The workspace is an
 * analysis tool, not a recommendation engine — it produces no stake size and
 * no verdict on whether to place anything.
 */
export type WorkspaceAnalysis = {
  legs: AnalysedLeg[];
  combinedBookmakerOdds: number | null;
  /** Naive product of the legs' implied probabilities, margin included. */
  naiveImpliedProbability: number | null;
  /**
   * Product of the legs' de-vigged market probabilities. Margin removed, but
   * the product still assumes independence — so it is withheld whenever the
   * workspace contains a blocking contradiction, and read alongside the
   * combination basis otherwise. Null when any leg lacks a de-vigged view.
   */
  deViggedMarketProbability: number | null;
  /** Only present when the combination basis supports a number. */
  combinedModelProbability: number | null;
  /** Range rather than a point estimate; correlation widens it. */
  combinedModelRange: { low: number; high: number } | null;
  combinationBasis: CombinationBasis;
  combinationExplanation: string;
  /** Bookmaker margin implied by the combined price. */
  estimatedOverround: number | null;
  supportedLegCount: number;
  unsupportedLegCount: number;
  staleLegCount: number;
  startedLegCount: number;
  correlations: CorrelationFinding[];
  evidenceQuality: "strong" | "mixed" | "thin" | "unusable";
  /** True when the workspace contains a contradiction that cannot land. */
  containsImpossibleCombination: boolean;
};

/**
 * Probability shown to two decimal places at most.
 *
 * Reporting 23.4718% from a model with a ±5-point interval and unmodelled
 * correlation is false precision — the digits imply a confidence the inputs
 * do not carry.
 */
export function roundProbability(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function analyseWorkspace(selections: CanonicalSelection[], nowMs = Date.now()): WorkspaceAnalysis {
  const legs = selections.map((selection) => analyseLeg(selection, nowMs));
  const correlations = detectCorrelations(legs);
  const basis = resolveCombinationBasis(legs, correlations);

  const combinedBookmakerOdds = legs.length
    ? legs.reduce((product, leg) => product * leg.selection.userOdds, 1)
    : null;
  const naiveImplied = combinedBookmakerOdds ? 1 / combinedBookmakerOdds : null;

  let combinedModelProbability: number | null = null;
  let combinedModelRange: { low: number; high: number } | null = null;

  if ((basis === "independently-modelled" || basis === "correlation-adjusted") && legs.length) {
    const product = legs.reduce((accumulator, leg) => accumulator * (leg.selection.modelProbability ?? 0), 1);
    combinedModelProbability = roundProbability(product);

    // Propagate each leg's own uncertainty. Where a leg has no interval, a
    // modest ±3 points stands in for model noise — stated as a range so the
    // reader sees a band rather than a false point estimate.
    const low = legs.reduce(
      (accumulator, leg) => accumulator * (leg.selection.modelInterval?.low ?? Math.max(0, (leg.selection.modelProbability ?? 0) - 0.03)),
      1
    );
    const high = legs.reduce(
      (accumulator, leg) => accumulator * (leg.selection.modelInterval?.high ?? Math.min(1, (leg.selection.modelProbability ?? 0) + 0.03)),
      1
    );
    combinedModelRange = { low: roundProbability(low), high: roundProbability(high) };

    // A jointly-modelled correlated combination is more uncertain than an
    // independent one; widening the band records that honestly.
    if (basis === "correlation-adjusted") {
      combinedModelRange = {
        low: roundProbability(Math.max(0, combinedModelRange.low * 0.85)),
        high: roundProbability(Math.min(1, combinedModelRange.high * 1.15))
      };
    }
  }

  const unsupported = legs.filter((leg) => leg.diagnostics.includes("unsupported-market") || leg.diagnostics.includes("no-model"));
  const stale = legs.filter((leg) => leg.diagnostics.includes("stale-odds") || leg.diagnostics.includes("stale-model"));
  const started = legs.filter((leg) => leg.diagnostics.includes("match-started") || leg.diagnostics.includes("match-finished"));

  const estimatedOverround =
    naiveImplied !== null && combinedModelProbability !== null && combinedModelProbability > 0
      ? roundProbability(naiveImplied / combinedModelProbability - 1)
      : null;

  const containsImpossibleCombination = correlations.some(
    (finding) => finding.kind === "mutually-exclusive" || finding.kind === "opposing-selections"
  );

  const hasBlockingFinding = correlations.some((finding) => finding.severity === "blocking");
  const deViggedMarketProbability =
    !hasBlockingFinding && legs.length && legs.every((leg) => leg.noVigProbability !== null)
      ? roundProbability(legs.reduce((product, leg) => product * leg.noVigProbability!, 1))
      : null;

  return {
    legs,
    combinedBookmakerOdds: combinedBookmakerOdds ? Math.round(combinedBookmakerOdds * 100) / 100 : null,
    naiveImpliedProbability: naiveImplied === null ? null : roundProbability(naiveImplied),
    deViggedMarketProbability,
    combinedModelProbability,
    combinedModelRange,
    combinationBasis: basis,
    combinationExplanation: COMBINATION_BASIS_COPY[basis],
    estimatedOverround,
    supportedLegCount: legs.length - unsupported.length,
    unsupportedLegCount: unsupported.length,
    staleLegCount: stale.length,
    startedLegCount: started.length,
    correlations,
    evidenceQuality: resolveEvidenceQuality(legs, unsupported.length, stale.length),
    containsImpossibleCombination
  };
}

function resolveEvidenceQuality(
  legs: AnalysedLeg[],
  unsupportedCount: number,
  staleCount: number
): WorkspaceAnalysis["evidenceQuality"] {
  if (!legs.length) return "unusable";
  if (unsupportedCount === legs.length) return "unusable";
  if (unsupportedCount === 0 && staleCount === 0) return "strong";
  // Strictly more than half: exactly half the legs carrying a gap is a mixed
  // picture, not a thin one, and calling it thin understates what is usable.
  if (unsupportedCount + staleCount > legs.length / 2) return "thin";
  return "mixed";
}

/**
 * The frozen record kept once a match starts.
 *
 * Snapshots are immutable by contract: the point of keeping one is to record
 * what the analysis said *before* the result was known, and a snapshot that
 * moves afterwards is worthless as a record of judgement.
 */
/**
 * Personal settlement vocabulary — the canonical settlement outcomes plus
 * `pending`. Asian quarter lines half-win and half-lose for a user's slip
 * exactly as they do for an official pick; a personal ledger that cannot say
 * "half won" would grade the same result differently from the official one.
 */
export type PersonalLegOutcome =
  | "won"
  | "half_won"
  | "lost"
  | "half_lost"
  | "push"
  | "void"
  | "needs_review"
  | "pending";

export type WorkspaceSnapshot = {
  snapshotId: string;
  takenAt: string;
  /** Deep copy of the analysis at freeze time. */
  analysis: WorkspaceAnalysis;
  /** Set once the fixtures resolve. Never alters the analysis above. */
  settlement: {
    legOutcomes: Array<{ legId: string; outcome: PersonalLegOutcome; detail?: string }>;
    settledAt: string | null;
  } | null;
};

export function freezeWorkspace(analysis: WorkspaceAnalysis, snapshotId: string, takenAt: string): WorkspaceSnapshot {
  // structuredClone keeps the snapshot independent of any later mutation of
  // the live workspace object.
  return { snapshotId, takenAt, analysis: structuredClone(analysis), settlement: null };
}

/**
 * Attach settlement without touching the frozen analysis.
 *
 * Returns a new snapshot rather than mutating, so the historical probabilities
 * cannot be rewritten by a later result — the same rule the publication ledger
 * enforces for official picks.
 */
export function settleSnapshot(
  snapshot: WorkspaceSnapshot,
  legOutcomes: Array<{ legId: string; outcome: PersonalLegOutcome; detail?: string }>,
  settledAt: string
): WorkspaceSnapshot {
  return {
    ...snapshot,
    analysis: snapshot.analysis,
    settlement: { legOutcomes, settledAt }
  };
}
