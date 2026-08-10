import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/results/migrationState";
import { writeExceptions } from "@/lib/settlement/exceptionWriter";
import { legacySelectionKey } from "@/lib/markets/legacyKeys";
import { canonicalSelection, type CanonicalSport } from "@/lib/markets/canonicalMarkets";
import {
  captureClose,
  consensusProbability,
  CLOSING_POLICY_VERSION,
  WINDOW_MINUTES,
  type CaptureStatus,
  type EligibleQuote
} from "@/lib/closing/policy";

/**
 * Capture closing prices for published claims.
 *
 * The policy itself lives in `policy.ts` and is pure; this reads the quotes,
 * hands them over, and writes what comes back — including, and especially, the
 * rows where nothing came back. A claim with no close gets a row saying which
 * of the eight reasons applied, because the alternative is a gap that later
 * reads as a zero.
 *
 * Runs only after kickoff. A closing price cannot be identified before the
 * window has closed: you only know a quote was the last one once the match has
 * started.
 */

export type ClosingCaptureRun = {
  status: "completed" | "preview" | "unavailable" | "partial" | "not-migrated";
  generatedAt: string;
  totals: {
    eligible: number;
    captured: number;
    absent: number;
    failed: number;
  };
  /** Absent closes broken down by reason, so coverage can say why. */
  byStatus: Record<CaptureStatus, number>;
  exceptions: Array<{ kind: string; publicationId: string; detail: Record<string, unknown> }>;
  errors: string[];
};

type PublicationRow = {
  id: string;
  fixture_id: string | null;
  sport: string;
  market: string;
  selection: string;
  market_line: number | null;
  odds_at_publication: number;
  kickoff_at: string;
};

type SnapshotRow = {
  id: string;
  fixture_id: string;
  bookmaker: string;
  market: string;
  selection: string;
  line: number | null;
  decimal_odds: number;
  observed_at: string;
  is_live: boolean | null;
};

/** Exception kind per absent-capture status. Captured rows raise nothing. */
const EXCEPTION_KIND: Partial<Record<CaptureStatus, string>> = {
  insufficient_sources: "close_insufficient_sources",
  no_quotes: "close_missing",
  stale: "close_missing",
  market_unmapped: "close_market_unmapped",
  identity_failure: "close_identity_failure",
  late_provider_data: "close_late_data"
};

type ExistingCaptureRow = {
  publication_id: string;
  capture_status: CaptureStatus;
  closing_odds: number | null;
  source_count: number | null;
};

/**
 * Outcomes a later run cannot improve on.
 *
 * `captured` is finished. `operator_unavailable` is a human decision, and a
 * sweep does not get to overrule one. Every other status is a description of
 * what the database held at one moment, so re-reading it later is the whole
 * point rather than churn.
 */
const TERMINAL_STATUSES = new Set<CaptureStatus>(["captured", "operator_unavailable"]);

/** Upper bounds on one snapshot read. Both bind; whichever is hit first closes the chunk. */
const CHUNK_MAX_PICKS = 25;
const CHUNK_MAX_SPAN_MS = 6 * 60 * 60 * 1000;
const CHUNK_ROW_LIMIT = 6000;
/**
 * PostgREST's own page size (`db-max-rows`), measured against this project.
 * Reads are paged at exactly this size so a short page means "that is all
 * there is" rather than "the server stopped early and did not mention it".
 */
const SNAPSHOT_PAGE = 1000;

/**
 * Group picks into reads that stay near the window each pick actually needs.
 *
 * Greedy over kickoff-sorted picks: a pick joins the open chunk while the chunk
 * holds fewer than `maxPicks` and adding it would not stretch the chunk's
 * kickoff span past `maxSpanMs`. A gap in the calendar therefore starts a new
 * chunk instead of widening the current one, which is the failure this fixes.
 */
