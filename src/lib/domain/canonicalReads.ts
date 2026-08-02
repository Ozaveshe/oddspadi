import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  countsTowardRecord,
  settlementStatusFromLegacy,
  type DataAvailability,
  type PublicationStatus,
  type SettlementStatus
} from "@/lib/domain/states";

/**
 * The one read contract for official OddsPadi truth.
 *
 * Every public surface that shows a pick count, a record, an accuracy or an
 * ROI must call through here. Before this existed, six lineages each computed
 * "the record" from a different table with a different denominator, which is
 * how /news could describe graded picks in a week where the official ledger
 * held none.
 *
 * Two rules make this contract trustworthy:
 *
 * 1. **A failed read is never a zero.** Every result carries `availability`.
 *    `confirmed_empty` means the query succeeded and there is genuinely
 *    nothing; `unavailable` means we could not ask. Callers must render those
 *    differently — a database outage that displays as "0 picks, 0% accuracy"
 *    is a false claim about the product's record.
 * 2. **Only the ledger counts.** Reads are constrained to `op_publications`,
 *    which by schema can only hold `official_public_pick` rows. Shadow runs,
 *    backtests, community tips and editorial observations are unreachable
 *    from here by construction, not by filtering discipline.
 */
export type OfficialPublicationSummary = {
  publicationId: string;
  fixtureId: string;
  fixtureExternalId: string;
  sport: string;
  competition: string;
  market: string;
  selection: string;
  selectionLabel: string;
  modelProbability: number;
  oddsAtPublication: number;
  impliedProbability: number;
  publishedAt: string;
  kickoffAt: string;
  publicationStatus: PublicationStatus;
  settlementStatus: SettlementStatus;
  settledAt: string | null;
  correctionReason: string | null;
  revision: number;
};

export type OfficialPerformance = {
  availability: DataAvailability;
  /** Human-readable reason when availability is `unavailable`. */
  unavailableReason: string | null;
  totalPublished: number;
  /** Terminal outcomes of any kind. */
  settled: number;
  won: number;
  lost: number;
  push: number;
  voided: number;
  cancelled: number;
  pendingVerification: number;
  unsettled: number;
  /**
   * won / (won + lost). Null — never zero — when nothing has been decided:
   * a model with no settled picks has no accuracy, and 0% is a claim.
   */
  accuracy: number | null;
  /** Flat-stake return over decided picks. Null when nothing is decided. */
  roi: number | null;
  asOf: string;
};

const PUBLICATION_COLUMNS =
  "id,fixture_id,fixture_external_id,sport,competition,market,selection,selection_label," +
  "model_probability,odds_at_publication,implied_probability,published_at,kickoff_at," +
  "publication_status,settlement_status,settled_at,correction_reason,revision";

/** Statuses that represent a real public claim; drafts were never shown. */
const PUBLIC_STATUSES: PublicationStatus[] = ["published", "corrected", "retracted"];

function rowToSummary(row: Record<string, unknown>): OfficialPublicationSummary {
  return {
    publicationId: String(row.id),
    fixtureId: String(row.fixture_id),
    fixtureExternalId: String(row.fixture_external_id),
    sport: String(row.sport),
    competition: String(row.competition),
    market: String(row.market),
    selection: String(row.selection),
    selectionLabel: String(row.selection_label),
    modelProbability: Number(row.model_probability),
    oddsAtPublication: Number(row.odds_at_publication),
    impliedProbability: Number(row.implied_probability),
    publishedAt: String(row.published_at),
    kickoffAt: String(row.kickoff_at),
    publicationStatus: String(row.publication_status) as PublicationStatus,
    settlementStatus: settlementStatusFromLegacy(String(row.settlement_status)),
    settledAt: row.settled_at ? String(row.settled_at) : null,
    correctionReason: row.correction_reason ? String(row.correction_reason) : null,
    revision: Number(row.revision) || 1
  };
}

export type OfficialPublicationQuery = {
  sport?: string;
  /** Inclusive ISO lower bound on kickoff. */
  since?: string;
  /** Exclusive ISO upper bound on kickoff. */
  until?: string;
  limit?: number;
  client?: SupabaseClient | null;
};

export type OfficialPublicationPage = {
  availability: DataAvailability;
  unavailableReason: string | null;
  items: OfficialPublicationSummary[];
};

