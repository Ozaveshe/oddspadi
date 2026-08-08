import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  countsTowardRecord,
  isDataAvailability,
  isDecisionStatus,
  settlementStatusFromLegacy,
  type DataAvailability,
  type DecisionStatus,
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

/* -------------------------------------------------------------------------
 * The detailed read, for the public track record.
 *
 * `OfficialPublicationSummary` carries what a headline needs. A record table
 * has to show *why* a claim was made — under which model, calibration and
 * decision tier, against what evidence, and how long before kickoff — and it
 * has to be filterable on all of it. Those columns are read here rather than
 * being bolted onto the summary so that every existing caller keeps its
 * current payload: this ledger is read on the homepage, and widening the
 * default select would make every one of those reads heavier for nothing.
 * ---------------------------------------------------------------------- */

export type OfficialPublicationDetail = OfficialPublicationSummary & {
  marketLine: number | null;
  modelVersion: string | null;
  featureSetVersion: string | null;
  calibrationVersion: string | null;
  decisionPolicyVersion: string | null;
  decisionStatus: DecisionStatus | null;
  dataQuality: DataAvailability | null;
  evidenceCutoffAt: string | null;
  oddsSnapshotAt: string | null;
  publicCopyRef: string | null;
  supersedesPublicationId: string | null;
  /**
   * The closing price, when the ledger carries one.
   *
   * Closing odds are not a ledger column. They are captured after kickoff by a
   * separate sweep and, when a publication has one, it is written into the
   * row's `metadata`. Most rows do not have one, which is why every
   * closing-line figure on the track record is reported with its coverage
   * beside it rather than as a bare average over whatever happened to be
   * present.
   */
  closingOdds: number | null;
};

const PUBLICATION_DETAIL_COLUMNS =
  `${PUBLICATION_COLUMNS},market_line,model_version,feature_set_version,calibration_version,` +
  "decision_policy_version,decision_status,data_quality,evidence_cutoff_at,odds_snapshot_at," +
  "public_copy_ref,supersedes_publication_id,metadata";

/** Keys a closing price has been written under. Checked in order. */
const CLOSING_ODDS_KEYS = ["closingOdds", "closing_odds", "closingPrice", "closing_price"];

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

function closingOddsFromMetadata(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as Record<string, unknown>;
  for (const key of CLOSING_ODDS_KEYS) {
    const value = numberOrNull(record[key]);
    // A closing price of 1.00 or less is not a price; treat it as absent
    // rather than letting it drag an average down.
    if (value !== null && value > 1) return value;
  }
  return null;
}

function rowToDetail(row: Record<string, unknown>): OfficialPublicationDetail {
  const decisionStatus = textOrNull(row.decision_status);
  const dataQuality = textOrNull(row.data_quality);
  return {
    ...rowToSummary(row),
    marketLine: numberOrNull(row.market_line),
    modelVersion: textOrNull(row.model_version),
    featureSetVersion: textOrNull(row.feature_set_version),
    calibrationVersion: textOrNull(row.calibration_version),
    decisionPolicyVersion: textOrNull(row.decision_policy_version),
    decisionStatus: isDecisionStatus(decisionStatus) ? decisionStatus : null,
    dataQuality: isDataAvailability(dataQuality) ? dataQuality : null,
    evidenceCutoffAt: textOrNull(row.evidence_cutoff_at),
    oddsSnapshotAt: textOrNull(row.odds_snapshot_at),
    publicCopyRef: textOrNull(row.public_copy_ref),
    supersedesPublicationId: textOrNull(row.supersedes_publication_id),
    closingOdds: closingOddsFromMetadata(row.metadata)
  };
}

/**
 * A keyset cursor over `(published_at, id)`.
 *
 * Offset pagination re-reads and discards every earlier row, so page 40 costs
 * forty pages of work; on a ledger that is meant to grow for years that is the
 * page that eventually times out. Keyset costs the same at page 1 and page
 * 4,000. The id is part of the key because several picks are published in the
 * same transaction and therefore share a timestamp to the microsecond.
 */
