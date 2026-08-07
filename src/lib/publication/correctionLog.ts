import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicationRevision } from "@/lib/domain/publication";
import {
  isPublicationStatus,
  isSettlementStatus,
  type DataAvailability,
  type PublicationStatus,
  type SettlementStatus
} from "@/lib/domain/states";

/**
 * The public correction log.
 *
 * The ledger has always been able to correct a claim: `op_correct_publication`
 * writes the verbatim prior state to `op_publication_revisions`, bumps the
 * revision, and marks the row `corrected` or `retracted`. What was missing is
 * the other half — anybody outside the database being able to see that it
 * happened. A track record that can be amended without the amendment being
 * visible is not auditable, and an unauditable record is worth exactly as much
 * as an invented one.
 *
 * Three rules shape this module.
 *
 * **Nothing here rewrites history.** The log is derived entirely from the
 * append-only revision rows plus the current ledger row. Every entry carries
 * the original values as they were captured, so the previous claim stays
 * readable after it has been superseded.
 *
 * **A retraction is a correction that stays visible.** Withdrawing a pick
 * removes it from the record in both directions, but it does not remove it
 * from this log. Disappearance is how a record gets quietly flattered.
 *
 * **An unknown is null, never zero.** A win rate with no decided picks behind
 * it is null; a delta between two null win rates is null. Zero is a
 * measurement and we do not claim ones we did not make.
 */

/** The subset of a publication that the public log needs, in either direction. */
export type LedgerPublicationState = {
  publicationId: string;
  fixtureExternalId: string | null;
  sport: string | null;
  competition: string | null;
  market: string | null;
  selection: string | null;
  selectionLabel: string | null;
  marketLine: number | null;
  modelProbability: number | null;
  oddsAtPublication: number | null;
  impliedProbability: number | null;
  publishedAt: string | null;
  kickoffAt: string | null;
  publicationStatus: PublicationStatus | null;
  settlementStatus: SettlementStatus | null;
  publicCopyRef: string | null;
  revision: number | null;
};

/**
 * The three counts a correction can move, and the rate derived from them.
 *
 * `voided` folds push, void and cancelled together because none of them is a
 * played selection; they are kept out of the win-rate denominator for the same
 * reason the rest of the ledger keeps them out.
 */
export type CorrectionAggregate = {
  won: number;
  lost: number;
  voided: number;
  /** won / (won + lost). Null — never 0 — when nothing has been decided. */
  winRate: number | null;
};

export type CorrectionAggregateEffect = {
  before: CorrectionAggregate;
  after: CorrectionAggregate;
  wonDelta: number;
  lostDelta: number;
  voidedDelta: number;
  /** Null when either side has no win rate at all; a null is not a zero move. */
  winRateDelta: number | null;
  /** False when the correction changed the claim but not the record. */
  movedTheRecord: boolean;
};

export type CorrectionFieldChange = {
  /** Camel-cased ledger field name. */
  field: string;
  /** Short human label, so a renderer does not invent its own vocabulary. */
  label: string;
  previous: string | number | null;
  current: string | number | null;
};

export type CorrectionEntry = {
  /** Identity of the revision row. Stable; safe for an article to cite. */
  correctionId: string;
  publicationId: string;
  /** The revision number that this entry superseded. */
  revision: number;
  /**
   * A correction amends a live claim; a retraction withdraws it. Both are
   * recorded the same way and both stay here forever.
   */
  kind: "correction" | "retraction";
  correctedAt: string;
  /** Operator-supplied and mandatory: `op_correct_publication` refuses an empty one. */
  reason: string;
  /** What the claim said before, verbatim from the revision row. */
  original: LedgerPublicationState;
  /** What it says now, or said until the next correction. */
  current: LedgerPublicationState;
  changes: CorrectionFieldChange[];
  effect: CorrectionAggregateEffect;
};

export type CorrectionLog = {
  availability: DataAvailability;
  unavailableReason: string | null;
  /** Newest first. Empty is a valid, reportable state — not an error. */
  entries: CorrectionEntry[];
  corrections: number;
  retractions: number;
  /**
   * Revision rows whose publication could not be read back, so no before/after
   * could be derived. Reported rather than silently dropped.
   */
  unresolved: number;
  /** The record as it stands after every correction in this log. */
  currentAggregate: CorrectionAggregate | null;
  asOf: string;
};

