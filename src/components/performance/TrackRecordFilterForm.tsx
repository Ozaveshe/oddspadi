import Link from "next/link";
import {
  ANY,
  FILTER_LABEL,
  FILTER_PARAM,
  TRACK_RECORD_FILTER_KEYS,
  emptyTrackRecordFilters,
  trackRecordHref
} from "@/lib/performance/trackRecordFilters";
import type { TrackRecordView } from "@/lib/performance/trackRecordView";

/**
 * The filter panel.
 *
 * A plain GET form. Submitting it produces a URL that fully describes the
 * view, which is what makes a filtered record quotable: a reader can send
 * "your football record at 2.00–2.99 in August" as a link, and the page they
 * land on is the page the sender saw.
 *
 * Pagination is deliberately not carried through the form. Applying a new
 * filter changes which rows exist, so keeping the old cursor would drop the
 * reader into the middle of a different result set.
 */
export function TrackRecordFilterForm({ view }: { view: TrackRecordView }) {
  const cleared = trackRecordHref({
    period: view.period.id,
    from: view.period.requestedFrom,
    to: view.period.requestedTo,
    filters: emptyTrackRecordFilters(),
    pageSize: view.page.pageSize
  });

  return (
    <>
      <form className="results-filters track-record-filters" method="get" action="/track-record">
        <input type="hidden" name="period" value={view.period.id} />
        {view.period.id === "custom" && view.period.requestedFrom ? (
          <input type="hidden" name="from" value={view.period.requestedFrom} />
        ) : null}
        {view.period.id === "custom" && view.period.requestedTo ? (
          <input type="hidden" name="to" value={view.period.requestedTo} />
        ) : null}
        <input type="hidden" name="rows" value={String(view.page.pageSize)} />

        {TRACK_RECORD_FILTER_KEYS.map((key) => {
          const options = view.filterOptions[key];
          // An open dimension with no options is either a period that holds no
          // such value or a read that failed, and those must not read alike.
          const emptyLabel = view.presentation === "unavailable" ? "Not available" : "None in this period";
          return (
            <label key={key}>
              {FILTER_LABEL[key]}
              <select name={FILTER_PARAM[key]} defaultValue={view.filters[key]} disabled={options.length === 0}>
                <option value={ANY}>{options.length === 0 ? emptyLabel : `Any ${FILTER_LABEL[key].toLowerCase()}`}</option>
                {options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}

        <button className="button primary" type="submit">
          Apply filters
        </button>
      </form>

      {view.activeFilters.length ? (
        <div className="track-record-active-filters">
          <span className="small muted">Filtered by</span>
          {view.activeFilters.map((filter) => (
            <span className="badge scheduled" key={filter.key}>
              {filter.label}: {filter.valueLabel}
            </span>
          ))}
          <Link className="text-link small" href={cleared}>
            Clear all
          </Link>
        </div>
      ) : (
        <p className="small muted">
          No filters applied. Every official publication in this period is included in the summary, the table and the
          exports alike.
        </p>
      )}
    </>
  );
}