export type PublicationCursor = { publishedAt: string; id: string };

export function encodePublicationCursor(cursor: PublicationCursor): string {
  return `${cursor.publishedAt}|${cursor.id}`;
}

export function decodePublicationCursor(value: string | null | undefined): PublicationCursor | null {
  if (!value) return null;
  const separator = value.lastIndexOf("|");
  if (separator <= 0) return null;
  const publishedAt = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!id || Number.isNaN(Date.parse(publishedAt))) return null;
  return { publishedAt, id };
}

/**
 * PostgREST caps a response at `db-max-rows` regardless of `.limit()`, and it
 * does it silently — a truncated page looks exactly like a complete one. Every
 * read here therefore asks for one row more than it needs and treats the
 * surplus as "there is another page", rather than trusting a count.
 */
export const LEDGER_PAGE_MAX = 200;

/**
 * Every ledger read is bounded by a client-side deadline as well as by row
 * count. Postgres enforces an 8s statement timeout on the public role, but a
 * request that is queued rather than executing is not covered by it — and a
 * public page that hangs is worse than a public page that says it could not
 * read the ledger.
 */
const LEDGER_READ_TIMEOUT_MS = 4_000;

export type OfficialPublicationPageQuery = {
  /** Inclusive ISO lower bound on `published_at`. */
  publishedSince?: string | null;
  /** Exclusive ISO upper bound on `published_at`. */
  publishedUntil?: string | null;
  sport?: string | null;
  pageSize?: number;
  cursor?: PublicationCursor | null;
  client?: SupabaseClient | null;
};

export type OfficialPublicationDetailPage = {
  availability: DataAvailability;
  unavailableReason: string | null;
  items: OfficialPublicationDetail[];
  nextCursor: PublicationCursor | null;
};

function applyWindow<T extends { gte: unknown }>(builder: T, publishedSince?: string | null, publishedUntil?: string | null): T {
  let query = builder as unknown as {
    gte: (column: string, value: string) => typeof query;
    lt: (column: string, value: string) => typeof query;
  };
  if (publishedSince) query = query.gte("published_at", publishedSince);
  if (publishedUntil) query = query.lt("published_at", publishedUntil);
  return query as unknown as T;
}

/**
 * One keyset page of the ledger, newest publication first.
 *
 * A failed read returns `unavailable` with the reason and no rows. It never
 * returns an empty page, because an empty page and an unreadable one render
 * as the same "nothing here" unless the caller is told which it is.
 */
export async function readOfficialPublicationPage({
  publishedSince = null,
  publishedUntil = null,
  sport = null,
  pageSize = 50,
  cursor = null,
  client = getSupabaseServerClient()
}: OfficialPublicationPageQuery = {}): Promise<OfficialPublicationDetailPage> {
  if (!client) {
    return {
      availability: "unavailable",
      unavailableReason: "Supabase server storage is not configured in this runtime.",
      items: [],
      nextCursor: null
    };
  }
  const bounded = Math.max(1, Math.min(LEDGER_PAGE_MAX, Math.trunc(pageSize) || 1));
  let query = client
    .from("op_publications")
    .select(PUBLICATION_DETAIL_COLUMNS)
    .in("publication_status", PUBLIC_STATUSES)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    // One extra row is the only reliable "is there more?" signal when the
    // server may silently cap the response below what was asked for.
    .limit(bounded + 1)
    .abortSignal(AbortSignal.timeout(LEDGER_READ_TIMEOUT_MS));
  if (sport) query = query.eq("sport", sport);
  query = applyWindow(query, publishedSince, publishedUntil);
  if (cursor) {
    query = query.or(
      `published_at.lt.${cursor.publishedAt},and(published_at.eq.${cursor.publishedAt},id.lt.${cursor.id})`
    );
  }

  const { data, error } = await query;
  if (error) {
    return { availability: "unavailable", unavailableReason: error.message, items: [], nextCursor: null };
  }
  const rows = (data ?? []).map((row) => rowToDetail(row as unknown as Record<string, unknown>));
  const hasMore = rows.length > bounded;
  const items = hasMore ? rows.slice(0, bounded) : rows;
  const last = items[items.length - 1];
  return {
    availability: items.length ? "complete" : "confirmed_empty",
    unavailableReason: null,
    items,
    nextCursor: hasMore && last ? { publishedAt: last.publishedAt, id: last.publicationId } : null
  };
}