export function chunkByKickoffSpan<T extends { kickoff_at: string }>(
  rows: T[],
  maxPicks: number,
  maxSpanMs: number
): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  let firstMs = 0;
  for (const row of rows) {
    const kickoffMs = new Date(row.kickoff_at).getTime();
    const wouldOverflow = current.length >= maxPicks || (current.length > 0 && kickoffMs - firstMs > maxSpanMs);
    if (current.length && wouldOverflow) {
      chunks.push(current);
      current = [];
    }
    if (!current.length) firstMs = Number.isFinite(kickoffMs) ? kickoffMs : 0;
    current.push(row);
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function emptyByStatus(): Record<CaptureStatus, number> {
  return {
    captured: 0,
    insufficient_sources: 0,
    no_quotes: 0,
    stale: 0,
    market_unmapped: 0,
    identity_failure: 0,
    late_provider_data: 0,
    operator_unavailable: 0
  };
}

export async function runClosingCapture({
  limit = 300,
  persist = false,
  now = new Date(),
  client = getSupabaseServerClient()
}: {
  limit?: number;
  persist?: boolean;
  now?: Date;
  client?: SupabaseClient | null;
} = {}): Promise<ClosingCaptureRun> {
  const generatedAt = now.toISOString();
  const totals = { eligible: 0, captured: 0, absent: 0, failed: 0 };
  const byStatus = emptyByStatus();
  const exceptions: ClosingCaptureRun["exceptions"] = [];
  const errors: string[] = [];

  if (!client) {
    return {
      status: "unavailable",
      generatedAt,
      totals,
      byStatus,
      exceptions,
      errors: ["OddsPadi Supabase server storage is not configured."]
    };
  }

  const { data: publicationData, error: publicationError } = await client
    .from("op_publications")
    .select("id,fixture_id,sport,market,selection,market_line,odds_at_publication,kickoff_at")
    .eq("publication_status", "published")
    .lt("kickoff_at", generatedAt)
    .order("kickoff_at", { ascending: false })
    .limit(Math.max(1, Math.min(1000, limit)));
  if (publicationError) {
    return { status: "unavailable", generatedAt, totals, byStatus, exceptions, errors: [publicationError.message] };
  }

  const publications = (publicationData ?? []) as unknown as PublicationRow[];
  if (!publications.length) {
    return { status: persist ? "completed" : "preview", generatedAt, totals, byStatus, exceptions, errors };
  }

  // Claims that already hold a settled outcome are skipped; claims holding an
  // absent one are retried.
  //
  // This used to skip anything with a current row at all, which quietly made
  // every miss permanent — the `no_quotes` row written by the first run after
  // kickoff was the reason the sweep never looked again. Measured on
  // 2026-08-08: all 139 eligible claims carried an absent-capture row, 91 of
  // them had qualifying quotes in the database at the moment their miss was
  // written, and not one had ever been revisited. A miss is a statement about
  // the data available at a moment, and provider data arrives late.
  const { data: existingData, error: existingError } = await client
    .from("op_closing_prices")
    .select("publication_id,capture_status,closing_odds,source_count")
    .eq("is_current", true)
    .in(
      "publication_id",
      publications.map((row) => row.id)
    );
  if (existingError) {
    if (isMissingRelation(existingError, "op_closing_prices")) {
      return {
        status: "not-migrated",
        generatedAt,
        totals,
        byStatus,
        exceptions,
        errors: [`op_closing_prices is not present yet: ${existingError.message}. Apply the migration.`]
      };
    }
    return { status: "unavailable", generatedAt, totals, byStatus, exceptions, errors: [existingError.message] };
  }
  const existingByPublication = new Map<string, ExistingCaptureRow>();
  for (const row of (existingData ?? []) as unknown as ExistingCaptureRow[]) {
    existingByPublication.set(row.publication_id, row);
  }

  const pending = publications.filter((row) => {
    const existing = existingByPublication.get(row.id);
    return !existing || !TERMINAL_STATUSES.has(existing.capture_status);
  });
  totals.eligible = pending.length;
  if (!pending.length) {
    return { status: persist ? "completed" : "preview", generatedAt, totals, byStatus, exceptions, errors };
  }

  /**
   * Quotes are read per chunk of kickoff-adjacent picks, never through one
   * global window.
   *
   * The first live run proved why: 126 pending picks spanning five days
   * produced a single window that matched 77,382 rows — sailing past the
   * 20k PostgREST cap and the 8-second statement timeout, so the sweep
   * honestly refused to write anything. The refusal worked; the read design
   * was the defect, and it is the same over-fetch shape that once truncated
   * this product's odds away. Sorting by kickoff keeps each chunk's window
   * tight, is_live is filtered in SQL where the partial index lives, and the
   * order is DESCENDING so any truncation sheds the oldest quotes — the ones
   * the capture would reject anyway — rather than the closes.
   *
   * Counting picks alone was not enough to keep it tight. A chunk's read window
   * spans `[min(kickoff) − 90m, max(kickoff)]`, so 25 picks straddling a quiet
   * stretch of the calendar produce a window vastly wider than the 90 minutes
   * any single pick needs. Measured on 2026-08-08: one 25-pick chunk spanned
   * 74 hours and matched 12,966 rows against a 6,000-row cap, and a second
   * matched 7,710 — 50 of 139 claims deferred by a window shape rather than by
   * anything about the market. Bounding the chunk by kickoff span as well as by
   * count keeps the read close to the work it is actually doing.
   */
  const ordered = [...pending].sort((a, b) => a.kickoff_at.localeCompare(b.kickoff_at));
  const snapshotRows: SnapshotRow[] = [];
  const truncatedFixtureIds = new Set<string>();

  for (const chunk of chunkByKickoffSpan(ordered, CHUNK_MAX_PICKS, CHUNK_MAX_SPAN_MS)) {
    const fixtureIds = [...new Set(chunk.map((row) => row.fixture_id).filter((value): value is string => Boolean(value)))];
    if (!fixtureIds.length) continue;
    const from = new Date(Math.min(...chunk.map((row) => new Date(row.kickoff_at).getTime())) - WINDOW_MINUTES * 60_000).toISOString();
    const to = new Date(Math.max(...chunk.map((row) => new Date(row.kickoff_at).getTime()))).toISOString();

    /**
     * Paged, because the cap is the server's and not ours.
     *
     * Asking for 6,000 rows does not get 6,000 rows: PostgREST answers with at
     * most `db-max-rows`, which is 1,000 here, and says nothing about having
     * truncated. A guard comparing the returned count against 6,000 therefore
     * never fired, and the sweep carried on with the newest 1,000 quotes in the
     * window. Because those are ordered by observation time across the whole
     * chunk, they belong to the chunk's latest kickoffs, and the earlier picks
     * were handed an empty list — then recorded as "nobody priced this".
     *
     * Measured on 2026-08-08: a 21-fixture chunk returned exactly 1,000 rows
     * covering 12 fixtures, so 9 claims received a confident, false reason. The
     * discipline was right and the number was wrong; paging removes the guess.
     */
    const rows: SnapshotRow[] = [];
    let truncated = false;
    for (let offset = 0; offset < CHUNK_ROW_LIMIT; offset += SNAPSHOT_PAGE) {
      const { data, error } = await client
        .from("op_odds_snapshots")
        .select("id,fixture_id,bookmaker,market,selection,line,decimal_odds,observed_at,is_live")
        .in("fixture_id", fixtureIds)
        .eq("is_live", false)
        .gte("observed_at", from)
        .lte("observed_at", to)
        // Ordered by id as well, so a page boundary landing inside a group of
        // quotes sharing an observation time cannot drop or repeat one.
        .order("observed_at", { ascending: false })
        .order("id", { ascending: false })
        .range(offset, offset + SNAPSHOT_PAGE - 1);
      if (error) {
        // Proceeding would record no_quotes against every claim in the chunk —
        // a permanent, wrong reason written into a row that reads as a finding.
        return { status: "unavailable", generatedAt, totals, byStatus, exceptions, errors: [error.message] };
      }
      const page = (data ?? []) as unknown as SnapshotRow[];
      rows.push(...page);
      if (page.length < SNAPSHOT_PAGE) break;
      if (offset + SNAPSHOT_PAGE >= CHUNK_ROW_LIMIT) truncated = true;
    }

    if (truncated) {
      // No silent caps: a truncated chunk cannot honestly say "nobody priced
      // this", so its picks are skipped this run and the truncation reported.
      for (const id of fixtureIds) truncatedFixtureIds.add(id);
      errors.push(`Snapshot read for a ${fixtureIds.length}-fixture chunk exceeded the ${CHUNK_ROW_LIMIT}-row ceiling; its picks are deferred rather than mis-captured.`);
      continue;
    }
    snapshotRows.push(...rows);
  }

  // One resolver cache for the whole run: a fixture's snapshots repeat the
  // same handful of market/selection pairs thousands of times.
  const identityCache = new Map<string, CanonicalIdentity>();

  const snapshotsByFixture = new Map<string, SnapshotRow[]>();
  for (const row of snapshotRows) {
    const held = snapshotsByFixture.get(row.fixture_id) ?? [];
    held.push(row);
    snapshotsByFixture.set(row.fixture_id, held);
  }

  for (const publication of pending) {
    if (publication.fixture_id && truncatedFixtureIds.has(publication.fixture_id)) continue;
    const selectionKey = legacySelectionKey({
      sport: publication.sport as CanonicalSport,
      market: publication.market,
      selection: publication.selection,
      marketLine: publication.market_line
    });
    const resolved = selectionKey ? canonicalSelection(selectionKey) : null;
    const claim = resolved ? { marketKey: resolved.market.key, selectionId: resolved.selection.id } : null;

    const quotes = claim
      ? buildQuotes(snapshotsByFixture.get(publication.fixture_id ?? "") ?? [], publication, claim, identityCache)
      : [];

    const capture = captureClose({
      selectionKey: selectionKey ?? `${publication.market}.${publication.selection}`,
      selection: resolved?.selection.id ?? publication.selection,
      kickoffAt: publication.kickoff_at,
      quotes,
      marketUnmapped: !resolved,
      identityFailure: !publication.fixture_id
    });

    byStatus[capture.captureStatus] += 1;
    if (capture.captureStatus === "captured") totals.captured += 1;
    else totals.absent += 1;

    const kind = EXCEPTION_KIND[capture.captureStatus];
    if (kind) {
      exceptions.push({
        kind,
        publicationId: publication.id,
        detail: { missingReason: capture.missingReason, sourceCount: capture.sourceCount, rejected: capture.rejected }
      });
    }

    if (!persist) continue;

    const prior = existingByPublication.get(publication.id);
    // An hourly sweep re-reading an unchanged market must not write a new
    // revision every hour. Only an outcome that actually moved is worth a row.
    //
    // Source count is part of "moved" because the reason quotes it: a claim
    // that goes from one book to two is still `insufficient_sources`, but
    // "Only 1 book priced this selection" has become false.
    if (
      prior &&
      prior.capture_status === capture.captureStatus &&
      numeric(prior.closing_odds) === capture.closingOdds &&
      (prior.source_count ?? 0) === capture.sourceCount
    ) {
      continue;
    }

    // Describes the publication, not the close, so it is recorded even when
    // the capture failed — otherwise a retry could not reproduce the CLV.
    const publishedNoVig = publishedProbabilityNoVig(
      snapshotsByFixture.get(publication.fixture_id ?? "") ?? [],
      publication,
      claim,
      identityCache
    );

    const row = {
      publication_id: publication.id,
      fixture_id: publication.fixture_id,
      market: publication.market,
      selection: publication.selection,
      market_line: publication.market_line,
      canonical_selection_key: selectionKey,
      closing_odds: capture.closingOdds,
      closing_probability: capture.closingProbability,
      published_probability_novig: publishedNoVig,
      // `close.v1` has one source method. When a benchmark-book policy is added
      // this becomes a field on the capture rather than a constant here.
      source: "consensus",
      source_count: capture.sourceCount,
      source_bookmakers: capture.sourceBookmakers,
      close_observed_at: capture.closeObservedAt,
      kickoff_at: publication.kickoff_at,
      captured_at: generatedAt,
      capture_status: capture.captureStatus,
      missing_reason: capture.missingReason,
      policy_version: CLOSING_POLICY_VERSION
    };

    // A first attempt inserts. A retry has to retire the prior row and insert
    // in one step, because exactly one row per claim may be current.
    const { error } = prior
      ? await supersede(client, row)
      : await client.from("op_closing_prices").insert(row);
    if (error) {
      totals.failed += 1;
      errors.push(`${publication.id}: ${error.message}`);
    }
  }

  const exceptionWrite = await writeExceptions(
    client,
    exceptions.map((exception) => ({ ...exception, publicationId: exception.publicationId })),
    { persist }
  );
  if (exceptionWrite.errors.length) errors.push(...exceptionWrite.errors);

  const status = !persist ? "preview" : errors.length ? "partial" : "completed";
  return { status, generatedAt, totals, byStatus, exceptions, errors };
}

function numeric(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type ClosingPriceRow = {
  publication_id: string;
  fixture_id: string | null;
  market: string;
  selection: string;
  market_line: number | null;
  canonical_selection_key: string | null;
  closing_odds: number | null;
  closing_probability: number | null;
  published_probability_novig: number | null;
  source: string;
  source_count: number;
  source_bookmakers: string[];
  close_observed_at: string | null;
  kickoff_at: string;
  captured_at: string;
  capture_status: CaptureStatus;
  missing_reason: string | null;
  policy_version: string;
};

/**
 * Replace a claim's current capture with a new attempt.
 *
 * The retirement and the insert are one statement in Postgres rather than three
 * from here: `op_closing_prices_current_idx` permits a single current row per
 * claim, so a client-side sequence that failed midway would leave the claim
 * with no current row and its coverage silently reclassified.
 */
async function supersede(client: SupabaseClient, row: ClosingPriceRow): Promise<{ error: { message: string } | null }> {
  const { error } = await client.rpc("op_supersede_closing_price", {
    p_publication_id: row.publication_id,
    p_fixture_id: row.fixture_id,
    p_market: row.market,
    p_selection: row.selection,
    p_market_line: row.market_line,
    p_canonical_selection_key: row.canonical_selection_key,
    p_closing_odds: row.closing_odds,
    p_closing_probability: row.closing_probability,
    p_published_probability_novig: row.published_probability_novig,
    p_source: row.source,
    p_source_count: row.source_count,
    p_source_bookmakers: row.source_bookmakers,
    p_close_observed_at: row.close_observed_at,
    p_kickoff_at: row.kickoff_at,
    p_captured_at: row.captured_at,
    p_capture_status: row.capture_status,
    p_missing_reason: row.missing_reason,
    p_policy_version: row.policy_version
  });
  return { error: error ? { message: error.message } : null };
}

/**
 * Resolve a stored market/selection pair onto its canonical identity.
 *
 * Both sides of the match go through `legacySelectionKey`, which is the point.
 * The claim side already did; the snapshot side used to be normalised by a
 * small local string tidy-up instead, and the two vocabularies do not agree.
 *
 * Tennis is where that showed. A tennis claim resolves `home` to
 * `tennis.match_winner.full_match.player_a`, while the odds snapshots for the
 * same match store the selection as `home`. Comparing the canonical id against
 * the raw text never matched, so every tennis claim was recorded as
 * `no_quotes` — and the reason was false, not merely unhelpful: measured on
 * 2026-08-08, all 80 eligible tennis claims had a fully priced market inside
 * their window while the ledger said nobody had quoted them.
 *
 * Memoised per run because a fixture's snapshots repeat the same few pairs
 * thousands of times.
 */
type CanonicalIdentity = { marketKey: string; selectionId: string } | null;

function resolveIdentity(
  sport: CanonicalSport,
  market: string,
  selection: string,
  line: number | null,
  cache: Map<string, CanonicalIdentity>
): CanonicalIdentity {
  // Sport belongs in the key. `match_winner/home` resolves to
  // `football.1x2.regulation.home` for one sport and
  // `tennis.match_winner.full_match.player_a` for another, so a key without it
  // lets whichever sport is processed first answer for both.
  const key = `${sport}|${market}|${selection}|${line ?? ""}`;
  const held = cache.get(key);
  if (held !== undefined) return held;
  const legacy = legacySelectionKey({ sport, market, selection, marketLine: line });
  const resolved = legacy ? canonicalSelection(legacy) : null;
  const identity = resolved ? { marketKey: resolved.market.key, selectionId: resolved.selection.id } : null;
  cache.set(key, identity);
  return identity;
}

/**
 * Group a fixture's snapshots into per-book quotes for the claim's selection.
 *
 * The claim's line must match the snapshot's. A quote for the 2.5 line is not a
 * closing price for a 3.5 claim, however close the numbers look, and matching
 * loosely here is how a claim ends up measured against a market it was never
 * taken in. The canonical market must match too, so a totals quote cannot drift
 * into a match-winner claim on the strength of a shared selection word.
 */
function buildQuotes(
  rows: SnapshotRow[],
  publication: PublicationRow,
  claim: { marketKey: string; selectionId: string },
  cache: Map<string, CanonicalIdentity>
): EligibleQuote[] {
  const sport = publication.sport as CanonicalSport;
  const byBookAndTime = new Map<string, EligibleQuote>();
  for (const row of rows) {
    if (!linesMatch(row.line, publication.market_line)) continue;
    const identity = resolveIdentity(sport, row.market, row.selection, row.line, cache);
    if (!identity || identity.marketKey !== claim.marketKey) continue;
    const key = `${row.bookmaker}|${row.observed_at}`;
    const held = byBookAndTime.get(key) ?? {
      bookmaker: row.bookmaker,
      decimalOdds: 0,
      observedAt: row.observed_at,
      marketPrices: []
    };
    held.marketPrices.push({ selection: identity.selectionId, decimalOdds: row.decimal_odds });
    if (identity.selectionId === claim.selectionId) held.decimalOdds = row.decimal_odds;
    byBookAndTime.set(key, held);
  }
  // A quote that never priced our own selection is market context, not a quote
  // for this claim.
  return [...byBookAndTime.values()].filter((quote) => quote.decimalOdds > 1);
}

function linesMatch(snapshotLine: number | null, claimLine: number | null): boolean {
  if (claimLine === null || claimLine === undefined) return true;
  if (snapshotLine === null) return false;
  return Math.abs(snapshotLine - claimLine) < 1e-9;
}

/**
 * The de-vigged probability implied by the price we published at.
 *
 * Taken from the market as it stood at publication rather than at the close, so
 * the probability CLV compares two points in time rather than one point against
 * itself.
 */
function publishedProbabilityNoVig(
  rows: SnapshotRow[],
  publication: PublicationRow,
  claim: { marketKey: string; selectionId: string } | null,
  cache: Map<string, CanonicalIdentity>
): number | null {
  if (!claim) return null;
  const quotes = buildQuotes(
    rows.filter((row) => row.observed_at <= publication.kickoff_at),
    publication,
    claim,
    cache
  );
  if (!quotes.length) return null;
  const value = consensusProbability(quotes, claim.selectionId);
  return value === null ? null : Number(value.toFixed(6));
}
