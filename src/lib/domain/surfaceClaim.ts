import {
  isDecisionStatus,
  isFixtureStatus,
  isPublicationStatus,
  isSettlementStatus,
  type DataAvailability,
  type DecisionStatus,
  type FixtureStatus,
  type PublicationStatus,
  type SettlementStatus
} from "@/lib/domain/states";

/**
 * What a public surface asserts about a fixture, in a form a machine can read
 * back out of the rendered page.
 *
 * Ten surfaces read the same fixture through nine different modules. Nothing
 * forced them to agree, and nothing could detect it when they did not: a test
 * can assert that `buildMatchIntelligence` is self-consistent, but the actual
 * product failure is Today saying "kick-off 19:00" while the match page says
 * "full time" — two correct functions, two different reads, one contradiction
 * that only exists once both are rendered.
 *
 * So every surface stamps its claim into the DOM, and the contract test reads
 * the claims back out of the HTML and compares them. The attributes are the
 * product's own statement of what it believes, not a parallel model of it.
 */
export const PUBLIC_SURFACES = [
  "today",
  "live-board",
  "match",
  "prediction-list",
  "results",
  "performance",
  "news",
  "competition",
  "community",
  "workspace"
] as const;
export type PublicSurface = (typeof PUBLIC_SURFACES)[number];

export type SurfaceClaim = {
  /** Which page said it. */
  surface: PublicSurface;
  /** Canonical fixture identity. The join key for every comparison. */
  fixtureId: string;
  fixtureStatus: FixtureStatus;
  /** Normalised "home-away", or null when no score is known yet. */
  score: string | null;
  /** Canonical market key, e.g. "1x2". Null when the surface names no market. */
  market: string | null;
  selection: string | null;
  decision: DecisionStatus | null;
  publicationId: string | null;
  publicationStatus: PublicationStatus | null;
  /** ISO instant. A pick without one is unpublishable by definition. */
  publishedAt: string | null;
  settlement: SettlementStatus | null;
  /** Tri-state on purpose: "no odds" and "we did not look" are different. */
  oddsAvailable: boolean | null;
  dataAvailability: DataAvailability;
  /**
   * The instant this surface is speaking as of, always UTC ISO-8601.
   *
   * Surfaces render in the reader's timezone (WAT by default), so a rendered
   * "19:00" carries no comparable meaning. Comparing display strings across
   * surfaces produces false contradictions in one direction and hides real
   * ones in the other; the claim carries the instant instead.
   */
  asOf: string | null;
};

/** A surface asserting "there are N of these". Counts must reconcile too. */
export type CountClaim = {
  surface: PublicSurface;
  /** What is being counted, e.g. "official-publications", "settled". */
  metric: string;
  value: number;
  /**
   * Where the number came from. A count derived from a live query and a count
   * derived from the ledger may legitimately differ; a count with no stated
   * basis cannot be reconciled at all.
   */
  basis: "ledger" | "projection" | "live-query" | "editorial";
};

const ATTR = {
  surface: "data-op-surface",
  fixtureId: "data-op-fixture",
  fixtureStatus: "data-op-status",
  score: "data-op-score",
  market: "data-op-market",
  selection: "data-op-selection",
  decision: "data-op-decision",
  publicationId: "data-op-publication",
  publicationStatus: "data-op-publication-state",
  publishedAt: "data-op-published-at",
  settlement: "data-op-settlement",
  oddsAvailable: "data-op-odds",
  dataAvailability: "data-op-availability",
  asOf: "data-op-as-of"
} as const;

const COUNT_ATTR = {
  surface: "data-op-surface",
  metric: "data-op-count-metric",
  value: "data-op-count",
  basis: "data-op-count-basis"
} as const;

