import Link from "next/link";
import { LocalTimeText } from "@/components/odds/LocalTime";
import { canonicalSettlementBadgeClass, canonicalSettlementLabel } from "@/lib/product/vocabulary";
import type { TrackRecordRow, TrackRecordView } from "@/lib/performance/trackRecordView";

/**
 * The record itself.
 *
 * Every row shows the whole basis of the claim and links to two places: the
 * canonical match page, and the publication receipt that carries the audit
 * trail for that one claim. A record you cannot click into is a list of
 * assertions.
 *
 * Absent values print an em dash rather than a zero. A pick with no closing
 * price shows "—" in the closing column, not "0.00", and a pending pick shows
 * "—" for unit return rather than a loss it has not taken.
 */

const NOT_KNOWN = "—";

function price(value: number | null): string {
  return value === null || !Number.isFinite(value) ? NOT_KNOWN : value.toFixed(2);
}

function percent(value: number | null): string {
  return value === null || !Number.isFinite(value) ? NOT_KNOWN : `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NOT_KNOWN;
  return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
}

function units(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NOT_KNOWN;
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}u`;
}

function RowLinks({ row }: { row: TrackRecordRow }) {
  return (
    <span className="track-record-row-links">
      <Link href={`/predictions/${encodeURIComponent(row.fixtureExternalId)}`}>Match</Link>
      <Link href={`/track-record/publication/${encodeURIComponent(row.publicationId)}`}>Receipt</Link>
    </span>
  );
}

