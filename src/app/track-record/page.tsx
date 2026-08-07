import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { LocalTimeText } from "@/components/odds/LocalTime";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { PromotionGateBoard } from "@/components/odds/PromotionGateBoard";
import { TrackRecordCustomRange, TrackRecordPeriodTabs } from "@/components/performance/TrackRecordPeriodTabs";
import { TrackRecordDefinitions, TrackRecordExportBar } from "@/components/performance/TrackRecordExportBar";
import { TrackRecordEvidenceClasses } from "@/components/performance/TrackRecordEvidenceClasses";
import { TrackRecordFilterForm } from "@/components/performance/TrackRecordFilterForm";
import { TrackRecordPagination, TrackRecordTable } from "@/components/performance/TrackRecordTable";
import {
  TrackRecordForecastPanel,
  TrackRecordSummaryPanel
} from "@/components/performance/TrackRecordSummaryPanel";
import { readPromotionGateStatus } from "@/lib/sports/promotionGateStatus";
import { getCachedHomepageModelRecordSummary } from "@/lib/sports/tips/publicReads";
import { formatRecordHitRate } from "@/lib/performance/ledgerMetrics";
import { FILTER_PARAM, TRACK_RECORD_FILTER_KEYS, ANY } from "@/lib/performance/trackRecordFilters";
import {
  PRINT_ROW_CAP,
  buildTrackRecordView,
  isPrintView,
  type TrackRecordView
} from "@/lib/performance/trackRecordView";
import { readTimezonePreference } from "@/lib/time/timezoneCookie";

/**
 * The public track record.
 *
 * Everything on this page resolves to `op_publications` through one view
 * model, so the summary, the table and both exports cannot disagree. Nothing
 * here is reconstructed from news, prediction cards or the operational
 * decision tables — those are separate evidence classes with their own
 * sections further down, and there is no figure anywhere on the page that
 * combines them.
 *
 * The honesty problem this page has to solve today is that the ledger is
 * young. It holds one day of publishing. The structure still offers every
 * period, because a record that will run for years needs the structure to be
 * right from the start — but a period the ledger does not reach renders the
 * coverage sentence ("no publications exist in this period") rather than a
 * zero, and the ledger's real extent is stated at the top of the page rather
 * than left for a reader to infer from an empty table.
 */

// Reads the timezone cookie and the query string; neither is cacheable.
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Track Record — Every Published Pick, Settled in Public",
  description:
    "OddsPadi's official publication ledger: every published pick with its price, model probability, settlement and correction history. Filterable, exportable, and separated from every other class of evidence.",
  path: "/track-record",
  socialTitle: "Track Record — OddsPadi",
  socialDescription: "Every published pick settled in public, with the definitions attached."
});

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function LedgerExtentNotice({ view }: { view: TrackRecordView }) {
  const span = view.ledgerSpan;
  if (span.availability === "unavailable") {
    return (
      <p className="notice warning">
        The ledger&apos;s date range could not be read, so we cannot say how much of the selected period it covers.
      </p>
    );
  }
  if (!span.firstPublishedAt || !span.lastPublishedAt || !span.totalPublished) {
    return (
      <p className="notice">
        No official picks have been published yet. Every period below is therefore empty, which is a statement about the
        ledger and not a result.
      </p>
    );
  }
  return (
    <p className="notice track-record-extent">
      <strong>
        The official ledger holds {span.totalPublished} publication{span.totalPublished === 1 ? "" : "s"} spanning{" "}
        {span.spanDays} day{span.spanDays === 1 ? "" : "s"}
      </strong>{" "}
      — from <LocalTimeText iso={span.firstPublishedAt} variant="date" /> to{" "}
      <LocalTimeText iso={span.lastPublishedAt} variant="date" />. Longer periods are offered because the record is
      meant to grow into them; until it does, they report how much of themselves the ledger actually covers instead of
      showing a zero.
    </p>
  );
}

