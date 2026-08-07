import Link from "next/link";
import { TRACK_RECORD_METRIC_DEFINITIONS } from "@/lib/performance/trackRecordExport";
import { trackRecordBandDefinitions } from "@/lib/performance/trackRecordFilters";
import type { TrackRecordView } from "@/lib/performance/trackRecordView";

/**
 * Exports, and the definitions that travel with them.
 *
 * The links carry the active period and filters, so the file matches the view
 * on screen rather than the unfiltered record. That is the whole reason the
 * filter state lives in the URL.
 */
export function TrackRecordExportBar({ view }: { view: TrackRecordView }) {
  return (
    <div className="track-record-exports">
      <div className="track-record-export-links">
        <Link className="button" href={view.csvHref} prefetch={false}>
          Download CSV
        </Link>
        <Link className="button" href={view.jsonHref} prefetch={false}>
          Download JSON
        </Link>
        <Link className="button" href={view.printHref}>
          Printable view
        </Link>
      </div>
      <p className="small muted">
        Each export carries this view&apos;s period, timezone, active filters and read availability, plus a definition
        for every metric and band it contains. {view.filterDescription}
      </p>
    </div>
  );
}

/**
 * The definitions, on the page as well as in the file.
 *
 * A reader who is about to quote a number should not have to download a CSV to
 * find out what it means.
 */
export function TrackRecordDefinitions() {
  const bands = trackRecordBandDefinitions();
  return (
    <details className="fold track-record-definitions">
      <summary>What every number on this page means</summary>
      <div className="fold-body">
        <div className="table-wrap">
          <table className="data-table">
            <caption className="small muted">Metric definitions. The same list is written into every export.</caption>
            <thead>
              <tr>
                <th scope="col">Metric</th>
                <th scope="col">Definition</th>
              </tr>
            </thead>
            <tbody>
              {TRACK_RECORD_METRIC_DEFINITIONS.map((entry) => (
                <tr key={entry.metric}>
                  <th scope="row">{entry.metric}</th>
                  <td>{entry.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <caption className="small muted">Band definitions, for every filter that groups a continuous value.</caption>
            <thead>
              <tr>
                <th scope="col">Dimension</th>
                <th scope="col">Band</th>
                <th scope="col">Definition</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((entry) => (
                <tr key={`${entry.dimension}-${entry.band}`}>
                  <td>{entry.dimension}</td>
                  <th scope="row">{entry.band}</th>
                  <td>{entry.definition}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </details>
  );
}
