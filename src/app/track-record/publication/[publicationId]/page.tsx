import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalTimeText } from "@/components/odds/LocalTime";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { readPublicationReceipt, type PublicationReceipt } from "@/lib/domain/canonicalReads";
import { canonicalSettlementBadgeClass, canonicalSettlementLabel } from "@/lib/product/vocabulary";
import { publicationClosingLineValue, publicationUnitReturn } from "@/lib/performance/trackRecordSummary";
import { absoluteUrl } from "@/lib/seo/pageMetadata";

/**
 * The receipt for one published claim.
 *
 * A track record whose rows cannot be opened is a list of assertions. This
 * page is what makes each row checkable: the claim exactly as it was struck,
 * the four versions it was struck under, when the evidence was cut off, when
 * the price was snapshotted, every settlement ever recorded against it
 * including superseded ones, and every correction with the verbatim prior
 * state.
 *
 * Nothing here is recomputed. Each field is a column of `op_publications`, a
 * row of `op_publication_settlements`, or a row of `op_publication_revisions`.
 * The only derived figures are the two the record table also shows — fair odds
 * and closing-line value — and both come from the same helpers the summary
 * uses, so this page cannot report a different CLV from the page that linked
 * to it.
 */

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ publicationId: string }> };

const NOT_KNOWN = "—";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { publicationId } = await params;
  const path = `/track-record/publication/${encodeURIComponent(publicationId)}`;
  return {
    title: "Publication receipt — OddsPadi Track Record",
    description:
      "The full audit trail for one official OddsPadi public pick: the claim as published, its provenance, its settlement history and every correction.",
    alternates: { canonical: absoluteUrl(path) },
    openGraph: {
      title: "Publication receipt — OddsPadi",
      description: "One published claim, with its settlement history and corrections.",
      url: absoluteUrl(path),
      type: "article"
    },
    // One receipt per claim is thousands of near-identical pages. They exist to
    // be checked from the record table, not to compete in search.
    robots: { index: false, follow: true }
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function price(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? NOT_KNOWN : value.toFixed(2);
}

function percent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? NOT_KNOWN : `${(value * 100).toFixed(1)}%`;
}

function signedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return NOT_KNOWN;
  return `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}%`;
}