/**
 * Every publication in a window, gathered by walking keyset pages.
 *
 * A summary is an aggregate over the whole period, so it cannot be computed
 * from one page — but it also must not become an unbounded scan. This walks at
 * most `maxRows` and, if it stops early, returns `partial`. A partial sweep is
 * reported as partial; it is never presented as the complete record, because a
 * hit rate over the most recent 20,000 of 60,000 picks is a different claim
 * from a hit rate over all of them.
 */
export const LEDGER_SWEEP_MAX_ROWS = 20_000;
const LEDGER_SWEEP_PAGE = 1_000;

export async function readOfficialPublicationsInWindow({
  publishedSince = null,
  publishedUntil = null,
  sport = null,
  maxRows = LEDGER_SWEEP_MAX_ROWS,
  client = getSupabaseServerClient()
}: Omit<OfficialPublicationPageQuery, "pageSize" | "cursor"> & { maxRows?: number } = {}): Promise<{
  availability: DataAvailability;
  unavailableReason: string | null;
  items: OfficialPublicationDetail[];
  truncated: boolean;
}> {
  const items: OfficialPublicationDetail[] = [];
  let cursor: PublicationCursor | null = null;
  const cap = Math.max(1, maxRows);

  while (items.length < cap) {
    const page: OfficialPublicationDetailPage = await readOfficialPublicationPage({
      publishedSince,
      publishedUntil,
      sport,
      pageSize: Math.min(LEDGER_SWEEP_PAGE, cap - items.length),
      cursor,
      client
    });
    if (page.availability === "unavailable") {
      return { availability: "unavailable", unavailableReason: page.unavailableReason, items: [], truncated: false };
    }
    items.push(...page.items);
    if (!page.nextCursor) {
      return {
        availability: items.length ? "complete" : "confirmed_empty",
        unavailableReason: null,
        items,
        truncated: false
      };
    }
    cursor = page.nextCursor;
  }
  return { availability: "partial", unavailableReason: null, items, truncated: true };
}

/**
 * The ledger's real extent: first publication, last publication, total count.
 *
 * This is what lets a period control offer "previous month" honestly on a
 * ledger one day old. Three indexed reads, none of which returns a row body.
 */
export type LedgerExtent = {
  availability: DataAvailability;
  unavailableReason: string | null;
  firstPublishedAt: string | null;
  lastPublishedAt: string | null;
  totalPublished: number | null;
};

