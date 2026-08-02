import type { DataAvailability, DecisionStatus, FixtureStatus, SettlementStatus } from "@/lib/domain/states";
import { decisionStatusFromSlateStatus, settlementStatusFromLegacy } from "@/lib/domain/states";

/**
 * One coherent interpretation of a fixture.
 *
 * The match page used to derive the same state in several places: the header
 * read fixture status, the odds table decided separately whether prices
 * existed, the model card judged evidence quality, and an "advanced engine
 * audit" rendered agent deliberation and reasoning traces underneath. Those
 * derivations disagreed — the page could show stored odds beside "no odds
 * available", or tell a reader to "monitor before kickoff" on a match that had
 * finished two hours earlier.
 *
 * This resolver takes the canonical inputs once and emits the whole view. The
 * contradictions are not tested away; they are unrepresentable:
 *
 *   - `odds` is a discriminated union, so "current" and "none" cannot coexist.
 *   - `actionLanguageAllowed` is derived from phase, so a finished match cannot
 *     carry pre-match instructions.
 *   - `model.basis` is "live" only when a live run exists, so a pre-match
 *     probability can never be presented as current.
 *   - Evidence dimensions come from one list with one definition each, so no
 *     two sections can grade the same thing differently.
 */
export type MatchPhase = "upcoming" | "live" | "finished" | "void" | "postponed" | "unknown";

/** Terminal phases: the result is the story and no action remains. */
const TERMINAL_PHASES: ReadonlySet<MatchPhase> = new Set<MatchPhase>(["finished", "void", "postponed"]);

export type MatchIntelligenceInput = {
  fixture: {
    id: string;
    status: FixtureStatus;
    kickoffAt: string;
    homeTeam: string;
    awayTeam: string;
    competition: string;
    country: string | null;
    venue: string | null;
    homeScore: number | null;
    awayScore: number | null;
    /** Minute for a live fixture, when the provider supplies one. */
    minute: number | null;
    /** Last time any fixture field was verified against a source. */
    lastVerifiedAt: string | null;
  };
  odds: {
    /** Quotes considered current by the freshness rule. */
    current: MarketQuote[];
    /** Older quotes retained for context. Never presented as current. */
    historical: MarketQuote[];
    /** Newest observation across both sets. */
    observedAt: string | null;
    bookmakerCount: number;
    /** Set when the odds read itself failed, as opposed to returning nothing. */
    unavailableReason: string | null;
  };
  model: {
    /** Absent when no decision has been generated for this fixture. */
    run: {
      modelFamily: string;
      modelVersion: string;
      generatedAt: string;
      evidenceCutoffAt: string;
      calibrationState: "calibrated" | "provisional" | "uncalibrated";
      probabilities: { home: number; draw: number | null; away: number };
      /** Symmetric interval around the primary probability, when produced. */
      interval: { low: number; high: number } | null;
      /** True only for a run approved to update during play. */
      isLiveRun: boolean;
    } | null;
    marketProbabilities: { home: number; draw: number | null; away: number } | null;
  };
  decision: {
    /** Slate-level public status, translated to the canonical vocabulary. */
    publicStatus: string | null;
    noPickReason: string | null;
    /** Structured factors from the model, never free-text reasoning. */
    factors: RawFactor[];
  };
  /** Present only when an official pick exists in the publication ledger. */
  publication: {
    publicationId: string;
    market: string;
    selection: string;
    selectionLabel: string;
    oddsAtPublication: number;
    publishedAt: string;
    settlementStatus: SettlementStatus;
    settledAt: string | null;
  } | null;
  evidence: {
    fixtureIdentityConfidence: number | null;
    teamDataCoverage: number | null;
    lineupCoverage: number | null;
    calibrationSupport: number | null;
    sourceCoverage: number | null;
  };
  timelineEvents: TimelineEvent[];
  now?: string;
};

