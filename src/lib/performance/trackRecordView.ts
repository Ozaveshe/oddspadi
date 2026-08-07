import type { SupabaseClient } from "@supabase/supabase-js";
import {
  encodePublicationCursor,
  readLedgerExtent,
  readOfficialPublicationsInWindow,
  type OfficialPublicationDetail
} from "@/lib/domain/canonicalReads";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { DataAvailability, SettlementStatus } from "@/lib/domain/states";
import { oddsBandFor } from "@/lib/performance/ledgerMetrics";
import {
  EVIDENCE_CLASSES,
  type EvidenceClass
} from "@/lib/performance/trackRecordEvidence";
import {
  ANY,
  CURSOR_PARAM,
  applyTrackRecordFilters,
  activeTrackRecordFilters,
  buildFilterOptions,
  describeTrackRecordFilters,
  leadTimeBandOf,
  leadTimeHours,
  marketFamilyOf,
  parsePageSize,
  parsePeriodRequest,
  parseTrackRecordFilters,
  probabilityBandOf,
  selectionTypeOf,
  trackRecordHref,
  type ActiveFilter,
  type SearchParamRecord,
  type TrackRecordFilterOptions,
  type TrackRecordFilters
} from "@/lib/performance/trackRecordFilters";
import {
  calendarDaySpan,
  describePeriodCoverage,
  resolveTrackRecordPeriod,
  type LedgerSpan,
  type PeriodCoverage,
  type ResolvedTrackRecordPeriod
} from "@/lib/performance/trackRecordPeriods";
import {
  computeTrackRecordSummary,
  publicationClosingLineValue,
  publicationUnitReturn,
  unavailableTrackRecordSummary,
  type TrackRecordSummary
} from "@/lib/performance/trackRecordSummary";

/**
 * One view model for the public track record.
 *
 * The page, the table and both exports are rendered from this single object.
 * That is the property the page is for: a headline that is computed in a page
 * component and an export that is computed in a route handler will eventually
 * disagree, and the export is the copy that gets forwarded to somebody who
 * cannot see the page it came from.
 *
 * Three behaviours are deliberate and load-bearing.
 *
 * **A failed read is unavailable or last-known-good — never zero.** When the
 * ledger cannot be read, the view is returned with `presentation:
 * "unavailable"` and a summary of nulls, or, if this runtime has served the
 * same query successfully before, with the previous answer and
 * `presentation: "last-known-good"` plus the age of that answer. What never
 * happens is a page of zeroes, which reads as "we published picks and none of
 * them won".
 *
 * **The summary and the table are the same rows.** The period sweep happens
 * once; filters are applied once; the table is a slice of the filtered array.
 * The headline therefore equals the sum of the rows by construction rather
 * than by coincidence, which is the property the reconciliation test pins.
 *
 * **Reads are bounded.** The sweep is keyset-paginated and stops at a row cap,
 * and a sweep that stops early is reported as `partial` rather than presented
 * as the complete record. PostgREST silently truncates at `db-max-rows`, so an
 * unbounded read does not fail loudly — it returns a wrong number confidently.
 */

/** Rows swept for the on-page summary. Five keyset round trips at most. */
export const TRACK_RECORD_SUMMARY_MAX_ROWS = 5_000;
/** Rows swept for an export, which is allowed to be slower than a page. */
export const TRACK_RECORD_EXPORT_MAX_ROWS = 20_000;

export type TrackRecordPresentation = "live" | "last-known-good" | "unavailable";

export type TrackRecordRow = {
  publicationId: string;
  publishedAt: string;
  kickoffAt: string;
  /** Home v away when the display join resolved it; the external id otherwise. */
  fixtureLabel: string;
  fixtureExternalId: string;
  sport: string;
  competition: string;
  market: string;
  marketFamily: string;
  selection: string;
  selectionLabel: string;
  selectionType: string;
  marketLine: number | null;
  oddsAtPublication: number;
  oddsBand: string;
  modelProbability: number;
  /** 1 / model probability: the price at which the model is indifferent. */
  fairOdds: number;
  probabilityBand: string;
  closingOdds: number | null;
  closingLineValue: number | null;
  settlementStatus: SettlementStatus;
  settledAt: string | null;
  /** One-unit profit. Null for pending, push, void and cancelled. */
  unitReturn: number | null;
  modelVersion: string | null;
  calibrationVersion: string | null;
  decisionTier: string | null;
  dataReadiness: string | null;
  leadTimeHours: number | null;
  leadTimeBand: string | null;
  /** `published`, `corrected` or `retracted`, plus the reason when there is one. */
  correctionState: string;
  correctionReason: string | null;
  revision: number;
  matchHref: string;
  receiptHref: string;
};

