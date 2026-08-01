import Link from "next/link";
import { LocalTime } from "@/components/odds/LocalTime";
import { decisionStatusLabel } from "@/lib/product/vocabulary";
import { settlementLabel } from "@/lib/product/vocabulary";
import type { EvidenceDimension, MatchIntelligence } from "@/lib/match/matchIntelligence";

/**
 * The consumer-facing sections of the match page.
 *
 * Each renders a slice of one already-resolved view, so no component here
 * decides anything about the fixture — that happened once, in
 * buildMatchIntelligence. A section can therefore never disagree with the one
 * above it.
 */
const percent = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${Math.round(value * 100)}%`;
const odds = (value: number) => value.toFixed(2);

export function MatchHeader({ view }: { view: MatchIntelligence }) {
  const { header, phase } = view;
  return (
    <header className={`match-hero phase-${phase}`}>
      <div className="match-hero-meta">
        <span className={`match-phase-chip phase-${phase}`}>{header.stateLabel}</span>
        <span>{header.competition}</span>
        {header.country ? <span>{header.country}</span> : null}
        {header.venue ? <span>{header.venue}</span> : null}
      </div>
      <h1 className="match-hero-title">
        <span>{header.homeTeam}</span>
        {header.score ? (
          <strong className="match-hero-score" aria-label={`Score ${header.score.home} ${header.score.away}`}>
            {header.score.home}<i aria-hidden="true">–</i>{header.score.away}
          </strong>
        ) : (
          <span className="match-hero-versus">v</span>
        )}
        <span>{header.awayTeam}</span>
      </h1>
      <div className="match-hero-times">
        <span>
          <LocalTime iso={header.kickoffAt} variant="datetime" />
        </span>
        {header.lastVerifiedAt ? (
          <span className="muted small">
            Last verified <LocalTime iso={header.lastVerifiedAt} variant="datetime" />
          </span>
        ) : null}
      </div>
    </header>
  );
}

export function OddsSection({ view }: { view: MatchIntelligence }) {
  const { odds: oddsView } = view;
  return (
    <section className="section match-section" aria-labelledby="match-odds-heading">
      <div className="section-title">
        <div>
          <span className="section-kicker">Market</span>
          <h2 id="match-odds-heading">Odds and market context</h2>
        </div>
      </div>

      {oddsView.state === "current" || oddsView.state === "historical-only" ? (
        <>
          {oddsView.state === "historical-only" ? <p className="match-odds-note">{oddsView.note}</p> : null}
          <div className="match-odds-grid">
            {oddsView.quotes.slice(0, 6).map((quote) => (
              <div className="match-odds-cell" key={`${quote.market}:${quote.selection}`}>
                <span>{quote.label}</span>
                <strong>{odds(quote.decimalOdds)}</strong>
                <small className="muted">
                  {percent(quote.noVigProbability ?? 1 / quote.decimalOdds)}{" "}
                  {quote.noVigProbability === null ? "implied" : "fair"}
                </small>
              </div>
            ))}
          </div>
          <p className="muted small">
            {oddsView.state === "current"
              ? `${oddsView.bookmakerCount || "—"} source${oddsView.bookmakerCount === 1 ? "" : "s"} · observed `
              : "Recorded "}
            <LocalTime iso={oddsView.observedAt} variant="datetime" />
            {oddsView.state === "current"
              ? ". Fair probability removes the bookmaker margin where the market supports it."
              : "."}
          </p>
        </>
      ) : (
        <p className="muted">{oddsView.note}</p>
      )}
    </section>
  );
}

export function ModelSection({ view }: { view: MatchIntelligence }) {
  const { model, header } = view;
  if (model.state === "unavailable") {
    return (
      <section className="section match-section" aria-labelledby="match-model-heading">
        <div className="section-title"><div><span className="section-kicker">Model</span><h2 id="match-model-heading">The model view</h2></div></div>
        <p className="muted">{model.note}</p>
      </section>
    );
  }

  const rows: Array<{ label: string; model: number; market: number | null }> = [
    { label: header.homeTeam, model: model.probabilities.home, market: model.marketProbabilities?.home ?? null },
    ...(model.probabilities.draw !== null
      ? [{ label: "Draw", model: model.probabilities.draw, market: model.marketProbabilities?.draw ?? null }]
      : []),
    { label: header.awayTeam, model: model.probabilities.away, market: model.marketProbabilities?.away ?? null }
  ];

  return (
    <section className="section match-section" aria-labelledby="match-model-heading">
      <div className="section-title">
        <div>
          <span className="section-kicker">Model</span>
          <h2 id="match-model-heading">The model view</h2>
        </div>
        <span className={`badge ${model.basis === "live" ? "positive" : "scheduled"}`}>
          {model.basis === "live" ? "Updated in play" : "Pre-match"}
        </span>
      </div>

      {model.basisNote ? <p className="match-basis-note">{model.basisNote}</p> : null}

      <div className="match-probability-rows">
        {rows.map((row) => (
          <div className="match-probability-row" key={row.label}>
            <span className="match-probability-label">{row.label}</span>
            <span className="match-probability-track" role="presentation">
              <i style={{ width: `${Math.round(row.model * 100)}%` }} />
            </span>
            <span className="match-probability-values">
              <strong>{percent(row.model)}</strong>
              <small className="muted">market {percent(row.market)}</small>
            </span>
          </div>
        ))}
      </div>

      {model.interval ? (
        <p className="muted small">
          Uncertainty range on the leading outcome: {percent(model.interval.low)} to {percent(model.interval.high)}.
        </p>
      ) : null}
      <p className="muted small">
        {model.modelFamily} · {model.modelVersion} · generated <LocalTime iso={model.generatedAt} variant="datetime" />
        {" · "}evidence to <LocalTime iso={model.evidenceCutoffAt} variant="datetime" />
        {" · "}
        {model.calibrationState === "calibrated"
          ? "calibrated against settled outcomes"
          : model.calibrationState === "provisional"
            ? "provisional calibration"
            : "not yet calibrated for this sport"}
        {model.stale ? " · this view has not been refreshed recently" : ""}
      </p>
    </section>
  );
}

export function DecisionSection({ view }: { view: MatchIntelligence }) {
  const { decision } = view;
  return (
    <section className="section match-section match-decision" aria-labelledby="match-decision-heading">
      <div className="section-title">
        <div>
          <span className="section-kicker">{decision.historical ? "What OddsPadi said" : "The decision"}</span>
          <h2 id="match-decision-heading">{decisionStatusLabel(mapToSlate(decision.status))}</h2>
        </div>
      </div>
      <p className="match-decision-headline">{decision.headline}</p>

      {decision.publication ? (
        <div className="match-publication">
          <dl>
            <div><dt>Market</dt><dd>{decision.publication.market.replaceAll("_", " ")}</dd></div>
            <div><dt>Selection</dt><dd>{decision.publication.selectionLabel}</dd></div>
            <div><dt>Odds at publication</dt><dd>{odds(decision.publication.oddsAtPublication)}</dd></div>
            <div><dt>Published</dt><dd><LocalTime iso={decision.publication.publishedAt} variant="datetime" /></dd></div>
            <div><dt>Settlement</dt><dd>{settlementLabel(decision.publication.settlementStatus)}</dd></div>
          </dl>
          <Link className="text-link" href={decision.publication.ledgerHref}>
            See this pick in the official ledger →
          </Link>
        </div>
      ) : decision.reason ? (
        <p className="muted">{decision.reason}</p>
      ) : null}
    </section>
  );
}

/** Canonical decision status → the slate key the shared label map uses. */
function mapToSlate(status: MatchIntelligence["decision"]["status"]) {
  if (status === "pick") return "value_pick" as const;
  if (status === "lean") return "lean" as const;
  if (status === "watch") return "watchlist" as const;
  if (status === "pass") return "no_clear_value" as const;
  if (status === "withheld") return "needs_data" as const;
  return "suspended" as const;
}

export function FactorsSection({ view }: { view: MatchIntelligence }) {
  if (!view.factors.length) return null;
  return (
    <section className="section match-section" aria-labelledby="match-factors-heading">
      <div className="section-title">
        <div>
          <span className="section-kicker">Reasoning</span>
          <h2 id="match-factors-heading">Why OddsPadi reached this view</h2>
        </div>
      </div>
      <ul className="match-factor-list">
        {view.factors.map((factor) => (
          <li key={`${factor.kind}:${factor.label}`} className={`match-factor ${factor.direction}`}>
            <span className="match-factor-label">{factor.label}</span>
            <span>{factor.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function evidenceBandLabel(band: EvidenceDimension["band"]): string {
  if (band === "strong") return "Strong";
  if (band === "adequate") return "Adequate";
  if (band === "thin") return "Thin";
  return "Unknown";
}

export function EvidenceSection({ view }: { view: MatchIntelligence }) {
  return (
    <section className="section match-section" aria-labelledby="match-evidence-heading">
      <div className="section-title">
        <div>
          <span className="section-kicker">Evidence</span>
          <h2 id="match-evidence-heading">What this view rests on</h2>
        </div>
      </div>
      <ul className="match-evidence-list">
        {view.evidence.map((dimension) => (
          <li key={dimension.id} className={`match-evidence-row band-${dimension.band}`}>
            <div className="match-evidence-top">
              <span>{dimension.label}</span>
              <strong>{evidenceBandLabel(dimension.band)}</strong>
            </div>
            <div className="match-evidence-track" role="presentation">
              <i style={{ width: `${Math.round((dimension.score ?? 0) * 100)}%` }} />
            </div>
            <small className="muted">{dimension.definition}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TIMELINE_LABELS: Record<MatchIntelligence["timeline"][number]["kind"], string> = {
  "odds-snapshot": "Prices observed",
  "model-generated": "Model view generated",
  published: "Official pick published",
  "lineup-confirmed": "Lineups confirmed",
  kickoff: "Kickoff",
  "score-change": "Score change",
  "final-result": "Final result",
  settlement: "Settled"
};

export function TimelineSection({ view }: { view: MatchIntelligence }) {
  if (!view.timeline.length) return null;
  return (
    <section className="section match-section" aria-labelledby="match-timeline-heading">
      <div className="section-title">
        <div>
          <span className="section-kicker">Record</span>
          <h2 id="match-timeline-heading">What happened, in order</h2>
        </div>
      </div>
      <ol className="match-timeline">
        {view.timeline.map((event, index) => (
          <li key={`${event.kind}-${event.at}-${index}`} className={`match-timeline-event kind-${event.kind}`}>
            <time dateTime={event.at}><LocalTime iso={event.at} variant="datetime" /></time>
            <span className="match-timeline-kind">{TIMELINE_LABELS[event.kind]}</span>
            <span className="muted small">{event.summary}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Methodology, collapsed.
 *
 * This is the whole of the technical disclosure a reader gets, and it is
 * deliberately small: model family, version, timestamps, calibration and a
 * link. What used to live here — agent deliberation, reasoning graphs,
 * self-critique passes, tool execution — is operational machinery, not
 * transparency, and it is no longer rendered on a consumer page.
 */
export function MethodologySection({ view }: { view: MatchIntelligence }) {
  if (view.model.state !== "available") return null;
  const model = view.model;
  return (
    <details className="fold match-methodology">
      <summary>Methodology and technical details</summary>
      <div className="fold-body">
        <dl>
          <div><dt>Model family</dt><dd>{model.modelFamily}</dd></div>
          <div><dt>Version</dt><dd>{model.modelVersion}</dd></div>
          <div><dt>Generated</dt><dd><LocalTime iso={model.generatedAt} variant="datetime" /></dd></div>
          <div><dt>Evidence cutoff</dt><dd><LocalTime iso={model.evidenceCutoffAt} variant="datetime" /></dd></div>
          <div><dt>Calibration</dt><dd>{model.calibrationState}</dd></div>
          <div><dt>Basis</dt><dd>{model.basis === "live" ? "Updated during play" : "Pre-match"}</dd></div>
        </dl>
        <p className="muted small">
          Probabilities are the model&apos;s own estimate; market probabilities remove the bookmaker margin where the
          market supports it. Full methodology and the promotion gates a model must pass are on the{" "}
          <Link className="text-link" href="/predictions/decision-engine">engine page</Link>.
        </p>
      </div>
    </details>
  );
}