export async function readLedgerExtent(
  client: SupabaseClient | null = getSupabaseServerClient()
): Promise<LedgerExtent> {
  if (!client) {
    return {
      availability: "unavailable",
      unavailableReason: "Supabase server storage is not configured in this runtime.",
      firstPublishedAt: null,
      lastPublishedAt: null,
      totalPublished: null
    };
  }
  const edge = async (ascending: boolean) =>
    client
      .from("op_publications")
      .select("published_at")
      .in("publication_status", PUBLIC_STATUSES)
      .order("published_at", { ascending })
      .limit(1)
      .abortSignal(AbortSignal.timeout(LEDGER_READ_TIMEOUT_MS));

  const [{ data: firstRows, error: firstError }, { data: lastRows, error: lastError }, counted] = await Promise.all([
    edge(true),
    edge(false),
    client
      .from("op_publications")
      .select("id", { count: "exact", head: true })
      .in("publication_status", PUBLIC_STATUSES)
      .abortSignal(AbortSignal.timeout(LEDGER_READ_TIMEOUT_MS))
  ]);

  const error = firstError ?? lastError ?? counted.error;
  if (error) {
    return {
      availability: "unavailable",
      unavailableReason: error.message,
      firstPublishedAt: null,
      lastPublishedAt: null,
      totalPublished: null
    };
  }
  const first = textOrNull((firstRows?.[0] as Record<string, unknown> | undefined)?.published_at);
  const last = textOrNull((lastRows?.[0] as Record<string, unknown> | undefined)?.published_at);
  return {
    availability: first ? "complete" : "confirmed_empty",
    unavailableReason: null,
    firstPublishedAt: first,
    lastPublishedAt: last,
    totalPublished: counted.count ?? 0
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

export type PublicationReceipt = {
  availability: DataAvailability;
  unavailableReason: string | null;
  publication: OfficialPublicationDetail | null;
  /** Every settlement ever recorded, current one first. */
  settlements: Array<{
    settlementId: string;
    status: SettlementStatus;
    settledAt: string;
    isCurrent: boolean;
    resolutionBasis: Record<string, unknown>;
  }>;
  /** Append-only prior states, oldest first. */
  revisions: Array<{ revisionId: string; revision: number; reason: string; createdAt: string; previousState: Record<string, unknown> }>;
};

/**
 * The audit trail for one published claim.
 *
 * Three reads rather than an embed: PostgREST foreign-key embeds across this
 * trio have been a recurring source of silently empty arrays in this codebase,
 * and each of the three is a single-row-or-few lookup on an indexed key.
 */
export async function readPublicationReceipt(
  publicationId: string,
  client: SupabaseClient | null = getSupabaseServerClient()
): Promise<PublicationReceipt> {
  const empty = (availability: DataAvailability, unavailableReason: string | null): PublicationReceipt => ({
    availability,
    unavailableReason,
    publication: null,
    settlements: [],
    revisions: []
  });
  if (!client) return empty("unavailable", "Supabase server storage is not configured in this runtime.");
  if (!publicationId) return empty("confirmed_empty", null);

  const { data: rows, error } = await client
    .from("op_publications")
    .select(PUBLICATION_DETAIL_COLUMNS)
    .eq("id", publicationId)
    .in("publication_status", PUBLIC_STATUSES)
    .limit(1);
  if (error) return empty("unavailable", error.message);
  const row = rows?.[0];
  if (!row) return empty("confirmed_empty", null);
  const publication = rowToDetail(row as unknown as Record<string, unknown>);

  const [settlementResult, revisionResult] = await Promise.all([
    client
      .from("op_publication_settlements")
      .select("id,status,settled_at,is_current,resolution_basis")
      .eq("publication_id", publicationId)
      .order("settled_at", { ascending: false })
      .limit(50),
    client
      .from("op_publication_revisions")
      .select("id,revision,reason,created_at,previous_state")
      .eq("publication_id", publicationId)
      .order("revision", { ascending: true })
      .limit(50)
  ]);

  // The claim itself read fine. A failed companion read degrades the receipt to
  // partial rather than throwing the whole page away.
  const companionFailed = Boolean(settlementResult.error || revisionResult.error);
  return {
    availability: companionFailed ? "partial" : "complete",
    unavailableReason: settlementResult.error?.message ?? revisionResult.error?.message ?? null,
    publication,
    settlements: (settlementResult.data ?? []).map((entry) => {
      const record = entry as unknown as Record<string, unknown>;
      const basis = record.resolution_basis;
      return {
        settlementId: String(record.id),
        status: settlementStatusFromLegacy(textOrNull(record.status)),
        settledAt: String(record.settled_at),
        isCurrent: Boolean(record.is_current),
        resolutionBasis: basis && typeof basis === "object" ? (basis as Record<string, unknown>) : {}
      };
    }),
    revisions: (revisionResult.data ?? []).map((entry) => {
      const record = entry as unknown as Record<string, unknown>;
      const previous = record.previous_state;
      return {
        revisionId: String(record.id),
        revision: numberOrNull(record.revision) ?? 1,
        reason: textOrNull(record.reason) ?? "",
        createdAt: String(record.created_at),
        previousState: previous && typeof previous === "object" ? (previous as Record<string, unknown>) : {}
      };
    })
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