export type TrackRecordPage = {
  rows: TrackRecordRow[];
  pageSize: number;
  /** Rows matching the filters across the whole period, not just this page. */
  matchingRows: number;
  /** 1-based, for a plain "page 3 of 9" line. */
  pageNumber: number;
  totalPages: number;
  previousHref: string | null;
  nextHref: string | null;
};

export type TrackRecordView = {
  presentation: TrackRecordPresentation;
  unavailableReason: string | null;
  /** Set only when `presentation` is `last-known-good`. */
  lastKnownGoodAt: string | null;
  availability: DataAvailability;
  asOf: string;
  timeZone: string;
  period: ResolvedTrackRecordPeriod;
  coverage: PeriodCoverage;
  ledgerSpan: LedgerSpan;
  filters: TrackRecordFilters;
  filterOptions: TrackRecordFilterOptions;
  activeFilters: ActiveFilter[];
  filterDescription: string;
  summary: TrackRecordSummary;
  page: TrackRecordPage;
  evidenceClasses: EvidenceClass[];
  /** Canonical, shareable path for exactly this view. */
  selfHref: string;
  csvHref: string;
  jsonHref: string;
  printHref: string;
};

/** The query param that switches the page into its printable layout. */
export const PRINT_PARAM = "view";
export const PRINT_VALUE = "print";

/**
 * The printable variant of a view.
 *
 * Printing is a variant of the page rather than a separate document: the same
 * reads, the same numbers, the same definitions, with the controls dropped and
 * the rows unpaginated up to a cap. A separate print renderer is a second
 * implementation of the record, and a second implementation eventually prints
 * a different number from the one on screen.
 */
export function printableHref(selfHref: string): string {
  return `${selfHref}${selfHref.includes("?") ? "&" : "?"}${PRINT_PARAM}=${PRINT_VALUE}`;
}

export function isPrintView(searchParams: SearchParamRecord): boolean {
  const raw = searchParams[PRINT_PARAM];
  return (Array.isArray(raw) ? raw[0] : raw) === PRINT_VALUE;
}

/** Rows a printable page will lay out before it says "use the CSV instead". */
export const PRINT_ROW_CAP = 500;

/* -------------------------------------------------------------------------
 * Display join: fixture names
 * ---------------------------------------------------------------------- */

const FIXTURE_LABEL_TIMEOUT_MS = 2_500;

/**
 * Team names for the visible rows.
 *
 * `op_publications` carries no team names, and it should not: the ledger
 * records a claim, and a claim is identified by fixture id, market and
 * selection. This is therefore a *display* join, bounded to the rows on screen,
 * and nothing derived from it enters any number on the page. If it fails the
 * table shows fixture external ids, which are still enough to reach the match
 * page and to look a claim up in the export.
 */
async function readFixtureLabels(
  fixtureIds: string[],
  client: SupabaseClient | null
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const unique = [...new Set(fixtureIds.filter(Boolean))];
  if (!client || !unique.length) return labels;

  for (let index = 0; index < unique.length; index += 100) {
    const { data, error } = await client
      .from("op_fixtures")
      .select("id,home_team_name,away_team_name")
      .in("id", unique.slice(index, index + 100))
      .abortSignal(AbortSignal.timeout(FIXTURE_LABEL_TIMEOUT_MS));
    // A missing label is a missing label. It is never worth failing the page.
    if (error) return labels;
    for (const row of data ?? []) {
      const record = row as unknown as Record<string, unknown>;
      const home = record.home_team_name ? String(record.home_team_name) : "";
      const away = record.away_team_name ? String(record.away_team_name) : "";
      if (home && away) labels.set(String(record.id), `${home} v ${away}`);
    }
  }
  return labels;
}

/* -------------------------------------------------------------------------
 * Row projection
 * ---------------------------------------------------------------------- */