function PresentationNotice({ view }: { view: TrackRecordView }) {
  if (view.presentation === "last-known-good") {
    return (
      <p className="notice warning public-state-notice">
        The ledger could not be read just now, so these figures are the last answer this server gave, from{" "}
        <LocalTimeText iso={view.lastKnownGoodAt} variant="datetime" />. They are not being refreshed, and they are not
        a zero.
      </p>
    );
  }
  if (view.presentation === "unavailable") {
    return (
      <p className="notice warning public-state-notice">
        The publication ledger could not be read. No record is shown for this period, and nothing has been substituted
        from another source. This is not a zero.
      </p>
    );
  }
  return null;
}

export default async function TrackRecordPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const timeZone = await readTimezonePreference();
  const printing = isPrintView(params);

  const [view, gateStatus, internalRecord] = await Promise.all([
    buildTrackRecordView({
      searchParams: params,
      timeZone,
      pageSizeOverride: printing ? PRINT_ROW_CAP : null
    }),
    printing ? Promise.resolve(null) : readPromotionGateStatus("football").catch(() => null),
    printing ? Promise.resolve(null) : getCachedHomepageModelRecordSummary().catch(() => null)
  ]);

  // Carried into the custom-range form so changing the dates does not silently
  // drop the filters the reader had applied.
  const filterParams = TRACK_RECORD_FILTER_KEYS.filter((key) => view.filters[key] !== ANY).map((key) => ({
    name: FILTER_PARAM[key],
    value: view.filters[key]
  }));

  if (printing) {
    return (
      <main id="main" className="container track-record-print">
        <div className="page-heading">
          <span className="section-kicker">OddsPadi official publication ledger</span>
          <h1>Track record — {view.period.label}</h1>
          <p>{view.period.description}</p>
          <p className="small muted">
            Generated <LocalTimeText iso={view.asOf} variant="datetime" /> · {view.filterDescription} ·{" "}
            {view.coverage.sentence}
          </p>
        </div>
        <PresentationNotice view={view} />
        <TrackRecordSummaryPanel view={view} />
        <TrackRecordForecastPanel view={view} />
        <TrackRecordTable view={view} />
        {view.page.matchingRows > PRINT_ROW_CAP ? (
          <p className="notice warning">
            This view matches {view.page.matchingRows} publications; a printable page lays out the first {PRINT_ROW_CAP}.
            Use the CSV or JSON export for the complete set.
          </p>
        ) : null}
        <TrackRecordDefinitions />
        <ResponsibleUseNotice />
      </main>
    );
  }

  const graded = internalRecord ? internalRecord.won + internalRecord.lost : 0;

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Track Record</span>
        <h1>
          Judge the model by its <span className="accent">ledger</span>
        </h1>
        <p>
          Every official pick is written to the publication ledger before kickoff, at the price it was struck, and
          settled in public against a final score. This page reads that ledger and nothing else. Where a number is not
          known it says so — a figure we could not measure is never shown as a zero.
        </p>
      </div>

      <LedgerExtentNotice view={view} />
      <PresentationNotice view={view} />

      <section className="section" aria-labelledby="record-period-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Period</span>
            <h2 id="record-period-heading">{view.period.label}</h2>
          </div>
          <Link className="button primary" href="/predictions/history">
            Every published pick
          </Link>
        </div>
        <TrackRecordPeriodTabs view={view} filters={view.filters} />
        <p className="muted small">{view.period.description}</p>
        <p className="muted small">{view.coverage.sentence}</p>
        <TrackRecordCustomRange view={view} filterParams={filterParams} />
      </section>

      <section className="section" aria-labelledby="record-summary-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Official public picks</span>
            <h2 id="record-summary-heading">The only record that counts publicly</h2>
          </div>
        </div>
        <TrackRecordSummaryPanel view={view} />
      </section>

      <section className="section" aria-labelledby="record-forecast-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Forecast quality</span>
            <h2 id="record-forecast-heading">How good the probabilities were</h2>
          </div>
          <Link className="button" href="/engine/performance">
            Calibration &amp; analytics
          </Link>
        </div>
        <TrackRecordForecastPanel view={view} />
        <p className="muted small">
          These score the probability, not the bet. A well-calibrated model can still lose money at bad prices, and a
          profitable one can be badly calibrated. Combining the two into a single &quot;accuracy&quot; figure is the
          most common way this industry misleads.
        </p>
      </section>

      <section className="section" aria-labelledby="record-filters-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Filters</span>
            <h2 id="record-filters-heading">Slice the record, and share the slice</h2>
          </div>
        </div>
        <TrackRecordFilterForm view={view} />
        <p className="muted small">
          Filters apply identically to the summary above, the table below and both exports. The result is a URL: send it
          and the recipient sees exactly what you saw.
        </p>
      </section>

      <section className="section" aria-labelledby="record-table-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">The record</span>
            <h2 id="record-table-heading">Every publication in this view</h2>
          </div>
        </div>
        <TrackRecordTable view={view} />
        <TrackRecordPagination view={view} />
        <TrackRecordExportBar view={view} />
        <TrackRecordDefinitions />
      </section>

      <section className="section" aria-labelledby="record-classes-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Evidence classes</span>
            <h2 id="record-classes-heading">What counts, and what never does</h2>
          </div>
        </div>
        <TrackRecordEvidenceClasses classes={view.evidenceClasses} />
      </section>

      <section className="section" aria-labelledby="record-internal-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Yesterday</span>
            <h2 id="record-internal-heading">Internal model record</h2>
          </div>
          <Link className="button" href="/predictions/value-picks">
            Current published selections
          </Link>
        </div>
        {internalRecord && graded + internalRecord.pending + internalRecord.voided > 0 ? (
          <div className="metrics-grid">
            <div className="metric">
              <span className="metric-label">Model wins</span>
              <span className="metric-value">{internalRecord.won}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Model losses</span>
              <span className="metric-value">{internalRecord.lost}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Pending</span>
              <span className="metric-value">{internalRecord.pending}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Hit rate</span>
              <span className="metric-value">{formatRecordHitRate(internalRecord.hitRate)}</span>
            </div>
          </div>
        ) : (
          <p className="muted small">
            Yesterday&apos;s grading has not landed yet — the settlement sweep runs hourly. The full ledger has the
            complete history.
          </p>
        )}
        <p className="muted small">
          Internal record: every decision the engine grades against final scores, published or not — counted once per
          decision, not once per bookmaker price. It is training evidence and it is not part of the official record
          above. Published picks are the subset that cleared all gates.
        </p>
      </section>

      {gateStatus ? (
        <section className="section" aria-labelledby="record-gates-heading">
          <div className="section-title">
            <div>
              <span className="section-kicker">Road to publication</span>
              <h2 id="record-gates-heading">The seven promotion gates, live</h2>
            </div>
            <Link className="button" href="/predictions/decision-engine">
              Engine status
            </Link>
          </div>
          <PromotionGateBoard status={gateStatus} />
        </section>
      ) : null}

      <section className="section" aria-labelledby="record-method-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Methodology</span>
            <h2 id="record-method-heading">How this record stays honest</h2>
          </div>
        </div>
        <ul className="muted">
          <li>
            A publication cannot be created at or after kickoff. The database refuses it, so a pick recorded after the
            event is not merely discouraged — it is impossible.
          </li>
          <li>
            A published claim cannot be edited in place. Corrections append a revision holding the verbatim prior state,
            and every one of them is visible on the claim&apos;s receipt.
          </li>
          <li>
            Settlement uses the odds recorded when the claim was published, never a later price. Push, void and
            cancelled are distinct from a loss and stay out of the hit-rate denominator.
          </li>
          <li>
            A retracted claim scores in neither direction, and stays on the record so the retraction itself is
            auditable.
          </li>
          <li>
            Where the ledger cannot be read, this page says so. It does not fall back to another table, and it does not
            render a zero.
          </li>
        </ul>
        <p className="muted small">
          Source of truth: <code>op_publications</code>, <code>op_publication_settlements</code> and{" "}
          <code>op_publication_revisions</code>. Documented in <code>docs/track-record.md</code> and{" "}
          <code>docs/publication-ledger.md</code>.
        </p>
      </section>

      <section className="section">
        <ResponsibleUseNotice />
      </section>
    </main>
  );
}