export type MarketQuote = {
  market: string;
  selection: string;
  label: string;
  decimalOdds: number;
  bookmaker: string | null;
  observedAt: string;
  /** Margin-free probability where the market supports removing overround. */
  noVigProbability: number | null;
};

export type RawFactor = {
  kind: "strength" | "form" | "scoring" | "availability" | "rest" | "market-move" | "evidence-gap";
  /** Signed contribution, negative meaning it argues against the selection. */
  weight: number;
  detail: string;
};

export type EvidenceFactor = { kind: RawFactor["kind"]; label: string; detail: string; direction: "supports" | "against" | "neutral" };

export type TimelineEvent = {
  at: string;
  kind: "odds-snapshot" | "model-generated" | "published" | "lineup-confirmed" | "kickoff" | "score-change" | "final-result" | "settlement";
  summary: string;
};

export type OddsView =
  | { state: "current"; quotes: MarketQuote[]; observedAt: string; bookmakerCount: number }
  | { state: "historical-only"; quotes: MarketQuote[]; observedAt: string; note: string }
  | { state: "in-play-unpriced"; note: string }
  | { state: "none"; note: string }
  | { state: "unavailable"; note: string };

export type ModelView =
  | { state: "unavailable"; note: string }
  | {
      state: "available";
      /** "live" only when an approved in-play run produced these numbers. */
      basis: "pre-match" | "live";
      probabilities: { home: number; draw: number | null; away: number };
      marketProbabilities: { home: number; draw: number | null; away: number } | null;
      modelFamily: string;
      modelVersion: string;
      generatedAt: string;
      evidenceCutoffAt: string;
      calibrationState: "calibrated" | "provisional" | "uncalibrated";
      interval: { low: number; high: number } | null;
      /** Set when a live fixture is being shown a pre-match model. */
      basisNote: string | null;
      /** True when the run is old enough that the page must say so. */
      stale: boolean;
    };

export type DecisionView = {
  status: DecisionStatus;
  /** Plain-language sentence. Never engine vocabulary. */
  headline: string;
  reason: string | null;
  publication: {
    publicationId: string;
    market: string;
    selectionLabel: string;
    oddsAtPublication: number;
    publishedAt: string;
    settlementStatus: SettlementStatus;
    settledAt: string | null;
    ledgerHref: string;
  } | null;
  /** True once the fixture is terminal: the decision is a historical record. */
  historical: boolean;
};

export type EvidenceDimension = {
  id: "fixture-identity" | "odds-freshness" | "team-data" | "lineups" | "calibration" | "source-coverage" | "readiness";
  label: string;
  /** The one definition, shared product-wide. */
  definition: string;
  score: number | null;
  band: "strong" | "adequate" | "thin" | "unknown";
};

export type MatchIntelligence = {
  phase: MatchPhase;
  header: {
    homeTeam: string;
    awayTeam: string;
    competition: string;
    country: string | null;
    venue: string | null;
    kickoffAt: string;
    status: FixtureStatus;
    score: { home: number; away: number } | null;
    minute: number | null;
    lastVerifiedAt: string | null;
    /** Short phrase describing the phase, e.g. "Full time". */
    stateLabel: string;
  };
  odds: OddsView;
  model: ModelView;
  decision: DecisionView;
  factors: EvidenceFactor[];
  evidence: EvidenceDimension[];
  timeline: TimelineEvent[];
  /**
   * False for terminal fixtures. Every "monitor this", "before kickoff" or
   * "add to your slip" affordance must be gated on this flag.
   */
  actionLanguageAllowed: boolean;
};

const MODEL_STALE_MS = 6 * 60 * 60_000;
const MAX_FACTORS = 5;

const FACTOR_LABELS: Record<RawFactor["kind"], string> = {
  strength: "Team strength",
  form: "Recent form",
  scoring: "Expected scoring",
  availability: "Availability",
  rest: "Rest and travel",
  "market-move": "Market movement",
  "evidence-gap": "Incomplete evidence"
};