function correctionStateOf(publication: OfficialPublicationDetail): string {
  if (publication.publicationStatus === "retracted") return "Retracted";
  if (publication.publicationStatus === "corrected") return `Corrected (revision ${publication.revision})`;
  return publication.revision > 1 ? `Amended (revision ${publication.revision})` : "As published";
}

export function toTrackRecordRow(
  publication: OfficialPublicationDetail,
  fixtureLabels: Map<string, string>
): TrackRecordRow {
  const hours = leadTimeHours(publication);
  return {
    publicationId: publication.publicationId,
    publishedAt: publication.publishedAt,
    kickoffAt: publication.kickoffAt,
    fixtureLabel: fixtureLabels.get(publication.fixtureId) ?? publication.fixtureExternalId,
    fixtureExternalId: publication.fixtureExternalId,
    sport: publication.sport,
    competition: publication.competition,
    market: publication.market,
    marketFamily: marketFamilyOf(publication.market).label,
    selection: publication.selection,
    selectionLabel: publication.selectionLabel,
    selectionType: selectionTypeOf(publication.selection).label,
    marketLine: publication.marketLine,
    oddsAtPublication: publication.oddsAtPublication,
    oddsBand: oddsBandFor(publication.oddsAtPublication).label,
    modelProbability: publication.modelProbability,
    fairOdds: publication.modelProbability > 0 ? 1 / publication.modelProbability : Number.NaN,
    probabilityBand: probabilityBandOf(publication.modelProbability).label,
    closingOdds: publication.closingOdds,
    closingLineValue: publicationClosingLineValue(publication),
    settlementStatus: publication.settlementStatus,
    settledAt: publication.settledAt,
    unitReturn: publicationUnitReturn(publication),
    modelVersion: publication.modelVersion,
    calibrationVersion: publication.calibrationVersion,
    decisionTier: publication.decisionStatus,
    dataReadiness: publication.dataQuality,
    leadTimeHours: hours,
    leadTimeBand: hours === null ? null : leadTimeBandOf(hours).label,
    correctionState: correctionStateOf(publication),
    correctionReason: publication.correctionReason,
    revision: publication.revision,
    matchHref: `/predictions/${encodeURIComponent(publication.fixtureExternalId)}`,
    receiptHref: `/track-record/publication/${encodeURIComponent(publication.publicationId)}`
  };
}

/* -------------------------------------------------------------------------
 * Last-known-good
 * ---------------------------------------------------------------------- */

type CacheEntry = { view: TrackRecordView; cachedAt: number };

/**
 * The last answer this runtime gave for each query.
 *
 * Deliberately per-instance and in memory: it exists to keep a transient
 * database failure from turning an honest record into a page of nulls for the
 * length of one outage, not to be a durable cache. A cold instance has no
 * last-known-good and correctly renders unavailable, which is the right answer
 * — it genuinely does not know.
 */
const lastKnownGood = new Map<string, CacheEntry>();

/** Beyond this an old answer stops being useful and starts being misleading. */
export const LAST_KNOWN_GOOD_TTL_MS = 30 * 60_000;
const LAST_KNOWN_GOOD_MAX_ENTRIES = 40;

function rememberLastKnownGood(key: string, view: TrackRecordView): void {
  if (lastKnownGood.size >= LAST_KNOWN_GOOD_MAX_ENTRIES) {
    const oldest = lastKnownGood.keys().next().value;
    if (oldest !== undefined) lastKnownGood.delete(oldest);
  }
  lastKnownGood.set(key, { view, cachedAt: Date.now() });
}

function recallLastKnownGood(key: string, now: number): CacheEntry | null {
  const entry = lastKnownGood.get(key);
  if (!entry) return null;
  if (now - entry.cachedAt > LAST_KNOWN_GOOD_TTL_MS) {
    lastKnownGood.delete(key);
    return null;
  }
  return entry;
}

/** Test seam. Server-only module state has to be resettable between cases. */
export function clearTrackRecordLastKnownGood(): void {
  lastKnownGood.clear();
}

/* -------------------------------------------------------------------------
 * Assembly
 * ---------------------------------------------------------------------- */

