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

  // Skip claims that already have a current capture. Re-capturing would produce
  // a second row for the same claim, and a retry is an operator action with its
  // own endpoint rather than something a sweep does by accident.
  const { data: existingData, error: existingError } = await client
    .from("op_closing_prices")
    .select("publication_id")
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
  const alreadyCaptured = new Set(
    ((existingData ?? []) as unknown as Array<{ publication_id: string }>).map((row) => row.publication_id)
  );

  const pending = publications.filter((row) => !alreadyCaptured.has(row.id));
  totals.eligible = pending.length;
  if (!pending.length) {
    return { status: persist ? "completed" : "preview", generatedAt, totals, byStatus, exceptions, errors };
  }

  const earliestWindow = new Date(
    Math.min(...pending.map((row) => new Date(row.kickoff_at).getTime())) - WINDOW_MINUTES * 60_000
  ).toISOString();

  const { data: snapshotData, error: snapshotError } = await client
    .from("op_odds_snapshots")
    .select("fixture_id,bookmaker,market,selection,line,decimal_odds,observed_at,is_live")
    // Joined on the uuid foreign key, not on fixture_external_id. Both tables
    // carry that text column and two different write paths populate it, so a
    // namespace mismatch would silently report no_quotes against every claim —
    // a wrong reason, permanently, in a row that reads as a finding.
    .in(
      "fixture_id",
      [...new Set(pending.map((row) => row.fixture_id).filter((value): value is string => Boolean(value)))]
    )
    .gte("observed_at", earliestWindow)
    .order("observed_at", { ascending: true })
    .limit(20_000);
  if (snapshotError) {
    // Proceeding here would record `no_quotes` against every claim in the batch
    // — a permanent, wrong reason written into a row that reads as a finding.
    return { status: "unavailable", generatedAt, totals, byStatus, exceptions, errors: [snapshotError.message] };
  }

  const snapshotsByFixture = new Map<string, SnapshotRow[]>();
  for (const row of (snapshotData ?? []) as unknown as SnapshotRow[]) {
    if (row.is_live) continue;
    const held = snapshotsByFixture.get(row.fixture_id) ?? [];
    held.push(row);
    snapshotsByFixture.set(row.fixture_id, held);
  }

  for (const publication of pending) {
    const selectionKey = legacySelectionKey({
      sport: publication.sport as CanonicalSport,
      market: publication.market,
      selection: publication.selection,
      marketLine: publication.market_line
    });
    const resolved = selectionKey ? canonicalSelection(selectionKey) : null;

    const quotes = resolved
      ? buildQuotes(snapshotsByFixture.get(publication.fixture_id ?? "") ?? [], publication, resolved.selection.id)
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

    const { error } = await client.from("op_closing_prices").insert({
      publication_id: publication.id,
      fixture_id: publication.fixture_id,
      market: publication.market,
      selection: publication.selection,
      market_line: publication.market_line,
      canonical_selection_key: selectionKey,
      closing_odds: capture.closingOdds,
      closing_probability: capture.closingProbability,
      // Describes the publication, not the close, so it is recorded even when
      // the capture failed — otherwise a retry could not reproduce the CLV.
      published_probability_novig: publishedProbabilityNoVig(
        snapshotsByFixture.get(publication.fixture_id ?? "") ?? [],
        publication,
        resolved?.selection.id ?? null
      ),
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
    });
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

/**
 * Group a fixture's snapshots into per-book quotes for the claim's selection.
 *
 * The claim's line must match the snapshot's. A quote for the 2.5 line is not a
 * closing price for a 3.5 claim, however close the numbers look, and matching
 * loosely here is how a claim ends up measured against a market it was never
 * taken in.
 */
function buildQuotes(rows: SnapshotRow[], publication: PublicationRow, selectionId: string): EligibleQuote[] {
  const byBookAndTime = new Map<string, EligibleQuote>();
  for (const row of rows) {
    if (!linesMatch(row.line, publication.market_line)) continue;
    const key = `${row.bookmaker}|${row.observed_at}`;
    const held = byBookAndTime.get(key) ?? {
      bookmaker: row.bookmaker,
      decimalOdds: 0,
      observedAt: row.observed_at,
      marketPrices: []
    };
    held.marketPrices.push({ selection: normaliseSelection(row.selection), decimalOdds: row.decimal_odds });
    if (normaliseSelection(row.selection) === selectionId) held.decimalOdds = row.decimal_odds;
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

/** `over_25` and `over` are the same selection wearing the legacy line suffix. */
function normaliseSelection(selection: string): string {
  const value = selection.trim().toLowerCase();
  const totals = /^(over|under)_\d+$/.exec(value);
  if (totals) return totals[1]!;
  if (value === "home_cover") return "home";
  if (value === "away_cover") return "away";
  return value;
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
  selectionId: string | null
): number | null {
  if (!selectionId) return null;
  const quotes = buildQuotes(
    rows.filter((row) => row.observed_at <= publication.kickoff_at),
    publication,
    selectionId
  );
  if (!quotes.length) return null;
  const value = consensusProbability(quotes, selectionId);
  return value === null ? null : Number(value.toFixed(6));
}