function ReceiptBody({ receipt }: { receipt: PublicationReceipt }) {
  const publication = receipt.publication;
  if (!publication) return null;
  const unit = publicationUnitReturn(publication);

  return (
    <>
      <section className="section" aria-labelledby="receipt-claim-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">The claim, as published</span>
            <h2 id="receipt-claim-heading">{publication.selectionLabel}</h2>
          </div>
          <span className={`badge ${canonicalSettlementBadgeClass(publication.settlementStatus)}`}>
            {canonicalSettlementLabel(publication.settlementStatus)}
          </span>
        </div>
        <dl className="detail-grid">
          <Field label="Fixture">
            <Link href={`/predictions/${encodeURIComponent(publication.fixtureExternalId)}`}>
              {publication.fixtureExternalId}
            </Link>
          </Field>
          <Field label="Sport">{publication.sport}</Field>
          <Field label="Competition">{publication.competition}</Field>
          <Field label="Market">
            {publication.market.replaceAll("_", " ")}
            {publication.marketLine === null ? "" : ` ${publication.marketLine}`}
          </Field>
          <Field label="Selection">{publication.selection}</Field>
          <Field label="Odds at publication">{price(publication.oddsAtPublication)}</Field>
          <Field label="Implied probability">{percent(publication.impliedProbability)}</Field>
          <Field label="Model probability">{percent(publication.modelProbability)}</Field>
          <Field label="Fair odds">
            {price(publication.modelProbability > 0 ? 1 / publication.modelProbability : null)}
          </Field>
          <Field label="Closing odds">{price(publication.closingOdds)}</Field>
          <Field label="Closing-line value">{signedPercent(publicationClosingLineValue(publication))}</Field>
          <Field label="Unit return">
            {unit === null ? NOT_KNOWN : `${unit >= 0 ? "+" : "−"}${Math.abs(unit).toFixed(2)}u`}
          </Field>
        </dl>
        <p className="small muted">
          Fair odds are 1 divided by the model probability — the price at which the model is indifferent. Nobody offered
          that price; it is shown so the published price can be judged against it. An em dash means the value is not
          known, never that it is zero.
        </p>
      </section>

      <section className="section" aria-labelledby="receipt-provenance-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Provenance</span>
            <h2 id="receipt-provenance-heading">What produced this claim, and when</h2>
          </div>
        </div>
        <dl className="detail-grid">
          <Field label="Published at">
            <LocalTimeText iso={publication.publishedAt} variant="datetime" />
          </Field>
          <Field label="Kickoff">
            <LocalTimeText iso={publication.kickoffAt} variant="datetime" />
          </Field>
          <Field label="Evidence cutoff">
            {publication.evidenceCutoffAt ? (
              <LocalTimeText iso={publication.evidenceCutoffAt} variant="datetime" />
            ) : (
              NOT_KNOWN
            )}
          </Field>
          <Field label="Odds snapshot">
            {publication.oddsSnapshotAt ? <LocalTimeText iso={publication.oddsSnapshotAt} variant="datetime" /> : NOT_KNOWN}
          </Field>
          <Field label="Model version">{publication.modelVersion ?? NOT_KNOWN}</Field>
          <Field label="Feature-set version">{publication.featureSetVersion ?? NOT_KNOWN}</Field>
          <Field label="Calibration version">{publication.calibrationVersion ?? NOT_KNOWN}</Field>
          <Field label="Decision-policy version">{publication.decisionPolicyVersion ?? NOT_KNOWN}</Field>
          <Field label="Decision tier">{publication.decisionStatus ?? NOT_KNOWN}</Field>
          <Field label="Data readiness">{publication.dataQuality ?? NOT_KNOWN}</Field>
          <Field label="Publication status">{publication.publicationStatus}</Field>
          <Field label="Revision">{publication.revision}</Field>
        </dl>
        <p className="small muted">
          Four independently versioned inputs are recorded because the same probability under a different calibration is
          a different claim. The evidence cutoff is enforced to be at or before publication, so a claim cannot have seen
          evidence from after it was made.
        </p>
      </section>

      <section className="section" aria-labelledby="receipt-settlement-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Settlement history</span>
            <h2 id="receipt-settlement-heading">Every verdict recorded against this claim</h2>
          </div>
        </div>
        {receipt.settlements.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Verdict</th>
                  <th scope="col">Settled</th>
                  <th scope="col">Current</th>
                  <th scope="col">Basis</th>
                </tr>
              </thead>
              <tbody>
                {receipt.settlements.map((settlement) => (
                  <tr key={settlement.settlementId}>
                    <td>
                      <span className={`badge ${canonicalSettlementBadgeClass(settlement.status)}`}>
                        {canonicalSettlementLabel(settlement.status)}
                      </span>
                    </td>
                    <td>
                      <LocalTimeText iso={settlement.settledAt} variant="datetime" />
                    </td>
                    <td>{settlement.isCurrent ? "Current" : "Superseded"}</td>
                    <td className="small muted">
                      {typeof settlement.resolutionBasis.reason === "string"
                        ? settlement.resolutionBasis.reason
                        : "No reason recorded."}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">
            No settlement has been recorded yet. The claim is still open, and it stays open until a final score can
            resolve it — a guessed verdict in an append-only ledger cannot be quietly withdrawn.
          </p>
        )}
        <p className="small muted">
          Settlement is idempotent and at most one verdict is current. A re-graded result supersedes its predecessor
          rather than overwriting it, so a superseded row above is part of the audit trail, not a mistake.
        </p>
      </section>

      <section className="section" aria-labelledby="receipt-corrections-heading">
        <div className="section-title">
          <div>
            <span className="section-kicker">Corrections</span>
            <h2 id="receipt-corrections-heading">What changed after publication</h2>
          </div>
        </div>
        {receipt.revisions.length ? (
          <ul className="muted track-record-revisions">
            {receipt.revisions.map((revision) => (
              <li key={revision.revisionId}>
                <strong>Revision {revision.revision}</strong> ·{" "}
                <LocalTimeText iso={revision.createdAt} variant="datetime" /> — {revision.reason}
                <br />
                <span className="small muted">
                  Prior state kept verbatim: odds {price(Number(revision.previousState.odds_at_publication))}, model
                  probability {percent(Number(revision.previousState.model_probability))}, settlement{" "}
                  {String(revision.previousState.settlement_status ?? NOT_KNOWN)}.
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            This claim stands exactly as it was first published. No correction has been issued against it.
          </p>
        )}
        {publication.correctionReason ? (
          <p className="notice warning">Current correction note: {publication.correctionReason}</p>
        ) : null}
      </section>
    </>
  );
}

export default async function PublicationReceiptPage({ params }: PageProps) {
  const { publicationId } = await params;
  const receipt = await readPublicationReceipt(publicationId);

  if (receipt.availability === "unavailable") {
    return (
      <main id="main" className="container">
        <div className="page-heading">
          <span className="section-kicker">Publication receipt</span>
          <h1>The ledger could not be read</h1>
        </div>
        <p className="notice warning public-state-notice">
          We could not read this claim from the publication ledger. Nothing has been substituted from another source,
          and this is not a statement that the claim does not exist.
        </p>
        <Link className="button primary" href="/track-record">
          Back to the track record
        </Link>
      </main>
    );
  }
  if (!receipt.publication) notFound();

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Publication receipt</span>
        <h1>
          One claim, <span className="accent">audited</span>
        </h1>
        <p>
          This is the complete record of a single official public pick: what was claimed, under which model, at what
          price, and everything that has happened to it since. Publication id{" "}
          <code className="track-record-id">{receipt.publication.publicationId}</code>.
        </p>
      </div>

      {receipt.availability === "partial" ? (
        <p className="notice warning public-state-notice">
          The claim was read, but part of its audit trail could not be. Settlement or correction history below may be
          incomplete.
        </p>
      ) : null}

      <ReceiptBody receipt={receipt} />

      <section className="section">
        <div className="explore-tile-row">
          <Link className="explore-tile" href="/track-record">
            <strong>Track Record</strong>
            <span>The full published ledger</span>
          </Link>
          <Link
            className="explore-tile"
            href={`/predictions/${encodeURIComponent(receipt.publication.fixtureExternalId)}`}
          >
            <strong>Match page</strong>
            <span>The canonical fixture analysis</span>
          </Link>
        </div>
      </section>

      <section className="section">
        <ResponsibleUseNotice />
      </section>
    </main>
  );
}