export const EVIDENCE_DEFINITIONS: Record<EvidenceDimension["id"], { label: string; definition: string }> = {
  "fixture-identity": {
    label: "Fixture identity",
    definition: "How confidently this fixture is matched to the same match across every data source."
  },
  "odds-freshness": {
    label: "Odds freshness",
    definition: "How recently the prices shown here were observed from a bookmaker."
  },
  "team-data": {
    label: "Team data",
    definition: "How much verified history exists for both sides in this competition."
  },
  lineups: {
    label: "Lineups and availability",
    definition: "Whether confirmed team news is available; lineups publish about an hour before kickoff."
  },
  calibration: {
    label: "Calibration support",
    definition: "How many settled outcomes support the model's probabilities in this sport."
  },
  "source-coverage": {
    label: "Source coverage",
    definition: "How many independent bookmakers or data sources contributed to this view."
  },
  readiness: {
    label: "Decision readiness",
    definition: "The lowest of the dimensions above — a decision is only as ready as its weakest evidence."
  }
};

function band(score: number | null): EvidenceDimension["band"] {
  if (score === null || !Number.isFinite(score)) return "unknown";
  if (score >= 0.75) return "strong";
  if (score >= 0.5) return "adequate";
  return "thin";
}

function resolvePhase(status: FixtureStatus): MatchPhase {
  if (status === "finished") return "finished";
  if (status === "live") return "live";
  if (status === "cancelled" || status === "abandoned") return "void";
  if (status === "postponed") return "postponed";
  if (status === "scheduled" || status === "delayed") return "upcoming";
  return "unknown";
}

function stateLabel(phase: MatchPhase, minute: number | null): string {
  if (phase === "finished") return "Full time";
  if (phase === "live") return minute ? `Live · ${minute}'` : "Live";
  if (phase === "void") return "Match void";
  if (phase === "postponed") return "Postponed";
  if (phase === "upcoming") return "Upcoming";
  return "Status unconfirmed";
}

/**
 * Odds resolution. Exactly one state is returned, which is what makes
 * "stored odds" and "no odds available" impossible to render together.
 */
function resolveOdds(input: MatchIntelligenceInput, phase: MatchPhase): OddsView {
  const { odds } = input;
  if (odds.unavailableReason) {
    return { state: "unavailable", note: "Price data could not be read for this match, so no odds are shown." };
  }

  // After a terminal phase there is no such thing as a current price. Any
  // quote we hold is a historical record and must be labelled as one.
  if (TERMINAL_PHASES.has(phase)) {
    const quotes = [...odds.current, ...odds.historical];
    if (!quotes.length) return { state: "none", note: "No prices were recorded for this match." };
    const observedAt = odds.observedAt ?? quotes[0]!.observedAt;
    return {
      state: "historical-only",
      quotes,
      observedAt,
      note: "These are the last prices recorded before the match resolved, kept as a record. They are not current."
    };
  }

  if (odds.current.length) {
    return {
      state: "current",
      quotes: odds.current,
      observedAt: odds.observedAt ?? odds.current[0]!.observedAt,
      bookmakerCount: odds.bookmakerCount
    };
  }
  if (odds.historical.length) {
    return {
      state: "historical-only",
      quotes: odds.historical,
      observedAt: odds.observedAt ?? odds.historical[0]!.observedAt,
      note: "No current price is available. These prices are historical and may have moved."
    };
  }
  if (phase === "live") {
    return { state: "in-play-unpriced", note: "No in-play prices are available for this match." };
  }
  return { state: "none", note: "No bookmaker prices have been recorded for this match yet." };
}

