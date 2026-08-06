import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { LocalTime } from "@/components/odds/LocalTime";
import {
  buildDailyDoubleView,
  buildTicketBoardView,
  getCachedCalibrationBands,
  type ProfileProvenance
} from "@/lib/accumulator/dailyDoubleReads";
import { SurfaceClaimMarker } from "@/components/system/SurfaceClaimMarker";
import { normaliseScore } from "@/lib/domain/surfaceClaim";
import { getCachedTodayTipsProduct } from "@/lib/sports/tips/publicReads";
import { formatOdds } from "@/lib/sports/prediction/format";
import { readTimezonePreference } from "@/lib/time/timezoneCookie";

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
  const timeZone = await readTimezonePreference();
  const [product, calibration] = await Promise.all([
    getCachedTodayTipsProduct(timeZone).catch(() => null),
    getCachedCalibrationBands().catch(() => ({ bandsBySport: {}, provenance: [] as ProfileProvenance[] }))
  ]);

  const rows = product?.sections.allAnalysed ?? null;
  const view = buildDailyDoubleView({ rows, bandsBySport: calibration.bandsBySport });
  const boardView = buildTicketBoardView({ rows, bandsBySport: calibration.bandsBySport });

  // Sports actually represented on today's slip, so the provenance block
  // describes the models in use rather than every model that exists.
  const usedSports = view.state === "ready" && view.slip.status === "built"
    ? new Set(view.slip.legs.map((leg) => leg.sport))
    : new Set<string>();
  const usedProfiles = calibration.provenance.filter((profile) => usedSports.has(profile.sport));
  const unapproved = usedProfiles.filter((profile) => !profile.approvedForLiveInfluence);

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

          <section className="section" aria-labelledby="dd-provenance">
            <div className="section-title">
              <div>
                <span className="section-kicker">Where these numbers come from</span>
                <h2 id="dd-provenance">The model behind the percentages</h2>
              </div>
            </div>
            {usedProfiles.length === 0 ? (
              <p className="muted">No calibration profile is recorded for the sports on this slip.</p>
            ) : (
              <ul className="muted daily-double-notes">
                {usedProfiles.map((profile) => (
                  <li key={profile.sport}>
                    <strong>{profile.sport}</strong> — {profile.modelKey ?? "unnamed model"}, measured against{" "}
                    {profile.settledSize.toLocaleString()} settled outcome{profile.settledSize === 1 ? "" : "s"}.{" "}
                    {profile.approvedForLiveInfluence
                      ? "This profile is approved."
                      : `This profile is ${profile.readiness.replace(/-/g, " ")} and has not been approved for live influence.`}
                    {profile.valueClaimSupported ? null : (
                      <>
                        {" "}
                        <em>
                          Closing-line evidence is insufficient for this sport, so the edge shown is a model estimate
                          and not a demonstrated advantage over the closing price.
                        </em>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {unapproved.length > 0 ? (
              <div className="notice">
                <strong>Not an official pick.</strong> The percentages above come from a calibration profile that has
                passed its statistical checks but has not been approved. They are shown so the arithmetic can be
                inspected, and they do not enter the{" "}
                <Link className="inline-link" href="/track-record">public track record</Link>, which only ever counts
                picks published before kick-off under an approved model.
              </div>
            ) : null}
          </section>

          {/* Claims, so the cross-surface suite can see this page at all. A
              surface that renders a fixture without stamping one is invisible
              to the consistency check and free to drift. */}
          {view.slip.legs.map((leg) => (
            <SurfaceClaimMarker
              key={`claim:${leg.fixtureId}:${leg.market}:${leg.selection}`}
              claim={{
                surface: "daily-double",
                fixtureId: leg.fixtureId,
                fixtureStatus: "scheduled",
                score: normaliseScore(null, null),
                market: leg.market,
                selection: leg.selection,
                decision: "lean",
                publicationId: null,
                publicationStatus: null,
                publishedAt: null,
                settlement: null,
                oddsAvailable: true,
                dataAvailability: "complete",
                asOf: product?.generatedAt ?? null
              }}
            />
          ))}
        </>
      )}

      {boardView.state !== "ready" || !boardView.board.tickets.length ? (
        <section className="section" aria-labelledby="dd-board-empty">
          <div className="section-title">
            <div>
              <span className="section-kicker">The ticket board</span>
              <h2 id="dd-board-empty">No tickets right now</h2>
            </div>
          </div>
          {/* An empty board must explain itself. Rendering nothing at all was
              the first version, and an absent section is indistinguishable from
              a broken one — the same defect this codebase keeps removing. */}
          <div className="notice">
            <strong>Nothing to combine yet.</strong>{" "}
            {boardView.state !== "ready"
              ? boardView.note
              : "No selection currently clears its sport's calibrated band with a real edge. Tickets appear once the next slate is priced — typically a few hours before the first kick-off."}
          </div>
        </section>
      ) : (
        <section className="section" aria-labelledby="dd-board">
          <div className="section-title">
            <div>
              <span className="section-kicker">The ticket board</span>
              <h2 id="dd-board">
                {boardView.board.tickets.length} tickets across {boardView.board.fixturesCovered} games
              </h2>
            </div>
          </div>
          <p className="muted">
            Longer tickets pay more and land less. Both columns below are true at the same time, and the second is the
            one most slips are decided by.
          </p>

          <div className="ticket-board">
            {boardView.board.tickets.map((ticket, index) => (
              <article className="ticket" key={`${ticket.tierId}-${index}`}>
                <header>
                  <span className="ticket-tier">{ticket.tierLabel}</span>
                  <strong className="ticket-odds">{formatOdds(ticket.combinedOdds)}</strong>
                </header>
                <dl className="ticket-maths">
                  <div>
                    <dt>Chance of landing</dt>
                    <dd>{(ticket.combinedProbability * 100).toFixed(1)}% &middot; about 1 in {ticket.oneInN}</dd>
                  </div>
                  <div>
                    <dt>Expected value</dt>
                    <dd className={ticket.expectedValue > 0 ? "positive" : "negative"}>
                      {ticket.expectedValue > 0 ? "+" : ""}{(ticket.expectedValue * 100).toFixed(1)}%
                    </dd>
                  </div>
                  <div>
                    <dt>Compounded margin</dt>
                    <dd>{(ticket.combinedMargin * 100).toFixed(1)}%</dd>
                  </div>
                </dl>
                <ol className="ticket-legs">
                  {ticket.legs.map((leg) => (
                    <li key={`${leg.fixtureId}:${leg.market}:${leg.selection}`}>
                      <Link className="text-link" href={`/predictions/${encodeURIComponent(leg.fixtureId)}`}>
                        {leg.selectionLabel}
                      </Link>
                      <span>{formatOdds(leg.decimalOdds)}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>

          <ul className="muted daily-double-notes">
            {boardView.board.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="section"><ResponsibleUseNotice /></section>
    </main>
  );
}
