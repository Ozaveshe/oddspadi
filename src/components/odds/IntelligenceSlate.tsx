import Link from "next/link";
import { LocalTime } from "@/components/odds/LocalTime";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import type { SlateFixture, SlatePublicStatus, SportsSlate } from "@/lib/sports/intelligence/types";
import type { DailyTipsProduct, WeeklyTipsProduct, YesterdayResultsProduct } from "@/lib/sports/tips/product";
import { publicWatchlistReason } from "@/lib/sports/prediction/publicDecisionCopy";

const STATUS_LABELS: Record<SlatePublicStatus, string> = {
  value_pick: "Value Pick",
  lean: "Lean",
  watchlist: "Watchlist",
  no_clear_value: "No Pick",
  preliminary: "Preliminary",
  ready: "Ready",
  stale: "Stale",
  needs_data: "Needs data",
  suspended: "Suspended",
  settled: "Settled",
  needs_review: "Needs review"
};

function badgeClass(status: SlatePublicStatus): string {
  if (status === "value_pick") return "positive";
  if (status === "lean" || status === "ready") return "medium";
  if (status === "watchlist" || status === "preliminary") return "scheduled";
  if (status === "settled") return "finished";
  return "no-value";
}

function freshness(row: SlateFixture, asOf: string): { label: string; className: string } {
  const pick = row.decisionSummary.bestPublishedPick ?? row.decisionSummary.bestLean ?? row.decisionSummary.bestWatchlistCandidate;
  const expiresAt = pick?.expiresAt ?? row.decisionSummary.expiresAt;
  if (row.publicStatus === "stale" || (expiresAt && Date.parse(expiresAt) <= Date.parse(asOf))) return { label: "Stale — refresh required", className: "no-value" };
  if (!expiresAt) return { label: "No active price", className: "scheduled" };
  return { label: "Fresh", className: "positive" };
}

function strongestModelLean(row: SlateFixture): string {
  const candidate = row.decisionSummary.bestLean
    ?? row.decisionSummary.allMarketAnalyses.slice().sort((left, right) => right.modelProbability - left.modelProbability)[0];
  return candidate?.label ?? "No preferred market";
}

export function noPickExplanation(row: SlateFixture): string {
  if (row.publicStatus === "stale") return "Market stale — the supporting price expired and must be refreshed.";
  if (row.publicStatus === "preliminary") return "Odds or match context are not ready for a complete engine decision.";
  const analysis = row.decisionSummary.allMarketAnalyses.slice().sort((left, right) => right.edge - left.edge)[0];
  if (analysis?.blockers[0]) return analysis.blockers[0];
  if (analysis && analysis.odds < row.decisionSummary.auditSummary.thresholds.minimumOdds) return "Odds too short for the configured risk guardrail.";
  if (analysis && analysis.edge > 0 && analysis.edge < row.decisionSummary.auditSummary.thresholds.minimumValueEdge) return "Positive edge is below the publication threshold.";
  if (analysis && analysis.edge <= 0) return "The current price does not offer a positive model edge.";
  return row.decisionSummary.noPickReason ?? "Data is incomplete, so the engine did not publish a selection.";
}

