import Link from "next/link";
import {
  TRACK_RECORD_PERIOD_IDS,
  trackRecordPeriodLabel,
  type TrackRecordPeriodId
} from "@/lib/performance/trackRecordPeriods";
import { trackRecordHref, type TrackRecordFilters } from "@/lib/performance/trackRecordFilters";
import type { TrackRecordView } from "@/lib/performance/trackRecordView";

/**
 * The period control.
 *
 * Every period is offered, including the ones the ledger cannot yet reach.
 * That is deliberate: the structure has to be right for a record that will run
 * for years, and hiding "previous month" until it has rows would mean the
 * control silently changes shape as the product ages.
 *
 * What must never happen is a period reporting a zero. A period the ledger
 * does not cover renders the coverage sentence from `describePeriodCoverage` —
 * "no publications exist in this period" — instead of "0 picks, 0% hit rate",
 * because the second reads as a month in which the model lost everything.
 */
export function TrackRecordPeriodTabs({
  view,
  filters
}: {
  view: TrackRecordView;
  filters: TrackRecordFilters;
}) {
  const href = (period: TrackRecordPeriodId) =>
    trackRecordHref({
      period,
      from: view.period.requestedFrom,
      to: view.period.requestedTo,
      filters,
      pageSize: view.page.pageSize
    });

  return (
    <nav className="track-record-periods" aria-label="Record period">
      {TRACK_RECORD_PERIOD_IDS.filter((period) => period !== "custom").map((period) => (
        <Link
          key={period}
          className={`track-record-period${view.period.id === period ? " active" : ""}`}
          href={href(period)}
          aria-current={view.period.id === period ? "page" : undefined}
        >
          {trackRecordPeriodLabel(period)}
        </Link>
      ))}
      <Link
        className={`track-record-period${view.period.id === "custom" ? " active" : ""}`}
        href="#track-record-custom-range"
      >
        Custom range
      </Link>
    </nav>
  );
}

/**
 * The custom-range control.
 *
 * A plain GET form, so the resulting view is a URL somebody can send to
 * somebody else. The hidden fields carry the active filters forward: changing
 * the dates must not silently drop the sport you were looking at.
 */
export function TrackRecordCustomRange({
  view,
  filterParams
}: {
  view: TrackRecordView;
  filterParams: Array<{ name: string; value: string }>;
}) {
  return (
    <form className="track-record-custom" method="get" action="/track-record" id="track-record-custom-range">
      <input type="hidden" name="period" value="custom" />
      {filterParams.map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}
      <label>
        From
        <input type="date" name="from" defaultValue={view.period.requestedFrom ?? ""} />
      </label>
      <label>
        To
        <input type="date" name="to" defaultValue={view.period.requestedTo ?? ""} />
      </label>
      <button className="button" type="submit">
        Apply range
      </button>
      {view.period.invalidReason ? (
        <p className="small muted track-record-range-error" role="status">
          {view.period.invalidReason}
        </p>
      ) : null}
      <p className="small muted">
        Periods are measured by publication time in {view.timeZone} — when the claim was made, not when the match kicked
        off.
      </p>
    </form>
  );
}