/** Render a claim as JSX props. Null fields are omitted, never stringified. */
export function claimAttributes(claim: SurfaceClaim): Record<string, string> {
  const out: Record<string, string> = {
    [ATTR.surface]: claim.surface,
    [ATTR.fixtureId]: claim.fixtureId,
    [ATTR.fixtureStatus]: claim.fixtureStatus,
    [ATTR.dataAvailability]: claim.dataAvailability
  };
  if (claim.score !== null) out[ATTR.score] = claim.score;
  if (claim.market !== null) out[ATTR.market] = claim.market;
  if (claim.selection !== null) out[ATTR.selection] = claim.selection;
  if (claim.decision !== null) out[ATTR.decision] = claim.decision;
  if (claim.publicationId !== null) out[ATTR.publicationId] = claim.publicationId;
  if (claim.publicationStatus !== null) out[ATTR.publicationStatus] = claim.publicationStatus;
  if (claim.publishedAt !== null) out[ATTR.publishedAt] = claim.publishedAt;
  if (claim.settlement !== null) out[ATTR.settlement] = claim.settlement;
  if (claim.oddsAvailable !== null) out[ATTR.oddsAvailable] = claim.oddsAvailable ? "available" : "none";
  if (claim.asOf !== null) out[ATTR.asOf] = claim.asOf;
  return out;
}

export function countAttributes(claim: CountClaim): Record<string, string> {
  return {
    [COUNT_ATTR.surface]: claim.surface,
    [COUNT_ATTR.metric]: claim.metric,
    [COUNT_ATTR.value]: String(claim.value),
    [COUNT_ATTR.basis]: claim.basis
  };
}

/** Normalise a score to the comparable form, or null when none is known. */
export function normaliseScore(home: number | null | undefined, away: number | null | undefined): string | null {
  if (typeof home !== "number" || typeof away !== "number") return null;
  if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return null;
  return `${home}-${away}`;
}

const TAG = /<[a-zA-Z][^>]*\sdata-op-(?:surface|fixture)="[^"]*"[^>]*>/g;

function attr(tag: string, name: string): string | null {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
  return match ? match[1] : null;
}

/**
 * Read claims back out of rendered HTML.
 *
 * Regex rather than a DOM parser deliberately: the input is server-rendered
 * output we produced ourselves, the attributes are flat, and adding jsdom to
 * parse our own markup would be a dependency carried for one assertion.
 */
export function parseSurfaceClaims(html: string): SurfaceClaim[] {
  const claims: SurfaceClaim[] = [];
  for (const tag of html.match(TAG) ?? []) {
    const surface = attr(tag, ATTR.surface);
    const fixtureId = attr(tag, ATTR.fixtureId);
    const status = attr(tag, ATTR.fixtureStatus);
    const availability = attr(tag, ATTR.dataAvailability);
    if (!surface || !fixtureId || !status || !availability) continue;
    if (!(PUBLIC_SURFACES as readonly string[]).includes(surface)) continue;
    if (!isFixtureStatus(status)) continue;

    const odds = attr(tag, ATTR.oddsAvailable);
    const decision = attr(tag, ATTR.decision);
    const publicationStatus = attr(tag, ATTR.publicationStatus);
    const settlement = attr(tag, ATTR.settlement);
    claims.push({
      surface: surface as PublicSurface,
      fixtureId,
      fixtureStatus: status,
      score: attr(tag, ATTR.score),
      market: attr(tag, ATTR.market),
      selection: attr(tag, ATTR.selection),
      decision: decision && isDecisionStatus(decision) ? decision : null,
      publicationId: attr(tag, ATTR.publicationId),
      publicationStatus: publicationStatus && isPublicationStatus(publicationStatus) ? publicationStatus : null,
      publishedAt: attr(tag, ATTR.publishedAt),
      settlement: settlement && isSettlementStatus(settlement) ? settlement : null,
      oddsAvailable: odds === null ? null : odds === "available",
      dataAvailability: availability as DataAvailability,
      asOf: attr(tag, ATTR.asOf)
    });
  }
  return claims;
}

