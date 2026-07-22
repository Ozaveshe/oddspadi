import * as React from "react";
import Link from "next/link";
import { LiveCoverageFallback } from "@/components/live/MatchdayFallback";
import type { LiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { LocalTime } from "@/components/odds/LocalTime";
import { formatOdds } from "@/lib/sports/prediction/format";
import type { SlateFixture, SlatePublicStatus, SportsSlate } from "@/lib/sports/intelligence/types";
import type { DailyTipsProduct, WeeklyTipsDay, WeeklyTipsProduct, YesterdayResultsProduct } from "@/lib/sports/tips/product";
import { buildPredictionPresentation, displayedSlateDecision, noPickExplanation } from "@/lib/sports/prediction/presentation";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { TeamCrest } from "@/components/odds/TeamCrest";
import { DecisionPriceSignal } from "@/components/odds/DecisionPriceSignal";
import { marketPriorReceiptFor } from "@/lib/sports/prediction/marketPriorPresentation";

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

const DAILY_DECISION_RENDER_LIMIT = 36;
const DAILY_QUEUE_RENDER_LIMIT = 12;

function badgeClass(status: SlatePublicStatus): string {
  if (status === "value_pick") return "positive";
  if (status === "lean" || status === "ready") return "medium";
  if (status === "watchlist" || status === "preliminary") return "scheduled";
  if (status === "settled") return "finished";
  return "no-value";
}

function strongestModelLean(row: SlateFixture): string {
  const candidate = row.decisionSummary.bestLean
    ?? row.decisionSummary.allMarketAnalyses.slice().sort((left, right) => right.modelProbability - left.modelProbability)[0];
  return candidate?.label ?? "No preferred market";
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
  const presentation = buildPredictionPresentation(row, asOf ?? decisionSummary.generatedAt);
  const displayedDecision = displayedSlateDecision(row);
  return (
    <article className={`intelligence-card status-${row.publicStatus}${compact ? " compact" : ""}`}>
      <div className="intelligence-card-topline">
        <span className="intelligence-competition"><CountryFlag country={fixture.country} flag={fixture.leagueFlag} size={16} /><span>{fixture.sport} · {fixture.league} · {fixture.country}</span></span>
        <span className={`badge ${badgeClass(row.publicStatus)}`}>{STATUS_LABELS[row.publicStatus]}</span>
      </div>
      <div className="intelligence-matchline">
        <Link href={presentation.analysisHref}>
          <span className="intelligence-team"><TeamCrest name={fixture.homeTeam.name} logo={fixture.homeTeam.logo} size={30} /><span className="intelligence-team-copy"><strong>{fixture.homeTeam.name}</strong><small><CountryFlag country={fixture.homeTeam.country} size={12} />{fixture.homeTeam.country ?? "Country pending"}</small></span></span>
          <span className="intelligence-versus">vs</span>
          <span className="intelligence-team intelligence-team--away"><TeamCrest name={fixture.awayTeam.name} logo={fixture.awayTeam.logo} size={30} /><span className="intelligence-team-copy"><strong>{fixture.awayTeam.name}</strong><small><CountryFlag country={fixture.awayTeam.country} size={12} />{fixture.awayTeam.country ?? "Country pending"}</small></span></span>
        </Link>
        <small><LocalTime iso={fixture.kickoffAt} /> · {fixture.provider}</small>
      </div>
      {displayedDecision ? (
        <>
          <div className="intelligence-pick">
            <div><span>{presentation.marketLabel}</span><strong>{displayedDecision.label}</strong></div>
            <div><span>Current odds</span><strong>{formatOdds(displayedDecision.odds)}</strong></div>
          </div>
          <DecisionPriceSignal
            modelProbability={displayedDecision.modelProbability}
            marketProbability={displayedDecision.noVigImpliedProbability}
            currentOdds={displayedDecision.odds}
            edge={displayedDecision.edge}
            expectedValue={displayedDecision.expectedValue}
            marketPriorReceipt={marketPriorReceiptFor(decisionSummary.auditSummary.marketPriorAdjustment, displayedDecision.marketId)}
            executionPriceReceipt={displayedDecision}
            publicationGateReceipt={displayedDecision}
            economicConfidenceReceipt={displayedDecision.economicConfidence}
            compact={compact}
          />
          <div className="decision-quality-line"><span>Evidence <strong>{decisionSummary.evidenceQuality}</strong></span><span>Risk <strong>{decisionSummary.risk}</strong></span></div>
          {!compact ? <p className="intelligence-verdict">{presentation.verdict}</p> : null}
          <div className="decision-freshness">
            <span className={`badge ${presentation.freshness === "fresh" ? "positive" : presentation.freshness === "stale" ? "no-value" : "scheduled"}`}>{presentation.freshnessLabel}</span>
            <span>Model {presentation.modelVersion ?? "version recorded"}</span>
            <span>Generated <time dateTime={decisionSummary.generatedAt}>{new Date(decisionSummary.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
          </div>
        </>
      ) : <p className="muted small">{noPickExplanation(row)}</p>}
      {!compact ? <div className="intelligence-why"><p><strong>Why it qualifies</strong><span>{presentation.primaryReason}</span></p><p><strong>Main risk</strong><span>{presentation.primaryRisk}</span></p></div> : null}
      <div className="intelligence-card-actions">
        <Link className="text-link intelligence-analysis-link" href={presentation.analysisHref}>View analysis →</Link>
        <Link className="text-link intelligence-community-link" href={presentation.communityHref}>Community pulse</Link>
      </div>
      <p className="community-boundary-note">Community opinions never change the OddsPadi model decision.</p>
    </article>
  );
}

function NoPickFixtureCard({ row, asOf }: { row: SlateFixture; asOf: string }) {
  const presentation = buildPredictionPresentation(row, asOf);
  return (
    <article className="no-pick-card">
      <div><span className={`badge ${badgeClass(row.publicStatus)}`}>{STATUS_LABELS[row.publicStatus]}</span><small><LocalTime iso={row.fixture.kickoffAt} /> · {row.fixture.league}</small></div>
      <h3><Link href={`/predictions/${encodeURIComponent(row.fixture.fixtureId)}`}>{row.fixture.homeTeam.name} vs {row.fixture.awayTeam.name}</Link></h3>
      <dl><div><dt>Model lean</dt><dd>{strongestModelLean(row)}</dd></div><div><dt>Why no pick</dt><dd>{noPickExplanation(row)}</dd></div></dl>
      <span className={`badge ${presentation.freshness === "fresh" ? "positive" : presentation.freshness === "stale" ? "no-value" : "scheduled"}`}>{presentation.freshnessLabel}</span>
    </article>
  );
}

function SlateSection({ id, title, eyebrow, rows, empty, asOf, compact = false }: { id?: string; title: string; eyebrow: string; rows: SlateFixture[]; empty: string; asOf: string; compact?: boolean }) {
  const visibleRows = rows.slice(0, DAILY_DECISION_RENDER_LIMIT);
  const hiddenRows = rows.length - visibleRows.length;
  return (
    <section className="section intelligence-section" id={id}>
      <div className="section-title"><div><span className="section-kicker">{eyebrow}</span><h2>{title}</h2></div><span className="badge scheduled">{rows.length}</span></div>
      {visibleRows.length ? <div className="intelligence-grid">{visibleRows.map((row) => <SlateFixtureCard key={`${title}-${row.fixture.fixtureId}`} row={row} compact={compact} asOf={asOf} />)}</div> : <div className="empty-state compact"><h3>{empty}</h3><p className="muted">The engine does not fill this section with sample fixtures.</p></div>}
      {hiddenRows > 0 ? <p className="small muted">Showing the first {visibleRows.length} of {rows.length} decisions to keep this matchday page fast. Use the sport filters above to narrow the board.</p> : null}
    </section>
  );
}

export function partitionDailyTipsSections(product: DailyTipsProduct) {
  const reviewedFixtureIds = new Set(product.sections.allAnalysed.map((row) => row.fixture.fixtureId));
  const highlightedFixtureIds = new Set(
    [...product.sections.valuePicks, ...product.sections.leans, ...product.sections.watchlist]
      .map((row) => row.fixture.fixtureId)
  );
  return {
    published: [...product.sections.valuePicks, ...product.sections.leans],
    abstentions: product.sections.allAnalysed.filter((row) => !highlightedFixtureIds.has(row.fixture.fixtureId)),
    waitingForEvidence: product.sections.schedule.filter((row) => !reviewedFixtureIds.has(row.fixture.fixtureId))
  };
}

export function partitionDecisionAuditRows(rows: SlateFixture[]) {
  const reviewed = rows.filter((row) => row.decisionSummary.allMarketAnalyses.length > 0);
  const reviewedFixtureIds = new Set(reviewed.map((row) => row.fixture.fixtureId));
  return {
    reviewed,
    awaitingReview: rows.filter((row) => !reviewedFixtureIds.has(row.fixture.fixtureId))
  };
}

export function DailyDecisionOverview({ product }: { product: DailyTipsProduct }) {
  if (!product.sections.schedule.length) return null;
  const { published, abstentions, waitingForEvidence } = partitionDailyTipsSections(product);
  const reviewed = product.sections.allAnalysed.length;
  return (
    <section className="daily-decision-overview" aria-labelledby="daily-decision-overview-title">
      <div className="daily-decision-overview-copy">
        <span className="section-kicker">Decision board</span>
        <h2 id="daily-decision-overview-title">
          {reviewed} reviewed. {published.length ? `${published.length} public decision${published.length === 1 ? "" : "s"} ready.` : "No public pick forced."}
        </h2>
        <p>{waitingForEvidence.length} provider fixture{waitingForEvidence.length === 1 ? " is" : "s are"} still waiting for current odds or enough evidence. Reviewed decisions appear before that queue.</p>
      </div>
      <nav className="daily-decision-jumps" aria-label={`Jump to ${product.day}'s decision groups`}>
        <a href="#daily-published"><strong>{published.length}</strong><span>Published</span></a>
        <a href="#daily-watchlist"><strong>{product.sections.watchlist.length}</strong><span>Watchlist</span></a>
        <a href="#daily-abstentions"><strong>{abstentions.length}</strong><span>Abstained</span></a>
        <a href="#daily-queue"><strong>{waitingForEvidence.length}</strong><span>Waiting</span></a>
      </nav>
    </section>
  );
}

function DailyCoverageQueue({ rows, dayLabel, asOf }: { rows: SlateFixture[]; dayLabel: string; asOf: string }) {
  const visible = rows.slice(0, DAILY_QUEUE_RENDER_LIMIT);
  const remaining = rows.length - visible.length;
  return (
    <section className="section intelligence-section daily-coverage-queue" id="daily-queue">
      <div className="section-title"><div><span className="section-kicker">Provider coverage, not predictions</span><h2>{dayLabel}&apos;s Evidence Queue</h2></div><span className="badge scheduled">{rows.length}</span></div>
      <p className="daily-coverage-intro">These fixtures are real and current, but the engine has not completed a market-backed review. They stay separate from published decisions and watchlist entries.</p>
      {visible.length ? <div className="intelligence-grid">{visible.map((row) => <SlateFixtureCard key={`queue-${row.fixture.fixtureId}`} row={row} compact asOf={asOf} />)}</div> : <div className="empty-state compact"><h3>Every listed fixture has been reviewed</h3><p className="muted">There is no outstanding evidence queue for this slate.</p></div>}
      {remaining > 0 ? <p className="small muted">{remaining} additional provider fixture{remaining === 1 ? " remains" : "s remain"} in the evidence queue. They are counted above but not rendered into this page until reviewed.</p> : null}
    </section>
  );
}

export function DailyTipsSections({ product, fallbackBoard = null }: { product: DailyTipsProduct; fallbackBoard?: LiveScoreBoard | null }) {
  const dayLabel = product.day === "today" ? "Today" : "Tomorrow";
  if (!product.sections.schedule.length) {
    if (fallbackBoard?.fixtures.length) return <LiveCoverageFallback board={fallbackBoard} />;
    const storedSlateUnavailable = product.slate.provider.status === "failed" || product.slate.provider.status === "unavailable";
    return (
      <section className="section intelligence-empty-slate" aria-labelledby="empty-slate-title">
        <div className="intelligence-empty-copy">
          <span className="section-kicker">No synthetic fill</span>
          <h2 id="empty-slate-title">{storedSlateUnavailable ? "The stored provider slate is unavailable" : "Nothing real to analyse yet"}</h2>
          {storedSlateUnavailable ? (
            <p>
              OddsPadi could not read the latest stored provider response for {product.day}. Every prediction is
              withheld until that receipt is available; this state does not mean the upstream provider returned no fixtures.
            </p>
          ) : (
            <p>
              The provider returned no fixtures for {product.day}. OddsPadi has withheld every prediction instead of
              filling the page with sample matches or invented prices.
            </p>
          )}
          <div className="intelligence-empty-actions">
            <Link className="button primary" href="/predictions/week">Check the weekly radar</Link>
            <Link className="button" href="/predictions/history">Review settled results</Link>
          </div>
        </div>
        <div>
          <dl className="intelligence-empty-ledger">
            <div><dt>Fixtures</dt><dd>{storedSlateUnavailable ? "Not read" : "0 provider rows"}</dd></div>
            <div><dt>Verified odds</dt><dd>{storedSlateUnavailable ? "Not read" : "0 snapshots"}</dd></div>
            <div><dt>Public decision</dt><dd>Withheld</dd></div>
          </dl>
          <p className="small muted intelligence-empty-next">
            {storedSlateUnavailable
              ? "The next successful stored-receipt read will rebuild this slate. Until then, the weekly radar and results ledger remain available without implying that today’s feed is healthy."
              : "The next provider run will rebuild this slate. Until then, the weekly radar and results ledger remain available without implying that today’s feed is healthy."}
          </p>
        </div>
      </section>
    );
  }
  const { published, abstentions, waitingForEvidence } = partitionDailyTipsSections(product);
  return (
    <>
      {product.sections.valuePicks.length ? <SlateSection id="daily-published" title="Top Value Picks" eyebrow="Positive edge, fully cleared" rows={product.sections.valuePicks} empty="No value pick clears every gate" asOf={product.generatedAt} /> : null}
      {product.sections.leans.length ? <SlateSection id={product.sections.valuePicks.length ? "daily-leans" : "daily-published"} title="Safer Leans" eyebrow="Model preference, not a value claim" rows={product.sections.leans} empty="No safer lean is ready" asOf={product.generatedAt} /> : null}
      <SlateSection id="daily-watchlist" title="Watchlist" eyebrow="Possible value, still blocked" rows={product.sections.watchlist} empty="Nothing is waiting on a price or evidence refresh" asOf={product.generatedAt} />
      {!published.length ? <section className="daily-no-publish" id="daily-published"><span className="badge scheduled">0 published</span><div><h2>No public pick was forced for {product.day}</h2><p>The engine reviewed {product.sections.allAnalysed.length} fixture{product.sections.allAnalysed.length === 1 ? "" : "s"}, but none cleared every value, confidence and risk gate. Watchlist readings remain analysis, not tips.</p></div></section> : null}
      <section className="section intelligence-section" id="daily-abstentions">
        <div className="section-title"><div><span className="section-kicker">Reviewed and withheld</span><h2>Analysed Abstentions</h2></div><span className="badge scheduled">{abstentions.length}</span></div>
        {abstentions.length ? <div className="no-pick-grid">{abstentions.slice(0, DAILY_DECISION_RENDER_LIMIT).map((row) => <NoPickFixtureCard key={row.fixture.fixtureId} row={row} asOf={product.generatedAt} />)}</div> : <div className="empty-state compact"><h3>No additional analysed abstentions</h3><p className="muted">Every completed review currently appears in a published or watchlist section.</p></div>}
        {abstentions.length > DAILY_DECISION_RENDER_LIMIT ? <p className="small muted">Showing {DAILY_DECISION_RENDER_LIMIT} of {abstentions.length} abstentions; the complete count remains in the decision receipt.</p> : null}
      </section>
      <DailyCoverageQueue rows={waitingForEvidence} dayLabel={dayLabel} asOf={product.generatedAt} />
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

const WEEKLY_DECISION_PRIORITY: Record<SlatePublicStatus, number> = {
  value_pick: 0,
  lean: 1,
  watchlist: 2,
  stale: 3,
  ready: 4,
  no_clear_value: 5,
  needs_review: 6,
  preliminary: 7,
  needs_data: 8,
  suspended: 9,
  settled: 10
};

export function partitionWeeklyTipsDay(group: WeeklyTipsDay) {
  const reviewed = group.fixtures
    .filter((row) => row.decisionSummary.allMarketAnalyses.length > 0)
    .sort((left, right) => WEEKLY_DECISION_PRIORITY[left.publicStatus] - WEEKLY_DECISION_PRIORITY[right.publicStatus]);
  const reviewedFixtureIds = new Set(reviewed.map((row) => row.fixture.fixtureId));
  return {
    reviewed,
    waitingForEvidence: group.fixtures.filter((row) => !reviewedFixtureIds.has(row.fixture.fixtureId))
  };
}

export function WeeklyDecisionOverview({ product }: { product: WeeklyTipsProduct }) {
  if (!product.summary.fixturesFound) return null;
  const rows = product.days.flatMap((group) => group.fixtures);
  const reviewed = rows.filter((row) => row.decisionSummary.allMarketAnalyses.length > 0);
  const published = reviewed.filter((row) => row.publicStatus === "value_pick" || row.publicStatus === "lean");
  const watchlist = reviewed.filter((row) => row.publicStatus === "watchlist" || row.publicStatus === "stale");
  const waiting = rows.length - reviewed.length;
  return (
    <section className="daily-decision-overview weekly-decision-overview" aria-labelledby="weekly-decision-overview-title">
      <div className="daily-decision-overview-copy">
        <span className="section-kicker">Seven-day decision board</span>
        <h2 id="weekly-decision-overview-title">
          {reviewed.length} reviewed across {rows.length} fixture{rows.length === 1 ? "" : "s"}.
        </h2>
        <p>{published.length ? `${published.length} public decision${published.length === 1 ? " is" : "s are"} ready.` : "No public pick has been forced."} Reviewed decisions lead each date; {waiting} provider fixture{waiting === 1 ? " remains" : "s remain"} in a separate evidence queue.</p>
      </div>
      <dl className="weekly-decision-metrics">
        <div><dt>Reviewed</dt><dd>{reviewed.length}</dd></div>
        <div><dt>Published</dt><dd>{published.length}</dd></div>
        <div><dt>Watchlist</dt><dd>{watchlist.length}</dd></div>
        <div><dt>Waiting</dt><dd>{waiting}</dd></div>
      </dl>
    </section>
  );
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
      {product.days.map((group) => {
        const { reviewed, waitingForEvidence } = partitionWeeklyTipsDay(group);
        return (
          <section className="section weekly-day" key={group.date}>
            <div className="weekly-date">
              <span className="section-kicker">{weeklyDayLabel(group.date, product.slate.range.from)}</span>
              <time dateTime={group.date}>{new Date(`${group.date}T12:00:00Z`).toLocaleDateString([], { month: "short", day: "numeric" })}</time>
              <span>{group.fixtures.length} fixture{group.fixtures.length === 1 ? "" : "s"}</span>
              <div className="weekly-status-counts">
                <span>{reviewed.length} reviewed</span><span>{waitingForEvidence.length} waiting</span><span>{group.counts.valuePick} value</span><span>{group.counts.watchlist + group.counts.stale} watchlist</span>
              </div>
            </div>
            {group.fixtures.length ? (
              <div className="weekly-day-content">
                {reviewed.length ? (
                  <>
                    <div className="weekly-day-heading"><div><span className="section-kicker">Completed market review</span><h3>Reviewed decisions</h3></div><span className="badge scheduled">{reviewed.length}</span></div>
                    <div className="intelligence-grid">{reviewed.map((row) => <SlateFixtureCard key={`reviewed-${row.fixture.fixtureId}`} row={row} compact asOf={product.generatedAt} />)}</div>
                  </>
                ) : <div className="weekly-review-pending"><strong>No completed market review yet</strong><span>Provider fixtures remain visible below, but they are not presented as predictions.</span></div>}
                {waitingForEvidence.length ? (
                  <details className="weekly-coverage-queue">
                    <summary>Show {waitingForEvidence.length} provider fixture{waitingForEvidence.length === 1 ? "" : "s"} awaiting review</summary>
                    <div className="intelligence-grid">{waitingForEvidence.map((row) => <SlateFixtureCard key={`waiting-${row.fixture.fixtureId}`} row={row} compact asOf={product.generatedAt} />)}</div>
                  </details>
                ) : <div className="weekly-queue-clear"><strong>Evidence queue clear</strong><span>Every listed fixture for this date has a completed market review.</span></div>}
              </div>
            ) : <div className="weekly-empty-day"><strong>No provider fixture listed</strong><span>The day stays visible so the seven-day window is complete.</span></div>}
          </section>
        );
      })}
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