const PUBLIC_FIELDS: Array<{ field: keyof LedgerPublicationState; label: string }> = [
  { field: "selectionLabel", label: "Selection" },
  { field: "marketLine", label: "Market line" },
  { field: "modelProbability", label: "Model probability" },
  { field: "oddsAtPublication", label: "Odds at publication" },
  { field: "impliedProbability", label: "Implied probability" },
  { field: "publicCopyRef", label: "Published explanation" },
  { field: "publicationStatus", label: "Publication status" },
  { field: "settlementStatus", label: "Settlement" }
];

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function textOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text.length ? text : null;
}

/**
 * Read a captured `previous_state` blob into a state.
 *
 * The blob is `to_jsonb()` of the whole ledger row, so it is snake_cased and
 * may come from an older column set. Anything absent reads as null rather than
 * as a default, because "the capture did not record this" and "the value was
 * zero" are different facts.
 */
export function stateFromPreviousState(
  previousState: Record<string, unknown>,
  fallbackPublicationId: string
): LedgerPublicationState {
  const publicationStatus = previousState.publication_status;
  const settlementStatus = previousState.settlement_status;
  return {
    publicationId: textOrNull(previousState.id) ?? fallbackPublicationId,
    fixtureExternalId: textOrNull(previousState.fixture_external_id),
    sport: textOrNull(previousState.sport),
    competition: textOrNull(previousState.competition),
    market: textOrNull(previousState.market),
    selection: textOrNull(previousState.selection),
    selectionLabel: textOrNull(previousState.selection_label),
    marketLine: numberOrNull(previousState.market_line),
    modelProbability: numberOrNull(previousState.model_probability),
    oddsAtPublication: numberOrNull(previousState.odds_at_publication),
    impliedProbability: numberOrNull(previousState.implied_probability),
    publishedAt: textOrNull(previousState.published_at),
    kickoffAt: textOrNull(previousState.kickoff_at),
    publicationStatus: isPublicationStatus(publicationStatus) ? publicationStatus : null,
    settlementStatus: isSettlementStatus(settlementStatus) ? settlementStatus : null,
    publicCopyRef: textOrNull(previousState.public_copy_ref),
    revision: numberOrNull(previousState.revision)
  };
}

/** Read a live `op_publications` row into the same shape. */
export function stateFromLedgerRow(row: Record<string, unknown>): LedgerPublicationState {
  return stateFromPreviousState(row, String(row.id ?? ""));
}

/**
 * A publication's contribution to the record.
 *
 * Retracted claims contribute nothing: withdrawn means withdrawn in both
 * directions, which is the whole point of retraction being distinct from a
 * loss.
 */
function bucketOf(
  publicationStatus: PublicationStatus | null,
  settlementStatus: SettlementStatus | null
): keyof Omit<CorrectionAggregate, "winRate"> | null {
  if (publicationStatus === "retracted") return null;
  if (settlementStatus === "won") return "won";
  if (settlementStatus === "lost") return "lost";
  if (settlementStatus === "push" || settlementStatus === "void" || settlementStatus === "cancelled") return "voided";
  return null;
}

function aggregateFrom(counts: { won: number; lost: number; voided: number }): CorrectionAggregate {
  const decided = counts.won + counts.lost;
  return { ...counts, winRate: decided > 0 ? counts.won / decided : null };
}

function diffStates(previous: LedgerPublicationState, current: LedgerPublicationState): CorrectionFieldChange[] {
  const changes: CorrectionFieldChange[] = [];
  for (const { field, label } of PUBLIC_FIELDS) {
    const before = previous[field] ?? null;
    const after = current[field] ?? null;
    if (before === after) continue;
    changes.push({
      field,
      label,
      previous: typeof before === "number" || typeof before === "string" ? before : null,
      current: typeof after === "number" || typeof after === "string" ? after : null
    });
  }
  return changes;
}

export type CorrectionLogInput = {
  /** Current ledger rows. Only these can close out the newest revision. */
  publications: LedgerPublicationState[];
  revisions: PublicationRevision[];
  availability: DataAvailability;
  unavailableReason?: string | null;
  asOf?: string;
};

/**
 * Build the log. Pure.
 *
 * How the effect on aggregates is derived, and why it is derived this way:
 *
 * The counts are walked forward from the state the ledger was in before any
 * correction landed, applying one correction at a time. Only `publication_status`
 * is varied — settlement is held at each publication's current verdict — because
 * a correction is the only thing this log is measuring. A re-graded result
 * travels through `op_settle_publication`, which supersedes its own prior
 * settlement and is a separate object with a separate audit trail; folding it in
 * here would attribute a scoring change to an editor who never made one.
 *
 * The practical consequence is that only a retraction (or the un-retraction that
 * the schema does not currently allow) can move the counts. A corrected
 * probability, price or explanation reports a zero delta, which is the honest
 * answer: the claim changed, the record did not.
 */