const COUNT_TAG = /<[a-zA-Z][^>]*\sdata-op-count-metric="[^"]*"[^>]*>/g;

export function parseCountClaims(html: string): CountClaim[] {
  const claims: CountClaim[] = [];
  for (const tag of html.match(COUNT_TAG) ?? []) {
    const surface = attr(tag, COUNT_ATTR.surface);
    const metric = attr(tag, COUNT_ATTR.metric);
    const raw = attr(tag, COUNT_ATTR.value);
    const basis = attr(tag, COUNT_ATTR.basis);
    const value = Number(raw);
    if (!surface || !metric || !basis || !Number.isFinite(value)) continue;
    if (!(PUBLIC_SURFACES as readonly string[]).includes(surface)) continue;
    if (basis !== "ledger" && basis !== "projection" && basis !== "live-query" && basis !== "editorial") continue;
    claims.push({ surface: surface as PublicSurface, metric, value, basis });
  }
  return claims;
}

export type ClaimConflict = {
  fixtureId: string;
  field: keyof SurfaceClaim;
  /** Surface → the value it asserted. Present only for disagreeing surfaces. */
  values: Record<string, string>;
};

/**
 * Fields where two surfaces stating different non-null values is a defect.
 *
 * `decision` and `market` are absent by design: Today may show the headline
 * market while the match page shows several, and a listing may summarise a
 * decision the workspace does not repeat. Those are different questions, not
 * disagreement. Identity, score, status, publication and settlement are the
 * same question everywhere.
 */
const AGREEMENT_FIELDS = [
  "fixtureStatus",
  "score",
  "publicationId",
  "publicationStatus",
  "publishedAt",
  "settlement",
  "oddsAvailable"
] as const satisfies readonly (keyof SurfaceClaim)[];

/**
 * Compare every claim about the same fixture.
 *
 * A null is silence, not a counter-claim: a surface that does not mention the
 * settlement is not disagreeing about it. Only two surfaces asserting
 * different concrete values conflict.
 */
export function reconcileClaims(claims: SurfaceClaim[]): ClaimConflict[] {
  const byFixture = new Map<string, SurfaceClaim[]>();
  for (const claim of claims) {
    const list = byFixture.get(claim.fixtureId);
    if (list) list.push(claim);
    else byFixture.set(claim.fixtureId, [claim]);
  }

  const conflicts: ClaimConflict[] = [];
  for (const [fixtureId, group] of byFixture) {
    for (const field of AGREEMENT_FIELDS) {
      const values: Record<string, string> = {};
      const seen = new Set<string>();
      for (const claim of group) {
        const value = claim[field];
        if (value === null || value === undefined) continue;
        const text = String(value);
        seen.add(text);
        values[claim.surface] = text;
      }
      if (seen.size > 1) conflicts.push({ fixtureId, field, values });
    }
  }
  return conflicts;
}

export type CountConflict = { metric: string; values: Record<string, number> };

/**
 * Counts of the same metric on the same basis must match exactly.
 *
 * Grouped by basis: a live query and the ledger answering differently is a
 * freshness gap, and folding those together would either mask a real ledger
 * disagreement or fire constantly on an expected one.
 */
export function reconcileCounts(claims: CountClaim[]): CountConflict[] {
  const groups = new Map<string, CountClaim[]>();
  for (const claim of claims) {
    const key = `${claim.metric}::${claim.basis}`;
    const list = groups.get(key);
    if (list) list.push(claim);
    else groups.set(key, [claim]);
  }

  const conflicts: CountConflict[] = [];
  for (const [key, group] of groups) {
    const distinct = new Set(group.map((claim) => claim.value));
    if (distinct.size <= 1) continue;
    const values: Record<string, number> = {};
    for (const claim of group) values[claim.surface] = claim.value;
    conflicts.push({ metric: key, values });
  }
  return conflicts;
}
