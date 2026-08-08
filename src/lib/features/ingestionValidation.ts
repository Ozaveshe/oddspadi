/**
 * What ingestion refuses to accept.
 *
 * Bad data is quarantined, never silently repaired. A repair looks like a fix
 * and behaves like a fabrication: the row that reaches the model is one nobody
 * observed, and the evidence that anything was wrong is gone. So every check
 * here produces a finding and a disposition, and the disposition is never
 * "corrected".
 *
 * The checks are ordered by how expensive the mistake is downstream, not by how
 * likely it is. A reversed participant corrupts every claim on the fixture; an
 * excessive overround merely makes one price untrustworthy.
 */

export type ValidationKind =
  | "impossible_score"
  | "reversed_participants"
  | "duplicate_fixture"
  | "odds_below_evens"
  | "incomplete_market"
  | "excessive_overround"
  | "timestamp_after_event"
  | "future_feature"
  | "inconsistent_season"
  | "suspicious_mass_nulls"
  | "parser_drift";

export type Disposition =
  /** Usable. */
  | "accept"
  /** Held out of the model, kept for evidence, surfaced to an operator. */
  | "quarantine"
  /** Structurally impossible; kept only as a record of what the provider sent. */
  | "reject";

export type ValidationFinding = {
  kind: ValidationKind;
  disposition: Disposition;
  detail: string;
};

export type FixtureCandidate = {
  externalId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  season: string | null;
  homeScore: number | null;
  awayScore: number | null;
  observedAt: string;
};

/** Beyond these, a score is a parsing artefact rather than a sporting event. */
const PLAUSIBLE_MAX: Record<string, number> = { football: 25, basketball: 250, tennis: 5 };

export function validateFixture(
  candidate: FixtureCandidate,
  context: { knownExternalIds?: Set<string>; expectedSeason?: string | null } = {}
): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  const max = PLAUSIBLE_MAX[candidate.sport] ?? 100;

  for (const [side, score] of [["home", candidate.homeScore], ["away", candidate.awayScore]] as const) {
    if (score === null) continue;
    if (!Number.isInteger(score) || score < 0 || score > max) {
      findings.push({
        kind: "impossible_score",
        disposition: "reject",
        detail: `${side} score ${score} is outside the plausible range for ${candidate.sport} (0–${max})`
      });
    }
  }

  if (candidate.homeTeam.trim() && candidate.homeTeam.trim() === candidate.awayTeam.trim()) {
    // A fixture against itself is a join that went wrong upstream, and every
    // claim built on it would be nonsense.
    findings.push({
      kind: "reversed_participants",
      disposition: "reject",
      detail: `both sides resolved to "${candidate.homeTeam}", which is an identity failure rather than a fixture`
    });
  }

  if (context.knownExternalIds?.has(candidate.externalId)) {
    findings.push({
      kind: "duplicate_fixture",
      disposition: "quarantine",
      detail: `external id ${candidate.externalId} already exists; merging is an operator decision because odds may be stranded on either row`
    });
  }

  if (context.expectedSeason && candidate.season && candidate.season !== context.expectedSeason) {
    findings.push({
      kind: "inconsistent_season",
      disposition: "quarantine",
      detail: `season ${candidate.season} does not match the competition's ${context.expectedSeason}`
    });
  }

  if (candidate.observedAt < candidate.kickoffAt && candidate.homeScore !== null) {
    // A score before kickoff is either a clock problem or a different fixture.
    findings.push({
      kind: "timestamp_after_event",
      disposition: "quarantine",
      detail: `a score was observed at ${candidate.observedAt}, before kickoff at ${candidate.kickoffAt}`
    });
  }

  return findings;
}

export type OddsCandidate = {
  market: string;
  selections: Array<{ selection: string; decimalOdds: number }>;
  /** How many selections the canonical market declares. */
  expectedSelections: number;
  observedAt: string;
  kickoffAt: string;
};

