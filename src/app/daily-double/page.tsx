import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { LocalTime } from "@/components/odds/LocalTime";
import { buildDailyDoubleView, getCachedCalibrationBands } from "@/lib/accumulator/dailyDoubleReads";
import { getCachedTodayTipsProduct } from "@/lib/sports/tips/publicReads";
import { formatOdds } from "@/lib/sports/prediction/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "The Daily Double — Two Legs, Around Evens",
  description:
    "One two-leg slip a day, built only from probability bands where the OddsPadi model has measured accuracy. Combined chance and compounded bookmaker margin both shown.",
  path: "/daily-double",
  socialTitle: "The Daily Double — OddsPadi",
  socialDescription: "Two legs, around evens, built only where the model has been measured."
});

export default async function DailyDoublePage() {
  const [product, bandsBySport] = await Promise.all([
    getCachedTodayTipsProduct().catch(() => null),
    getCachedCalibrationBands().catch(() => ({}))
  ]);

  const view = buildDailyDoubleView({
    rows: product?.sections.allAnalysed ?? null,
    bandsBySport
  });

  return (
    <main id="main" className="container daily-double">
      <div className="page-heading">
        <span className="section-kicker">The daily double</span>
        <h1>Two legs, around <span className="accent">evens</span></h1>
        <p>
          One slip a day, built only from probability bands where the model has measured accuracy against settled
          results. It is not a tip to follow — it is the arithmetic, shown in full, including the parts that work
          against you.
        </p>
      </div>

      {view.state !== "ready" ? (
        <section className="section">
          <div className="notice">
            <strong>No slip today.</strong> {view.note}
          </div>
        </section>
      ) : view.slip.status !== "built" ? (
        <section className="section">
          <div className="notice">
            <strong>No slip today.</strong> {view.slip.notes[0]}{" "}
            Refusing to build one is the same discipline as publishing a pick: a slip assembled from selections that did
            not qualify would be a worse product than none.
          </div>
        </section>
      ) : (
        <>
          <section className="section" aria-labelledby="dd-slip">
            <div className="section-title">
              <div>
                <span className="section-kicker">Today&apos;s combination</span>
                <h2 id="dd-slip">
                  {view.slip.legs.length} legs at {formatOdds(view.slip.combinedOdds)}
                </h2>
              </div>
            </div>

            <ol className="daily-double-legs">
              {view.slip.legs.map((leg) => (
                <li key={`${leg.fixtureId}:${leg.market}:${leg.selection}`}>
                  <div className="daily-double-leg-head">
                    <Link className="text-link" href={`/predictions/${encodeURIComponent(leg.fixtureId)}`}>
                      {leg.selectionLabel}
                    </Link>
                    <strong>{formatOdds(leg.decimalOdds)}</strong>
                  </div>
                  <dl>
                    <div>
                      <dt>Model chance</dt>
                      <dd>{(leg.modelProbability * 100).toFixed(1)}%</dd>
                    </div>
                    <div>
                      <dt>Market chance</dt>
                      <dd>{leg.noVigProbability === null ? "—" : `${(leg.noVigProbability * 100).toFixed(1)}%`}</dd>
                    </div>
                    <div>
                      <dt>Edge</dt>
                      <dd>{(leg.edge * 100).toFixed(1)}%</dd>
                    </div>
                    <div>
                      <dt>Kick-off</dt>
                      <dd><LocalTime iso={leg.kickoffAt} variant="kickoff" /></dd>
                    </div>
                  </dl>
                  <p className="muted small">Why this band qualifies: {leg.bandNote}.</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="section" aria-labelledby="dd-maths">
            <div className="section-title">
              <div>
                <span className="section-kicker">The arithmetic</span>
                <h2 id="dd-maths">What the combination actually says</h2>
              </div>
            </div>
            <div className="daily-double-maths">
              <div>
                <span>Combined price</span>
                <strong>{formatOdds(view.slip.combinedOdds)}</strong>
              </div>
              <div>
                <span>Model&apos;s combined chance</span>
                <strong>{(view.slip.combinedProbability * 100).toFixed(1)}%</strong>
              </div>
              <div>
                <span>Price implies</span>
                <strong>{(view.slip.combinedImpliedProbability * 100).toFixed(1)}%</strong>
              </div>
              <div>
                <span>Compounded margin</span>
                <strong>{(view.slip.combinedMargin * 100).toFixed(1)}%</strong>
              </div>
            </div>
            <ul className="muted daily-double-notes">
              {view.slip.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        </>
      )}

      <section className="section"><ResponsibleUseNotice /></section>
    </main>
  );
}