export function ProviderRunStrip({ slate }: { slate: SportsSlate }) {
  const lastRun = slate.provider.lastRun;
  const readable = slate.provider.status !== "unavailable" && slate.provider.status !== "failed";
  const value = (number: number) => readable ? number : "—";
  return (
    <section className="engine-rundown" aria-label="Latest provider and engine run">
      <div className="engine-rundown-state">
        <span className={`badge ${slate.provider.status === "completed" ? "positive" : slate.provider.status === "partial" || slate.provider.status === "empty" ? "scheduled" : "no-value"}`}>
          {slate.provider.status}
        </span>
        <div><strong>Provider health</strong><small>{slate.provider.providers.join(", ") || (readable ? "No provider returned a slate" : "No stored provider response was read")}</small></div>
      </div>
      <dl>
        <div><dt>Fixtures</dt><dd>{value(slate.summary.fixturesFound)}</dd></div>
        <div><dt>Analysed</dt><dd>{value(slate.summary.predictionsGenerated)}</dd></div>
        <div><dt>Odds used</dt><dd>{value(slate.summary.oddsSnapshotsUsed)}</dd></div>
        <div><dt>Value picks</dt><dd>{value(slate.summary.valuePicksPublished)}</dd></div>
        <div><dt>Leans</dt><dd>{value(slate.summary.leansPublished)}</dd></div>
        <div><dt>Watchlist</dt><dd>{value(slate.summary.watchlist)}</dd></div>
        <div><dt>Last run</dt><dd>{lastRun?.finishedAt ? new Date(lastRun.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : readable ? "Not completed" : "Not read"}</dd></div>
      </dl>
      {slate.provider.errors.length ? <details><summary>{slate.provider.errors.length} provider or pipeline issue{slate.provider.errors.length === 1 ? "" : "s"}</summary><ul>{slate.provider.errors.map((error) => <li key={error}>{error}</li>)}</ul></details> : null}
    </section>
  );
}

export function SlateFixtureCard({ row, compact = false, asOf }: { row: SlateFixture; compact?: boolean; asOf?: string }) {
  const { fixture, decisionSummary } = row;
  const displayedDecision = decisionSummary.bestPublishedPick ?? decisionSummary.bestLean ?? decisionSummary.bestWatchlistCandidate;
  const currentAsOf = asOf ?? decisionSummary.generatedAt;
  const fresh = freshness(row, currentAsOf);
  return (
    <article className={`intelligence-card status-${row.publicStatus}${compact ? " compact" : ""}`}>
      <div className="intelligence-card-topline">
        <span>{fixture.sport} · {fixture.league} · {fixture.country}</span>
        <span className={`badge ${badgeClass(row.publicStatus)}`}>{STATUS_LABELS[row.publicStatus]}</span>
      </div>
      <div className="intelligence-matchline">
        <Link href={`/predictions/${encodeURIComponent(fixture.fixtureId)}`}>
          <strong>{fixture.homeTeam.name}</strong><span>vs</span><strong>{fixture.awayTeam.name}</strong>
        </Link>
        <small><LocalTime iso={fixture.kickoffAt} /> · {fixture.provider}</small>
      </div>
      {displayedDecision ? (
        <>
          <div className="intelligence-decision">
            <div><span>Market</span><strong>{displayedDecision.marketId.replaceAll("_", " ")}</strong></div>
            <div><span>Selection</span><strong>{displayedDecision.label}</strong></div>
            <div><span>Odds</span><strong>{formatOdds(displayedDecision.odds)}</strong></div>
            <div><span>Model chance</span><strong>{formatPercent(displayedDecision.modelProbability)}</strong></div>
            <div><span>Bookmaker fair chance</span><strong>{formatPercent(displayedDecision.noVigImpliedProbability)}</strong></div>
            <div><span>Edge</span><strong>{formatSignedPercent(displayedDecision.edge)}</strong></div>
            <div><span>Confidence</span><strong>{displayedDecision.confidence}</strong></div>
            <div><span>Risk</span><strong>{decisionSummary.risk}</strong></div>
          </div>
          <div className="decision-freshness">
            <span className={`badge ${fresh.className}`}>{fresh.label}</span>
            <span>Generated <time dateTime={decisionSummary.generatedAt}>{new Date(decisionSummary.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
            <span>Expires {decisionSummary.expiresAt ? <time dateTime={decisionSummary.expiresAt}>{new Date(decisionSummary.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time> : "when fresh odds arrive"}</span>
          </div>
        </>
      ) : <p className="muted small">{noPickExplanation(row)}</p>}
      {!compact ? <p className="intelligence-reason"><strong>Why this matters</strong><span>{row.publicStatus === "watchlist" || row.publicStatus === "stale" ? publicWatchlistReason(decisionSummary) : displayedDecision ? displayedDecision.blockers[0] ?? (row.publicStatus === "value_pick" ? "This selection clears every publication guardrail." : "This is the strongest model preference at the current price.") : noPickExplanation(row)}</span></p> : null}
      <Link className="text-link intelligence-analysis-link" href={`/predictions/${encodeURIComponent(fixture.fixtureId)}`}>Full analysis →</Link>
    </article>
  );
}

function NoPickFixtureCard({ row, asOf }: { row: SlateFixture; asOf: string }) {
  return (
    <article className="no-pick-card">
      <div><span className={`badge ${badgeClass(row.publicStatus)}`}>{STATUS_LABELS[row.publicStatus]}</span><small><LocalTime iso={row.fixture.kickoffAt} /> · {row.fixture.league}</small></div>
      <h3><Link href={`/predictions/${encodeURIComponent(row.fixture.fixtureId)}`}>{row.fixture.homeTeam.name} vs {row.fixture.awayTeam.name}</Link></h3>
      <dl><div><dt>Model lean</dt><dd>{strongestModelLean(row)}</dd></div><div><dt>Why no pick</dt><dd>{noPickExplanation(row)}</dd></div></dl>
      <span className={`badge ${freshness(row, asOf).className}`}>{freshness(row, asOf).label}</span>
    </article>
  );
}

function SlateSection({ title, eyebrow, rows, empty, asOf, compact = false }: { title: string; eyebrow: string; rows: SlateFixture[]; empty: string; asOf: string; compact?: boolean }) {
  return (
    <section className="section intelligence-section">
      <div className="section-title"><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2></div><span className="badge scheduled">{rows.length}</span></div>
      {rows.length ? <div className="intelligence-grid">{rows.map((row) => <SlateFixtureCard key={`${title}-${row.fixture.fixtureId}`} row={row} compact={compact} asOf={asOf} />)}</div> : <div className="empty-state compact"><h3>{empty}</h3><p className="muted">The engine does not fill this section with sample fixtures.</p></div>}
    </section>
  );
}

export function DailyTipsSections({ product }: { product: DailyTipsProduct }) {
  const dayLabel = product.day === "today" ? "Today" : "Tomorrow";
  if (!product.sections.schedule.length) {
    return (
      <section className="section intelligence-empty-slate" aria-labelledby="empty-slate-title">
        <div className="intelligence-empty-copy">
          <span className="section-kicker">No synthetic fill</span>
          <h2 id="empty-slate-title">Nothing real to analyse yet</h2>
          <p>
            The provider returned no fixtures for {product.day}. OddsPadi has withheld every prediction instead of
            filling the page with sample matches or invented prices.
          </p>
          <div className="intelligence-empty-actions">
            <Link className="button primary" href="/predictions/week">Check the weekly radar</Link>
            <Link className="button" href="/predictions/history">Review settled results</Link>
          </div>
        </div>
        <div>
          <dl className="intelligence-empty-ledger">
            <div><dt>Fixtures</dt><dd>0 provider rows</dd></div>
            <div><dt>Verified odds</dt><dd>0 snapshots</dd></div>
            <div><dt>Public decision</dt><dd>Withheld</dd></div>
          </dl>
          <p className="small muted intelligence-empty-next">
            The next provider run will rebuild this slate. Until then, the weekly radar and results ledger remain
            available without implying that today&apos;s feed is healthy.
          </p>
        </div>
      </section>
    );
  }
  return (
    <>
      <SlateSection title={`${dayLabel}'s Full Schedule`} eyebrow="Every provider-backed fixture" rows={product.sections.schedule} empty={`No provider-backed fixtures are available for ${product.day}`} asOf={product.generatedAt} compact />
      <SlateSection title="Top Value Picks" eyebrow="Positive edge, fully cleared" rows={product.sections.valuePicks} empty="No value pick clears every gate" asOf={product.generatedAt} />
      <SlateSection title="Safer Leans" eyebrow="Model preference, not a value claim" rows={product.sections.leans} empty="No safer lean is ready" asOf={product.generatedAt} />
      <SlateSection title="Watchlist" eyebrow="Possible value, still blocked" rows={product.sections.watchlist} empty="Nothing is waiting on a price or evidence refresh" asOf={product.generatedAt} />
      <SlateSection title="All Matches Analysed" eyebrow="Completed engine decisions" rows={product.sections.allAnalysed} empty="No provider-backed matches have completed analysis" asOf={product.generatedAt} compact />
      <section className="section intelligence-section">
        <div className="section-title"><div><span className="section-kicker">Abstention stays visible</span><h2>No-Pick Matches</h2></div><span className="badge scheduled">{product.sections.noPicks.length}</span></div>
        {product.sections.noPicks.length ? <div className="no-pick-grid">{product.sections.noPicks.map((row) => <NoPickFixtureCard key={row.fixture.fixtureId} row={row} asOf={product.generatedAt} />)}</div> : <div className="empty-state compact"><h3>No additional no-pick matches</h3><p className="muted">Every analysed match currently has a stronger published or watchlist status.</p></div>}
      </section>
    </>
  );
}

function weeklyDayLabel(date: string, firstDate: string): string {
  if (date === firstDate) return "Today";
  const tomorrow = new Date(`${firstDate}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10)) return "Tomorrow";
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString([], { weekday: "long" });
}

export function WeeklySlateSections({ product }: { product: WeeklyTipsProduct }) {
  const hasProviderFixtures = product.days.some((group) => group.fixtures.length > 0);
  if (!hasProviderFixtures) {
    const firstDate = product.days[0]?.date ?? product.slate.range.from;
    const lastDate = product.days.at(-1)?.date ?? product.slate.range.to;
    return (
      <section className="section intelligence-empty-slate" aria-labelledby="empty-week-title">
        <div className="intelligence-empty-copy">
          <span className="section-kicker">Seven-day feed unavailable</span>
          <h2 id="empty-week-title">No real fixtures across the weekly window</h2>
          <p>
            The provider returned no fixtures from {firstDate} through {lastDate}. The calendar is not padded with
            sample matches, and no preliminary decision is created without a real fixture.
          </p>
          <div className="intelligence-empty-actions">
            <Link className="button primary" href="/predictions/today">Return to today&apos;s tips</Link>
            <Link className="button" href="/predictions/history">Review settled results</Link>
          </div>
        </div>
        <div>
          <dl className="intelligence-empty-ledger">
            <div><dt>Date window</dt><dd>{firstDate} to {lastDate}</dd></div>
            <div><dt>Fixtures</dt><dd>0 provider rows</dd></div>
            <div><dt>Decisions</dt><dd>0 generated</dd></div>
          </dl>
          <p className="small muted intelligence-empty-next">
            The next scheduled provider run will rebuild all seven dates. Social previews remain hidden until this
            window contains at least one real fixture.
          </p>
        </div>
      </section>
    );
  }
  return (
    <div className="weekly-rundown">
      {product.days.map((group) => (
        <section className="section weekly-day" key={group.date}>
          <div className="weekly-date">
            <span className="section-kicker">{weeklyDayLabel(group.date, product.slate.range.from)}</span>
            <time dateTime={group.date}>{new Date(`${group.date}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" })}</time>
            <span>{group.fixtures.length} fixture{group.fixtures.length === 1 ? "" : "s"}</span>
            <div className="weekly-status-counts">
              <span>{group.counts.preliminary} preliminary</span><span>{group.counts.ready} ready</span><span>{group.counts.valuePick} value</span><span>{group.counts.watchlist} watchlist</span><span>{group.counts.settled} settled</span>
            </div>
          </div>
          {group.fixtures.length ? <div className="intelligence-grid">{group.fixtures.map((row) => <SlateFixtureCard key={row.fixture.fixtureId} row={row} compact asOf={product.generatedAt} />)}</div> : <div className="weekly-empty-day"><strong>No provider fixture listed</strong><span>The day stays visible so the seven-day window is complete.</span></div>}
        </section>
      ))}
    </div>
  );
}

export function HomepageIntelligencePanels({ daily, weekly, yesterday }: { daily: DailyTipsProduct | null; weekly: WeeklyTipsProduct | null; yesterday: YesterdayResultsProduct | null }) {
  const best = daily?.sections.valuePicks[0] ?? null;
  const lean = daily?.sections.leans[0] ?? null;
  const watch = daily?.sections.watchlist[0] ?? null;
  return (
    <section className="section homepage-product-grid" aria-label="OddsPadi daily product overview">
      <article className="panel homepage-product-card tips-card">
        <div className="panel-header"><div><span className="section-kicker">Today&apos;s Tips</span><h2>Every match gets a decision</h2></div><Link className="button small-btn" href="/predictions/today">Open tips</Link></div>
        <p>Every available match is scanned by the OddsPadi engine. We show value picks when the numbers clear our guardrails, leans when the model likes a side but price is tight, and no-pick reasons when the edge is not there.</p>
        <div className="intelligence-home-metrics">
          <div><span>Best value</span><strong>{best?.decisionSummary.bestPublishedPick?.label ?? "No value published"}</strong></div>
          <div><span>Safer lean</span><strong>{lean?.decisionSummary.bestLean?.label ?? "No lean ready"}</strong></div>
          <div><span>Watchlist</span><strong>{watch?.decisionSummary.bestWatchlistCandidate?.label ?? "Nothing held"}</strong></div>
          <div><span>Analysed</span><strong>{daily?.summary.fixturesAnalysed ?? 0} / {daily?.summary.fixturesFound ?? 0}</strong></div>
        </div>
      </article>
      <article className="panel homepage-product-card weekly-preview-panel">
        <div className="panel-header"><div><span className="section-kicker">Weekly Radar</span><h2>Next seven days</h2></div><Link className="button small-btn" href="/predictions/week">Open week</Link></div>
        <p>Weekly predictions start preliminary and get refreshed as odds, injuries, lineups, and results change.</p>
        <div className="weekly-preview-count"><strong>{weekly?.summary.fixturesFound ?? 0}</strong><span>provider fixtures found</span></div>
        <div className="weekly-preview-meta"><span>{weekly?.summary.preliminaryDecisions ?? 0} preliminary</span><span>{weekly?.summary.readyDecisions ?? 0} ready</span><span>{weekly?.summary.staleDecisions ?? 0} stale</span></div>
      </article>
      <article className="panel homepage-product-card results-card">
        <div className="panel-header"><div><span className="section-kicker">Yesterday&apos;s Results</span><h2>The public ledger</h2></div><Link className="button small-btn" href="/predictions/history">View results</Link></div>
        <div className="result-scoreline"><strong>{yesterday?.summary.wins ?? 0}</strong><span>wins</span><strong>{yesterday?.summary.losses ?? 0}</strong><span>losses</span></div>
        <p className="muted small">{yesterday?.source === "unavailable" ? yesterday.reason : yesterday?.items.length ? `${yesterday.summary.settled} public picks settled yesterday.` : "No public picks settled yesterday. Internal runs are not substituted."}</p>
      </article>
      <article className="panel homepage-product-card engine-card">
        <div className="panel-header"><div><span className="section-kicker">Engine Status</span><h2>{daily?.slate.provider.status ?? "Unavailable"}</h2></div><span className={`badge ${daily?.slate.provider.status === "completed" ? "positive" : "scheduled"}`}>{daily?.slate.provider.status ?? "offline"}</span></div>
        <div className="engine-rail" aria-hidden="true"><span style={{ width: `${daily?.summary.fixturesFound ? Math.min(100, (daily.summary.fixturesAnalysed / daily.summary.fixturesFound) * 100) : 0}%` }} /></div>
        <div className="intelligence-home-metrics"><div><span>Odds snapshots</span><strong>{daily?.summary.oddsSnapshotsUsed ?? 0}</strong></div><div><span>Last run</span><strong>{daily?.slate.provider.lastRun?.finishedAt ? new Date(daily.slate.provider.lastRun.finishedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Waiting"}</strong></div><div><span>Provider</span><strong>{daily?.slate.provider.providers.join(", ") || "No provider response"}</strong></div></div>
      </article>
    </section>
  );
}