export const OVERROUND_CEILING = 1.3;

export function validateOdds(candidate: OddsCandidate): ValidationFinding[] {
  const findings: ValidationFinding[] = [];

  for (const { selection, decimalOdds } of candidate.selections) {
    if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) {
      // Decimal odds of 1 or less imply a non-positive return on a winning
      // bet, which no book offers and no model should read.
      findings.push({
        kind: "odds_below_evens",
        disposition: "reject",
        detail: `${selection} priced at ${decimalOdds}, which implies no return on a win`
      });
    }
  }

  if (candidate.selections.length !== candidate.expectedSelections) {
    findings.push({
      kind: "incomplete_market",
      disposition: "quarantine",
      detail: `${candidate.selections.length} of ${candidate.expectedSelections} selections priced; the market cannot be de-vigged`
    });
  }

  const usable = candidate.selections.filter((entry) => entry.decimalOdds > 1);
  if (usable.length === candidate.expectedSelections && usable.length > 1) {
    const overround = usable.reduce((sum, entry) => sum + 1 / entry.decimalOdds, 0);
    if (overround > OVERROUND_CEILING) {
      findings.push({
        kind: "excessive_overround",
        disposition: "quarantine",
        detail: `overround ${overround.toFixed(3)} exceeds ${OVERROUND_CEILING}; the quote is real but not a fair reading of the market`
      });
    }
  }

  return findings;
}

export type BatchShape = {
  source: string;
  rows: number;
  /** Per-field null counts across the batch. */
  nullCounts: Record<string, number>;
  /** Fields the parser produced last time, to detect a silent contract change. */
  previousFields?: string[];
  currentFields: string[];
};

export const MASS_NULL_SHARE = 0.5;

/**
 * Batch-level checks.
 *
 * These catch what per-row validation cannot: a provider that started
 * returning a field empty, or a parser that quietly stopped producing one.
 * Both pass every row check while corrupting the dataset.
 */
export function validateBatch(batch: BatchShape): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  if (batch.rows === 0) return findings;

  for (const [field, nulls] of Object.entries(batch.nullCounts)) {
    const share = nulls / batch.rows;
    if (share >= MASS_NULL_SHARE) {
      findings.push({
        kind: "suspicious_mass_nulls",
        disposition: "quarantine",
        detail: `${field} is null in ${(share * 100).toFixed(0)}% of ${batch.rows} rows from ${batch.source}`
      });
    }
  }

  if (batch.previousFields) {
    const lost = batch.previousFields.filter((field) => !batch.currentFields.includes(field));
    if (lost.length > 0) {
      // The quietest failure of the set: nothing errors, rows keep arriving,
      // and a feature simply stops existing.
      findings.push({
        kind: "parser_drift",
        disposition: "quarantine",
        detail: `${batch.source} stopped producing ${lost.join(", ")}; every feature built on those fields is now silently absent`
      });
    }
  }

  return findings;
}

export type QuarantineDecision = {
  disposition: Disposition;
  findings: ValidationFinding[];
  /** Operator-facing summary. Ordered worst first. */
  summary: string;
};

const SEVERITY: Record<Disposition, number> = { reject: 2, quarantine: 1, accept: 0 };

/**
 * Collapse findings into one disposition.
 *
 * The worst finding wins. A row that is both duplicated and impossible is
 * rejected, not quarantined — and a single accept among ten findings never
 * rescues it.
 */
export function decideDisposition(findings: ValidationFinding[]): QuarantineDecision {
  if (findings.length === 0) {
    return { disposition: "accept", findings, summary: "No validation findings." };
  }
  const ordered = [...findings].sort((a, b) => SEVERITY[b.disposition] - SEVERITY[a.disposition]);
  const worst = ordered[0]!.disposition;
  return {
    disposition: worst,
    findings: ordered,
    summary: `${worst}: ${ordered.map((finding) => finding.kind).join(", ")}`
  };
}