function spanFrom(extent: Awaited<ReturnType<typeof readLedgerExtent>>): LedgerSpan {
  if (extent.availability === "unavailable") {
    return {
      firstPublishedAt: null,
      lastPublishedAt: null,
      totalPublished: null,
      spanDays: null,
      availability: "unavailable"
    };
  }
  const first = extent.firstPublishedAt;
  const last = extent.lastPublishedAt;
  return {
    firstPublishedAt: first,
    lastPublishedAt: last,
    totalPublished: extent.totalPublished,
    spanDays: first && last ? calendarDaySpan(first.slice(0, 10), last.slice(0, 10)) : null,
    availability: "measured"
  };
}

export type BuildTrackRecordViewOptions = {
  searchParams?: SearchParamRecord;
  timeZone?: string | null;
  now?: Date;
  client?: SupabaseClient | null;
  /** Raised for exports, which may take longer than a page render. */
  maxRows?: number;
  /** Exports want every matching row on one "page". */
  pageSizeOverride?: number | null;
  /** Skip the fixture-name join when the consumer does not render names. */
  includeFixtureLabels?: boolean;
};

export async function buildTrackRecordView({
  searchParams = {},
  timeZone = null,
  now = new Date(),
  client = getSupabaseServerClient(),
  maxRows = TRACK_RECORD_SUMMARY_MAX_ROWS,
  pageSizeOverride = null,
  includeFixtureLabels = true
}: BuildTrackRecordViewOptions = {}): Promise<TrackRecordView> {
  const asOf = now.toISOString();
  const request = parsePeriodRequest(searchParams);
  const period = resolveTrackRecordPeriod({
    id: request.id,
    from: request.from,
    to: request.to,
    now,
    timeZone
  });
  const filters = parseTrackRecordFilters(searchParams);
  const pageSize = pageSizeOverride ?? parsePageSize(searchParams);
  const cursorParam = typeof searchParams[CURSOR_PARAM] === "string" ? (searchParams[CURSOR_PARAM] as string) : null;

  const baseQuery = { period: period.id, from: period.requestedFrom, to: period.requestedTo, filters, pageSize };
  const selfHref = trackRecordHref(baseQuery);
  const cacheKey = selfHref;

  const [extent, sweep] = await Promise.all([
    readLedgerExtent(client),
    readOfficialPublicationsInWindow({
      publishedSince: period.startUtc ? period.startUtc.toISOString() : null,
      publishedUntil: period.endUtc ? period.endUtc.toISOString() : null,
      maxRows,
      client
    })
  ]);

  if (sweep.availability === "unavailable") {
    const recalled = recallLastKnownGood(cacheKey, now.getTime());
    if (recalled) {
      return {
        ...recalled.view,
        presentation: "last-known-good",
        unavailableReason: sweep.unavailableReason,
        lastKnownGoodAt: new Date(recalled.cachedAt).toISOString()
      };
    }
    const span = spanFrom(extent);
    // The filters still describe what was asked for, even though nothing came
    // back. An export generated during an outage has to say which slice failed;
    // reporting "filters: none" would make it look like the whole record was
    // empty rather than one filtered view of it unreadable.
    const emptyOptions = buildFilterOptions([]);
    const requestedFilters = activeTrackRecordFilters(filters, emptyOptions);
    return {
      presentation: "unavailable",
      unavailableReason: sweep.unavailableReason,
      lastKnownGoodAt: null,
      availability: "unavailable",
      asOf,
      timeZone: period.timeZone,
      period,
      coverage: describePeriodCoverage(period, span),
      ledgerSpan: span,
      filters,
      filterOptions: emptyOptions,
      activeFilters: requestedFilters,
      filterDescription: describeTrackRecordFilters(requestedFilters),
      summary: unavailableTrackRecordSummary(sweep.unavailableReason),
      page: {
        rows: [],
        pageSize,
        matchingRows: 0,
        pageNumber: 1,
        totalPages: 0,
        previousHref: null,
        nextHref: null
      },
      evidenceClasses: EVIDENCE_CLASSES,
      selfHref,
      csvHref: `/api/track-record/export.csv${selfHref.slice("/track-record".length)}`,
      jsonHref: `/api/track-record/export.json${selfHref.slice("/track-record".length)}`,
      printHref: printableHref(selfHref)
    };
  }

  const span = spanFrom(extent);
  // Options are built from the period's full set, before filtering, so a
  // control never loses the option you would need in order to widen again.
  const filterOptions = buildFilterOptions(sweep.items);
  const matching = applyTrackRecordFilters(sweep.items, filters);
  const summary = computeTrackRecordSummary({
    publications: matching,
    availability: sweep.availability,
    truncated: sweep.truncated
  });

  // Keyset slicing over an array that is already ordered by (published_at, id)
  // descending: the URL carries the last row of the previous page, so a link
  // stays valid as the ledger grows underneath it.
  const cursorIndex = cursorParam
    ? matching.findIndex((row) => encodePublicationCursor({ publishedAt: row.publishedAt, id: row.publicationId }) === cursorParam)
    : -1;
  const start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  const pageItems = matching.slice(start, start + pageSize);
  const labels = includeFixtureLabels ? await readFixtureLabels(pageItems.map((row) => row.fixtureId), client) : new Map<string, string>();

  const lastOnPage = pageItems[pageItems.length - 1];
  const previousStart = Math.max(0, start - pageSize);
  const previousAnchor = previousStart > 0 ? matching[previousStart - 1] : null;

  const page: TrackRecordPage = {
    rows: pageItems.map((row) => toTrackRecordRow(row, labels)),
    pageSize,
    matchingRows: matching.length,
    pageNumber: Math.floor(start / Math.max(1, pageSize)) + 1,
    totalPages: Math.max(1, Math.ceil(matching.length / Math.max(1, pageSize))),
    previousHref:
      start === 0
        ? null
        : trackRecordHref({
            ...baseQuery,
            cursor: previousAnchor
              ? encodePublicationCursor({ publishedAt: previousAnchor.publishedAt, id: previousAnchor.publicationId })
              : null
          }),
    nextHref:
      start + pageItems.length >= matching.length || !lastOnPage
        ? null
        : trackRecordHref({
            ...baseQuery,
            cursor: encodePublicationCursor({ publishedAt: lastOnPage.publishedAt, id: lastOnPage.publicationId })
          })
  };

  const activeFilters = activeTrackRecordFilters(filters, filterOptions);
  const view: TrackRecordView = {
    presentation: "live",
    unavailableReason: null,
    lastKnownGoodAt: null,
    availability: sweep.availability,
    asOf,
    timeZone: period.timeZone,
    period,
    coverage: describePeriodCoverage(period, span),
    ledgerSpan: span,
    filters,
    filterOptions,
    activeFilters,
    filterDescription: describeTrackRecordFilters(activeFilters),
    summary,
    page,
    evidenceClasses: EVIDENCE_CLASSES,
    selfHref,
    csvHref: `/api/track-record/export.csv${selfHref.slice("/track-record".length)}`,
    jsonHref: `/api/track-record/export.json${selfHref.slice("/track-record".length)}`,
    printHref: printableHref(selfHref)
  };

  rememberLastKnownGood(cacheKey, view);
  return view;
}