export function buildCorrectionLog({
  publications,
  revisions,
  availability,
  unavailableReason = null,
  asOf = new Date().toISOString()
}: CorrectionLogInput): CorrectionLog {
  if (availability === "unavailable") {
    return {
      availability,
      unavailableReason,
      entries: [],
      corrections: 0,
      retractions: 0,
      unresolved: 0,
      // We could not read the ledger, so we do not know the record. Not zero.
      currentAggregate: null,
      asOf
    };
  }

  const current = new Map(publications.map((publication) => [publication.publicationId, publication]));

  // Group revisions per publication so each one can be closed out by the next
  // capture, or by the live row when it is the most recent.
  const byPublication = new Map<string, PublicationRevision[]>();
  for (const revision of revisions) {
    byPublication.set(revision.publicationId, [...(byPublication.get(revision.publicationId) ?? []), revision]);
  }
  for (const [publicationId, rows] of byPublication) {
    byPublication.set(
      publicationId,
      [...rows].sort((left, right) => left.revision - right.revision)
    );
  }

  type Pending = {
    revision: PublicationRevision;
    before: LedgerPublicationState;
    after: LedgerPublicationState;
  };

  const pending: Pending[] = [];
  let unresolved = 0;

  for (const [publicationId, rows] of byPublication) {
    const live = current.get(publicationId);
    if (!live) {
      // The revision exists but the claim it belongs to is not readable — a
      // draft, or outside the window asked for. Counted, not guessed at.
      unresolved += rows.length;
      continue;
    }
    rows.forEach((revision, index) => {
      const next = rows[index + 1];
      pending.push({
        revision,
        before: stateFromPreviousState(revision.previousState, publicationId),
        after: next ? stateFromPreviousState(next.previousState, publicationId) : live
      });
    });
  }

  // Chronological, because each entry's "before" is the record as it stood
  // once every earlier correction had landed.
  pending.sort((left, right) => {
    const byTime = Date.parse(left.revision.createdAt) - Date.parse(right.revision.createdAt);
    if (byTime !== 0 && Number.isFinite(byTime)) return byTime;
    return left.revision.revision - right.revision.revision;
  });

  // Baseline: every publication as it stood before the first correction touched
  // it, with settlement held at its current verdict.
  const statusNow = new Map<string, PublicationStatus | null>();
  for (const publication of publications) {
    const rows = byPublication.get(publication.publicationId);
    const earliest = rows?.length ? stateFromPreviousState(rows[0].previousState, publication.publicationId) : null;
    statusNow.set(publication.publicationId, earliest ? earliest.publicationStatus : publication.publicationStatus);
  }

  const counts = { won: 0, lost: 0, voided: 0 };
  for (const publication of publications) {
    const bucket = bucketOf(statusNow.get(publication.publicationId) ?? null, publication.settlementStatus);
    if (bucket) counts[bucket] += 1;
  }

  const entries: CorrectionEntry[] = [];
  for (const item of pending) {
    const before = aggregateFrom(counts);
    const live = current.get(item.revision.publicationId);
    const settlement = live?.settlementStatus ?? null;

    const fromBucket = bucketOf(statusNow.get(item.revision.publicationId) ?? null, settlement);
    const toBucket = bucketOf(item.after.publicationStatus, settlement);
    if (fromBucket !== toBucket) {
      if (fromBucket) counts[fromBucket] -= 1;
      if (toBucket) counts[toBucket] += 1;
    }
    statusNow.set(item.revision.publicationId, item.after.publicationStatus);

    const after = aggregateFrom(counts);
    entries.push({
      correctionId: item.revision.revisionId,
      publicationId: item.revision.publicationId,
      revision: item.revision.revision,
      kind: item.after.publicationStatus === "retracted" ? "retraction" : "correction",
      correctedAt: item.revision.createdAt,
      reason: item.revision.reason,
      original: item.before,
      current: item.after,
      changes: diffStates(item.before, item.after),
      effect: {
        before,
        after,
        wonDelta: after.won - before.won,
        lostDelta: after.lost - before.lost,
        voidedDelta: after.voided - before.voided,
        // A move from "no rate" to "a rate" is not a numeric delta, and
        // pretending it is would report a jump from zero that never happened.
        winRateDelta: before.winRate === null || after.winRate === null ? null : after.winRate - before.winRate,
        movedTheRecord: after.won !== before.won || after.lost !== before.lost || after.voided !== before.voided
      }
    });
  }

  entries.reverse();

  return {
    availability: entries.length ? availability : availability === "complete" ? "confirmed_empty" : availability,
    unavailableReason,
    entries,
    corrections: entries.filter((entry) => entry.kind === "correction").length,
    retractions: entries.filter((entry) => entry.kind === "retraction").length,
    unresolved,
    currentAggregate: aggregateFrom(counts),
    asOf
  };
}