export async function readOfficialPublications({
  sport,
  since,
  until,
  limit = 500,
  client = getSupabaseServerClient()
}: OfficialPublicationQuery = {}): Promise<OfficialPublicationPage> {
  if (!client) {
    return {
      availability: "unavailable",
      unavailableReason: "Supabase server storage is not configured in this runtime.",
      items: []
    };
  }
  let query = client
    .from("op_publications")
    .select(PUBLICATION_COLUMNS)
    .in("publication_status", PUBLIC_STATUSES)
    .order("kickoff_at", { ascending: false })
    .limit(Math.max(1, Math.min(1000, limit)));
  if (sport) query = query.eq("sport", sport);
  if (since) query = query.gte("kickoff_at", since);
  if (until) query = query.lt("kickoff_at", until);

  const { data, error } = await query;
  if (error) {
    // The distinction that matters: we could not ask, so we do not know.
    return { availability: "unavailable", unavailableReason: error.message, items: [] };
  }
  const items = (data ?? []).map((row) => rowToSummary(row as unknown as Record<string, unknown>));
  return {
    availability: items.length ? "complete" : "confirmed_empty",
    unavailableReason: null,
    items
  };
}

/**
 * Resolve specific publications by id.
 *
 * This is how editorial content cites the ledger: an article stores the ids it
 * described and re-resolves them at render time, so a corrected or retracted
 * claim cannot keep being repeated by an article that was generated before the
 * correction.
 */
export async function readPublicationsByIds(
  publicationIds: string[],
  client: SupabaseClient | null = getSupabaseServerClient()
): Promise<OfficialPublicationPage> {
  const ids = [...new Set(publicationIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (!ids.length) return { availability: "confirmed_empty", unavailableReason: null, items: [] };
  if (!client) {
    return {
      availability: "unavailable",
      unavailableReason: "Supabase server storage is not configured in this runtime.",
      items: []
    };
  }
  const { data, error } = await client.from("op_publications").select(PUBLICATION_COLUMNS).in("id", ids.slice(0, 200));
  if (error) return { availability: "unavailable", unavailableReason: error.message, items: [] };
  const items = (data ?? []).map((row) => rowToSummary(row as unknown as Record<string, unknown>));
  return {
    availability: items.length ? (items.length === ids.length ? "complete" : "partial") : "confirmed_empty",
    unavailableReason: null,
    items
  };
}

/** Aggregate a set of publications into the official record. Pure. */
export function summarisePublications(
  items: OfficialPublicationSummary[],
  availability: DataAvailability,
  unavailableReason: string | null = null,
  asOf = new Date().toISOString()
): OfficialPerformance {
  // A retracted claim is withdrawn: it stays visible for audit but must not
  // score, in either direction.
  const scorable = items.filter((item) => item.publicationStatus !== "retracted");
  const tally = (status: SettlementStatus) => scorable.filter((item) => item.settlementStatus === status).length;
  const won = tally("won");
  const lost = tally("lost");
  const decided = won + lost;
  const settled = scorable.filter((item) => item.settlementStatus !== "unsettled" && item.settlementStatus !== "pending_verification").length;

  // Flat one-unit stake per decided pick, at the price the claim was struck.
  const returns = scorable
    .filter((item) => countsTowardRecord(item.settlementStatus))
    .reduce((sum, item) => sum + (item.settlementStatus === "won" ? item.oddsAtPublication : 0), 0);

  return {
    availability,
    unavailableReason,
    totalPublished: scorable.length,
    settled,
    won,
    lost,
    push: tally("push"),
    voided: tally("void"),
    cancelled: tally("cancelled"),
    pendingVerification: tally("pending_verification"),
    unsettled: tally("unsettled"),
    accuracy: decided > 0 ? won / decided : null,
    roi: decided > 0 ? (returns - decided) / decided : null,
    asOf
  };
}

export async function readOfficialPerformance(query: OfficialPublicationQuery = {}): Promise<OfficialPerformance> {
  const page = await readOfficialPublications({ ...query, limit: query.limit ?? 1000 });
  return summarisePublications(page.items, page.availability, page.unavailableReason);
}

/**
 * The official count, stated in one sentence, for surfaces that only need the
 * headline. Kept here so no page writes its own version of this string.
 */
export function officialPerformanceStatement(performance: OfficialPerformance): string {
  if (performance.availability === "unavailable") {
    return "The official pick ledger could not be read, so no record is shown. This is not a zero.";
  }
  if (performance.totalPublished === 0) {
    return "No official public picks have been published yet, so there is no public record to report.";
  }
  if (performance.accuracy === null) {
    return `${performance.totalPublished} official pick${performance.totalPublished === 1 ? "" : "s"} published; none has settled yet.`;
  }
  return `${performance.won}-${performance.lost} from ${performance.won + performance.lost} settled official picks (${Math.round(performance.accuracy * 100)}%).`;
}