/**
 * Every matching row in the period, for an export.
 *
 * Same period, same filters, same predicate as the page — the export is not
 * allowed to be a second implementation. It differs only in row cap and in
 * having no page slice.
 */
export async function buildTrackRecordExportView(
  options: Omit<BuildTrackRecordViewOptions, "maxRows" | "pageSizeOverride">
): Promise<TrackRecordView> {
  return buildTrackRecordView({
    ...options,
    maxRows: TRACK_RECORD_EXPORT_MAX_ROWS,
    pageSizeOverride: TRACK_RECORD_EXPORT_MAX_ROWS,
    includeFixtureLabels: true
  });
}

/** The active filter set as a plain object, for an export header. */
export function exportFilterContext(view: TrackRecordView): Record<string, string> {
  const context: Record<string, string> = {
    period: view.period.label,
    periodDefinition: view.period.description,
    timeZone: view.timeZone,
    periodStart: view.period.startUtc ? view.period.startUtc.toISOString() : "none (all time)",
    periodEnd: view.period.endUtc ? view.period.endUtc.toISOString() : "none (all time)",
    periodCoverage: view.coverage.sentence,
    dataAvailability: view.availability,
    presentation: view.presentation
  };
  for (const filter of view.activeFilters) context[filter.label] = filter.valueLabel;
  if (!view.activeFilters.length) context.filters = "none";
  return context;
}

export { ANY as ANY_FILTER_VALUE };