function resolveModel(input: MatchIntelligenceInput, phase: MatchPhase, nowMs: number): ModelView {
  const run = input.model.run;
  if (!run) {
    return { state: "unavailable", note: "The model has not produced a view for this match." };
  }
  const generatedMs = Date.parse(run.generatedAt);
  const stale = Number.isFinite(generatedMs) && nowMs - generatedMs > MODEL_STALE_MS;

  // A pre-match run shown during play must say so. Silently letting an old
  // probability read as current is the specific misrepresentation being
  // designed out here.
  const basis: "pre-match" | "live" = run.isLiveRun && phase === "live" ? "live" : "pre-match";
  const basisNote =
    phase === "live" && basis === "pre-match"
      ? "This is the pre-match model. OddsPadi has no approved in-play model, so these probabilities do not account for the current score."
      : phase === "finished" || phase === "void" || phase === "postponed"
        ? "This is the pre-match model as it stood before the match, kept as a historical record."
        : null;

  return {
    state: "available",
    basis,
    probabilities: run.probabilities,
    marketProbabilities: input.model.marketProbabilities,
    modelFamily: run.modelFamily,
    modelVersion: run.modelVersion,
    generatedAt: run.generatedAt,
    evidenceCutoffAt: run.evidenceCutoffAt,
    calibrationState: run.calibrationState,
    interval: run.interval,
    basisNote,
    stale
  };
}

function resolveDecision(input: MatchIntelligenceInput, phase: MatchPhase): DecisionView {
  const historical = TERMINAL_PHASES.has(phase);
  const status: DecisionStatus = input.decision.publicStatus
    ? decisionStatusFromSlateStatus(input.decision.publicStatus)
    : "unavailable";

  const publication = input.publication
    ? {
        publicationId: input.publication.publicationId,
        market: input.publication.market,
        selectionLabel: input.publication.selectionLabel,
        oddsAtPublication: input.publication.oddsAtPublication,
        publishedAt: input.publication.publishedAt,
        settlementStatus: settlementStatusFromLegacy(input.publication.settlementStatus),
        settledAt: input.publication.settledAt,
        ledgerHref: `/track-record#publication-${input.publication.publicationId}`
      }
    : null;

  const headline = publication
    ? historical
      ? `OddsPadi published ${publication.selectionLabel} at ${publication.oddsAtPublication.toFixed(2)} before this match.`
      : `OddsPadi has published ${publication.selectionLabel} at ${publication.oddsAtPublication.toFixed(2)}.`
    : historical
      ? headlineForTerminalWithoutPick(status)
      : headlineForOpenWithoutPick(status);

  return {
    status: publication ? "pick" : status,
    headline,
    reason: input.decision.noPickReason,
    publication,
    historical
  };
}

function headlineForOpenWithoutPick(status: DecisionStatus): string {
  if (status === "lean") return "The model leans one way, but not far enough to publish a pick.";
  if (status === "watch") return "OddsPadi is watching this match; nothing has cleared publication.";
  if (status === "withheld") return "OddsPadi is withholding a view until the evidence bar is met.";
  if (status === "pass") return "OddsPadi looked at this match and is passing on every market.";
  return "OddsPadi has no view to show for this match.";
}

function headlineForTerminalWithoutPick(status: DecisionStatus): string {
  if (status === "pass") return "OddsPadi passed on every market for this match.";
  if (status === "withheld") return "OddsPadi withheld a view for this match; the evidence bar was not met.";
  if (status === "lean") return "OddsPadi leaned one way but published no pick for this match.";
  if (status === "watch") return "OddsPadi tracked this match but published no pick.";
  return "OddsPadi published no view for this match.";
}

function resolveFactors(raw: RawFactor[]): EvidenceFactor[] {
  return [...raw]
    // Strongest signals first, regardless of direction: a large argument
    // against the selection is as informative as one for it.
    .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
    .slice(0, MAX_FACTORS)
    .map((factor) => ({
      kind: factor.kind,
      label: FACTOR_LABELS[factor.kind],
      detail: factor.detail,
      direction: factor.weight > 0.02 ? "supports" : factor.weight < -0.02 ? "against" : "neutral"
    }));
}