export function TrackRecordTable({ view }: { view: TrackRecordView }) {
  if (view.presentation === "unavailable") {
    return (
      <div className="empty-state">
        <h2>We can&apos;t read the publication ledger</h2>
        <p className="muted">
          No rows are shown, and none are substituted from anywhere else. The record will reappear when the ledger can
          be read again.
        </p>
      </div>
    );
  }
  if (!view.page.rows.length) {
    return (
      <div className="empty-state">
        <h2>No publications match this view</h2>
        <p className="muted">{view.coverage.sentence}</p>
        <p className="small muted">
          This is an honest empty state. Nothing from the internal record, the backtests or the community feed is used
          to fill it.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="table-wrap track-record-table-wrap">
        <table className="data-table track-record-table">
          <caption className="small muted">
            {view.page.matchingRows} publication{view.page.matchingRows === 1 ? "" : "s"} match this view. Showing{" "}
            {view.page.rows.length} of them, newest publication first.
          </caption>
          <thead>
            <tr>
              <th scope="col">Published</th>
              <th scope="col">Fixture</th>
              <th scope="col">Market &amp; selection</th>
              <th scope="col">Odds</th>
              <th scope="col">Model</th>
              <th scope="col">Close</th>
              <th scope="col">Result</th>
              <th scope="col">Return</th>
              <th scope="col">Provenance</th>
              <th scope="col">Links</th>
            </tr>
          </thead>
          <tbody>
            {view.page.rows.map((row) => (
              <tr key={row.publicationId}>
                <td>
                  <LocalTimeText iso={row.publishedAt} variant="datetime" />
                  <br />
                  <span className="small muted">
                    Kickoff <LocalTimeText iso={row.kickoffAt} variant="datetime" />
                  </span>
                </td>
                <td>
                  <strong>{row.fixtureLabel}</strong>
                  <br />
                  <span className="small muted">
                    {row.sport} · {row.competition}
                  </span>
                </td>
                <td>
                  <strong>{row.selectionLabel}</strong>
                  <br />
                  <span className="small muted">
                    {row.market.replaceAll("_", " ")}
                    {row.marketLine === null ? "" : ` ${row.marketLine}`} · {row.marketFamily}
                  </span>
                </td>
                <td>
                  {price(row.oddsAtPublication)}
                  <br />
                  <span className="small muted">{row.oddsBand}</span>
                </td>
                <td>
                  {percent(row.modelProbability)}
                  <br />
                  <span className="small muted">Fair {price(row.fairOdds)}</span>
                </td>
                <td>
                  {price(row.closingOdds)}
                  <br />
                  <span className="small muted">CLV {signedPercent(row.closingLineValue)}</span>
                </td>
                <td>
                  <span className={`badge ${canonicalSettlementBadgeClass(row.settlementStatus)}`}>
                    {canonicalSettlementLabel(row.settlementStatus)}
                  </span>
                  {row.settledAt ? (
                    <>
                      <br />
                      <span className="small muted">
                        <LocalTimeText iso={row.settledAt} variant="datetime" />
                      </span>
                    </>
                  ) : null}
                </td>
                <td>{units(row.unitReturn)}</td>
                <td>
                  <span className="small muted">{row.modelVersion ?? NOT_KNOWN}</span>
                  <br />
                  <span className="small muted">cal {row.calibrationVersion ?? NOT_KNOWN}</span>
                  <br />
                  <span className="small muted">{row.correctionState}</span>
                </td>
                <td>
                  <RowLinks row={row} />
                  <br />
                  <span className="small muted track-record-id">{row.publicationId}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* The same rows as cards, for narrow screens. A ten-column table cannot
          be made comfortable on a phone by scrolling alone, and the record is
          the part of this page a phone visitor is most likely to be checking. */}
      <ul className="track-record-cards">
        {view.page.rows.map((row) => (
          <li className="panel track-record-card" key={`card-${row.publicationId}`}>
            <div className="track-record-card-head">
              <strong>{row.fixtureLabel}</strong>
              <span className={`badge ${canonicalSettlementBadgeClass(row.settlementStatus)}`}>
                {canonicalSettlementLabel(row.settlementStatus)}
              </span>
            </div>
            <p className="small muted">
              {row.sport} · {row.competition} · <LocalTimeText iso={row.publishedAt} variant="datetime" />
            </p>
            <p>
              <strong>{row.selectionLabel}</strong>{" "}
              <span className="small muted">
                {row.market.replaceAll("_", " ")}
                {row.marketLine === null ? "" : ` ${row.marketLine}`}
              </span>
            </p>
            <dl className="track-record-card-grid">
              <div>
                <dt>Odds</dt>
                <dd>{price(row.oddsAtPublication)}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{percent(row.modelProbability)}</dd>
              </div>
              <div>
                <dt>Fair</dt>
                <dd>{price(row.fairOdds)}</dd>
              </div>
              <div>
                <dt>Close</dt>
                <dd>{price(row.closingOdds)}</dd>
              </div>
              <div>
                <dt>CLV</dt>
                <dd>{signedPercent(row.closingLineValue)}</dd>
              </div>
              <div>
                <dt>Return</dt>
                <dd>{units(row.unitReturn)}</dd>
              </div>
            </dl>
            <p className="small muted">
              {row.modelVersion ?? NOT_KNOWN} · calibration {row.calibrationVersion ?? NOT_KNOWN} · {row.correctionState}
            </p>
            <RowLinks row={row} />
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Keyset pagination.
 *
 * The links carry the last row of the current page rather than an offset, so a
 * bookmarked page-3 link keeps pointing at the same claims as the ledger grows
 * underneath it.
 */
export function TrackRecordPagination({ view }: { view: TrackRecordView }) {
  const { page } = view;
  if (page.totalPages <= 1 && !page.nextHref && !page.previousHref) return null;
  return (
    <nav className="track-record-pagination" aria-label="Record pages">
      {page.previousHref ? (
        <Link className="button" href={page.previousHref}>
          Previous
        </Link>
      ) : (
        <span className="button disabled" aria-disabled="true">
          Previous
        </span>
      )}
      <span className="small muted">
        Page {page.pageNumber} of {page.totalPages}
      </span>
      {page.nextHref ? (
        <Link className="button" href={page.nextHref}>
          Next
        </Link>
      ) : (
        <span className="button disabled" aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