/**
 * The log in one sentence, so no surface writes its own version of it.
 *
 * An empty log is a real, sayable result: it means every claim still stands as
 * first published. It is not an error and must not render as one.
 */
export function correctionLogStatement(log: CorrectionLog): string {
  if (log.availability === "unavailable") {
    return `The correction log could not be read${log.unavailableReason ? ` (${log.unavailableReason})` : ""}, so we cannot say whether any claim has been corrected. This is not a claim that none has.`;
  }
  if (!log.entries.length) {
    return "No corrections have been issued. Every published claim stands exactly as it was first published.";
  }
  const parts: string[] = [];
  if (log.corrections) parts.push(`${log.corrections} correction${log.corrections === 1 ? "" : "s"}`);
  if (log.retractions) parts.push(`${log.retractions} retraction${log.retractions === 1 ? "" : "s"}`);
  const moved = log.entries.filter((entry) => entry.effect.movedTheRecord).length;
  return `${parts.join(" and ")} on the record. ${
    moved === 0
      ? "None of them changed the published win, loss or void counts."
      : `${moved} changed the published win, loss or void counts.`
  }`;
}

const LEDGER_COLUMNS =
  "id,fixture_external_id,sport,competition,market,selection,selection_label,market_line," +
  "model_probability,odds_at_publication,implied_probability,published_at,kickoff_at," +
  "publication_status,settlement_status,public_copy_ref,revision";

/** Statuses that were ever a real public claim; a draft was never shown. */
const PUBLIC_STATUSES: PublicationStatus[] = ["published", "corrected", "retracted"];

export type CorrectionLogQuery = {
  /** Maximum revision rows to read. The log is small by design. */
  limit?: number;
  client?: SupabaseClient | null;
  now?: Date;
};

/**
 * Read the log from the ledger.
 *
 * Two reads, not a join: PostgREST embeds on this pair have been a reliable
 * source of trouble, and the revision table is append-only and small. A failed
 * read returns `unavailable` with the reason, never an empty log — "we found no
 * corrections" and "we could not look" are the two things this codebase most
 * insists on keeping apart.
 */
export async function readCorrectionLog({
  limit = 200,
  client = getSupabaseServerClient(),
  now = new Date()
}: CorrectionLogQuery = {}): Promise<CorrectionLog> {
  const asOf = now.toISOString();
  if (!client) {
    return buildCorrectionLog({
      publications: [],
      revisions: [],
      availability: "unavailable",
      unavailableReason: "Supabase server storage is not configured in this runtime.",
      asOf
    });
  }

  const bounded = Math.max(1, Math.min(1000, limit));
  const { data: revisionRows, error: revisionError } = await client
    .from("op_publication_revisions")
    .select("id,publication_id,revision,previous_state,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(bounded);
  if (revisionError) {
    return buildCorrectionLog({
      publications: [],
      revisions: [],
      availability: "unavailable",
      unavailableReason: revisionError.message,
      asOf
    });
  }

  const { data: publicationRows, error: publicationError } = await client
    .from("op_publications")
    .select(LEDGER_COLUMNS)
    .in("publication_status", PUBLIC_STATUSES)
    .limit(1000);
  if (publicationError) {
    return buildCorrectionLog({
      publications: [],
      revisions: [],
      availability: "unavailable",
      unavailableReason: publicationError.message,
      asOf
    });
  }

  const revisions: PublicationRevision[] = (revisionRows ?? []).map((row) => {
    const record = row as unknown as Record<string, unknown>;
    const previous = record.previous_state;
    return {
      revisionId: String(record.id),
      publicationId: String(record.publication_id),
      revision: numberOrNull(record.revision) ?? 1,
      previousState: previous && typeof previous === "object" ? (previous as Record<string, unknown>) : {},
      reason: textOrNull(record.reason) ?? "",
      createdAt: String(record.created_at)
    };
  });

  return buildCorrectionLog({
    publications: (publicationRows ?? []).map((row) => stateFromLedgerRow(row as unknown as Record<string, unknown>)),
    revisions,
    availability: "complete",
    asOf
  });
}