function oddsFreshnessScore(view: OddsView, nowMs: number): number | null {
  if (view.state === "current") {
    const observed = Date.parse(view.observedAt);
    if (!Number.isFinite(observed)) return null;
    const ageHours = (nowMs - observed) / 3_600_000;
    // Full marks inside an hour, decaying to zero across a day.
    return Math.max(0, Math.min(1, 1 - ageHours / 24));
  }
  if (view.state === "historical-only") return 0.25;
  return view.state === "unavailable" ? null : 0;
}

function resolveEvidence(input: MatchIntelligenceInput, oddsView: OddsView, nowMs: number): EvidenceDimension[] {
  const dimension = (id: EvidenceDimension["id"], score: number | null): EvidenceDimension => ({
    id,
    label: EVIDENCE_DEFINITIONS[id].label,
    definition: EVIDENCE_DEFINITIONS[id].definition,
    score,
    band: band(score)
  });

  const core: EvidenceDimension[] = [
    dimension("fixture-identity", input.evidence.fixtureIdentityConfidence),
    dimension("odds-freshness", oddsFreshnessScore(oddsView, nowMs)),
    dimension("team-data", input.evidence.teamDataCoverage),
    dimension("lineups", input.evidence.lineupCoverage),
    dimension("calibration", input.evidence.calibrationSupport),
    dimension("source-coverage", input.evidence.sourceCoverage)
  ];

  // Readiness is the minimum, not an average: a decision is only as ready as
  // its weakest evidence, and averaging lets one strong dimension hide a
  // missing one. An unknown dimension makes readiness unknown.
  const scores = core.map((entry) => entry.score);
  const readiness = scores.some((score) => score === null) ? null : Math.min(...(scores as number[]));
  return [...core, dimension("readiness", readiness)];
}

export function buildMatchIntelligence(input: MatchIntelligenceInput): MatchIntelligence {
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  const phase = resolvePhase(input.fixture.status);
  const oddsView = resolveOdds(input, phase);
  const modelView = resolveModel(input, phase, nowMs);
  const decisionView = resolveDecision(input, phase);

  const score =
    input.fixture.homeScore !== null && input.fixture.awayScore !== null
      ? { home: input.fixture.homeScore, away: input.fixture.awayScore }
      : null;

  return {
    phase,
    header: {
      homeTeam: input.fixture.homeTeam,
      awayTeam: input.fixture.awayTeam,
      competition: input.fixture.competition,
      country: input.fixture.country,
      venue: input.fixture.venue,
      kickoffAt: input.fixture.kickoffAt,
      status: input.fixture.status,
      score,
      minute: phase === "live" ? input.fixture.minute : null,
      lastVerifiedAt: input.fixture.lastVerifiedAt,
      stateLabel: stateLabel(phase, input.fixture.minute)
    },
    odds: oddsView,
    model: modelView,
    decision: decisionView,
    factors: resolveFactors(input.decision.factors),
    evidence: resolveEvidence(input, oddsView, nowMs),
    // Append-only: events are sorted but never rewritten once the match ends,
    // so the record of what was known beforehand survives the result.
    timeline: [...input.timelineEvents].sort((left, right) => Date.parse(left.at) - Date.parse(right.at)),
    actionLanguageAllowed: !TERMINAL_PHASES.has(phase)
  };
}

/** Availability of the page as a whole, for the shared state notice. */
export function matchDataAvailability(intelligence: MatchIntelligence): DataAvailability {
  if (intelligence.model.state === "unavailable" && intelligence.odds.state === "unavailable") return "unavailable";
  if (intelligence.odds.state === "unavailable" || intelligence.model.state === "unavailable") return "partial";
  if (intelligence.model.state === "available" && intelligence.model.stale) return "stale";
  return "complete";
}
