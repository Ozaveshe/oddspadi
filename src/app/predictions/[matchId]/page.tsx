import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ConfidenceBadge, MatchStatusBadge, RiskBadge, ValueEdgeBadge } from "@/components/odds/Badges";
import { FormGuide } from "@/components/odds/FormGuide";
import { OddsTable } from "@/components/odds/OddsTable";
import { ModelMarketBoard } from "@/components/odds/ModelMarketBoard";
import { OddsMovementChart } from "@/components/odds/OddsMovementChart";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { PredictionExplanation } from "@/components/odds/PredictionExplanation";
import { LocalTime } from "@/components/odds/LocalTime";
import { ProbabilityDistribution } from "@/components/odds/ProbabilityDistribution";
import { CalibrationReliabilityBand } from "@/components/odds/CalibrationReliabilityBand";
import { DecisionEvidenceProfile } from "@/components/odds/DecisionEvidenceProfile";
import { DecisionPriceSignal } from "@/components/odds/DecisionPriceSignal";
import { TeamCrest } from "@/components/odds/TeamCrest";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { AddToSlipButton } from "@/components/odds/AddToSlipButton";
import { formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { getCachedMatchPrediction, getCachedStoredFixtureAnalysis } from "@/lib/sports/prediction/cachedPublicReads";
import { StoredFixtureAnalysisView } from "@/components/odds/StoredFixtureAnalysisView";
import { ShareBar } from "@/components/share/ShareBar";
import { FollowTeamButton } from "@/components/account/FollowTeamButton";
import { serializeJsonLd } from "@/lib/security/jsonLd";
import Link from "next/link";
import { buildEngineViewRows, presentBlockers } from "@/lib/sports/prediction/blockerPresentation";
import { leagueSlugFromProviderId } from "@/lib/sports/leagueStandings";
import { publicWatchlistReason } from "@/lib/sports/prediction/publicDecisionCopy";
import { DECISION_STATUS_DESCRIPTIONS, decisionStatusLabel } from "@/lib/product/vocabulary";
import { buildMatchIntelligence, matchDataAvailability } from "@/lib/match/matchIntelligence";
import { toMatchIntelligenceInput } from "@/lib/match/matchIntelligenceAdapter";
import { readPublicationForFixture } from "@/lib/match/publicationForFixture";
import {
  DecisionSection,
  EvidenceSection,
  FactorsSection,
  MatchHeader,
  MethodologySection,
  ModelSection,
  OddsSection,
  TimelineSection
} from "@/components/match/MatchIntelligenceSections";
import { SaveFixtureButton } from "@/components/product/SaveFixtureButton";
import { RecentFixtureRecorder } from "@/components/product/RecentFixtureRecorder";
import { footballLeagueById } from "@/lib/sports/footballLeagues";
import { MatchCommunityDesk } from "@/components/community/MatchCommunityDesk";
import { marketPriorReceiptFor } from "@/lib/sports/prediction/marketPriorPresentation";

export const revalidate = 180;

// Shared so a trailing slash in NEXT_PUBLIC_SITE_URL cannot produce `//path`,
// and so one definition governs every canonical the site emits.
import { siteUrl } from "@/lib/seo/pageMetadata";

type PageProps = {
  params: Promise<{ matchId: string }>;
};

// Empty at build time: each provider-backed match is generated on first visit
// and then kept by ISR for the route's 180-second revalidation window.
export function generateStaticParams() {
  return [];
}

function decodeMatchId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Head-to-head dates are calendar days, not instants: pin the zone so the label
// does not slide a day across hosts, and the locale so hydration stays stable.
const SHORT_DATE_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
function shortDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? SHORT_DATE_FORMAT.format(date) : "Previous meeting"; }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { matchId: rawMatchId } = await params;
  const matchId = decodeMatchId(rawMatchId);
  const row = await getCachedMatchPrediction(matchId);
  if (!row) {
    const stored = await getCachedStoredFixtureAnalysis(matchId);
    if (stored.status !== "ready") return { title: "Match Prediction" };
    const title = `${stored.analysis.homeTeam.name} vs ${stored.analysis.awayTeam.name} — Stored Analysis`;
    const url = `/predictions/${encodeURIComponent(matchId)}`;
    return { title, alternates: { canonical: url }, openGraph: { type: "article", url: `${siteUrl}${url}`, title: `${title} | OddsPadi` } };
  }
  const title = `${row.match.homeTeam.name} vs ${row.match.awayTeam.name} — Prediction & Analysis`;
  const description = `Model-led analysis for ${row.match.homeTeam.name} vs ${row.match.awayTeam.name} (${row.match.league.name}): probabilities vs odds, value edge, confidence and risk, with traceable evidence.`;
  const url = `/predictions/${encodeURIComponent(matchId)}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "article", url: `${siteUrl}${url}`, title: `${title} | OddsPadi`, description },
    twitter: { card: "summary_large_image", title: `${title} | OddsPadi`, description }
  };
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { matchId: rawMatchId } = await params;
  const matchId = decodeMatchId(rawMatchId);
  const row = await getCachedMatchPrediction(matchId);
  if (!row) {
    const stored = await getCachedStoredFixtureAnalysis(matchId);
    if (stored.status === "missing") notFound();
    return <StoredFixtureAnalysisView read={stored} />;
  }

  const { match, prediction, oddsHistory } = row;
  // One resolution of the fixture for the whole page. Every section below
  // renders a slice of this, so none of them can disagree about the score,
  // the odds state, the model basis or the decision.
  const publication = (await readPublicationForFixture(match.id).catch(() => null)) ?? null;
  const intelligence = buildMatchIntelligence(toMatchIntelligenceInput({ match, prediction, publication }));
  const displayDecision = prediction.decision;
  const displayPrediction = prediction;
  const winner = prediction.markets.find((market) => market.marketId === "match_winner");
  const canonical = prediction.canonicalDecision;
  const publishedPick = canonical.bestPublishedPick;
  const displayedDecision = publishedPick ?? canonical.bestLean ?? canonical.bestDisplayCandidate;
  const hasValue = canonical.publicStatus === "value_pick" && publishedPick !== null;
  const bestEdge = displayedDecision?.edge ?? 0;
  const historyMarket = displayedDecision?.marketId ?? "match_winner";
  const historyMarketLabel = historyMarket.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const publicDecisionLabel = hasValue
    ? `Value Pick — ${publishedPick.label}`
    : canonical.publicStatus === "lean" && displayedDecision
      ? `Lean — ${displayedDecision.label}`
      : canonical.publicStatus === "watchlist" || canonical.publicStatus === "stale"
        ? publicWatchlistReason(canonical)
        : canonical.publicStatus === "needs_data"
          ? DECISION_STATUS_DESCRIPTIONS.needs_data
          : canonical.publicStatus === "suspended"
            ? DECISION_STATUS_DESCRIPTIONS.suspended
            : DECISION_STATUS_DESCRIPTIONS.no_clear_value;
  // Engine blockers are internal vocabulary and often restate one another;
  // present them as distinct, readable reasons.
  // A fixture with no publishable decision still has a model read and live
  // prices. The page promises "everything the engine sees", so withholding
  // those because nothing cleared the publication bar left it near-empty.
  const engineView = displayedDecision
    ? []
    : buildEngineViewRows({
        selections: match.oddsMarkets.find((market) => market.id === (winner?.marketId ?? "match_winner"))?.selections ?? [],
        probabilities: winner?.probabilities ?? {}
      });

  const publicRisks = presentBlockers([...(displayedDecision?.blockers ?? []), ...canonical.auditSummary.blockers]);
  const leagueTableSlug = leagueSlugFromProviderId(match.league.id);
  const homeStanding = match.leagueTable?.rows.find((row) => row.teamId === match.homeTeam.id || row.teamName.toLowerCase() === match.homeTeam.name.toLowerCase());
  const awayStanding = match.leagueTable?.rows.find((row) => row.teamId === match.awayTeam.id || row.teamName.toLowerCase() === match.awayTeam.name.toLowerCase());
  const communitySport = match.sport === "football" || match.sport === "basketball" || match.sport === "tennis" ? match.sport : null;
  const communityMarkets = match.oddsMarkets
    .filter((market) => market.selections.some((selection) => Number.isFinite(selection.decimalOdds) && selection.decimalOdds > 1))
    .map((market) => ({
      id: market.id,
      name: market.name,
      selections: market.selections
        .filter((selection) => Number.isFinite(selection.decimalOdds) && selection.decimalOdds > 1)
        .map((selection) => ({ id: selection.id, label: selection.label, decimalOdds: selection.decimalOdds }))
    }));

  const matchUrl = `${siteUrl}/predictions/${encodeURIComponent(matchId)}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SportsEvent",
      name: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
      url: matchUrl,
      description: `${match.league.name} fixture — OddsPadi prediction, probabilities vs odds, value edge, confidence and risk.`,
      sport: match.sport === "football" ? "Soccer" : match.sport,
      startDate: match.kickoffTime,
      eventStatus: "https://schema.org/EventScheduled",
      homeTeam: { "@type": "SportsTeam", name: match.homeTeam.name },
      awayTeam: { "@type": "SportsTeam", name: match.awayTeam.name },
      location: match.venue?.name
        ? {
            "@type": "Place",
            name: match.venue.name,
            address: [match.venue.city, match.venue.country].filter(Boolean).join(", ") || undefined
          }
        : undefined,
      organizer: { "@type": "SportsOrganization", name: match.league.name }
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "Predictions", item: `${siteUrl}/predictions` },
        { "@type": "ListItem", position: 3, name: `${match.homeTeam.name} vs ${match.awayTeam.name}`, item: matchUrl }
      ]
    }
  ];

  return (
    <main id="main" className="container" data-analytics-match-id={match.id} data-analytics-sport={match.sport} data-analytics-league={match.league.name}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />

      <RecentFixtureRecorder
        fixture={{
          matchId: match.id,
          matchLabel: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
          league: match.league.name,
          sport: match.sport,
          kickoffTime: match.kickoffTime
        }}
      />
      <MatchHeader view={intelligence} fixtureId={match.id} availability={matchDataAvailability(intelligence)} />

      <div className="match-hero-actions">
        {footballLeagueById(match.league.id) ? (
          <Link className="text-link" href={`/predictions/league/${encodeURIComponent(footballLeagueById(match.league.id)!.slug)}/table`}>
            {match.league.name} table
          </Link>
        ) : null}
        <SaveFixtureButton
          fixture={{
            matchId: match.id,
            matchLabel: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
            league: match.league.name,
            sport: match.sport,
            kickoffTime: match.kickoffTime
          }}
        />
      </div>

      <OddsSection view={intelligence} />
      <ModelSection view={intelligence} />
      <DecisionSection view={intelligence} />
      <FactorsSection view={intelligence} />
      <EvidenceSection view={intelligence} />
      <TimelineSection view={intelligence} />

      <section className={`match-decision-hero status-${canonical.publicStatus}`} aria-labelledby="public-decision-title">
        <div>
          <span className={`badge ${hasValue ? "positive" : canonical.publicStatus === "lean" ? "medium" : canonical.publicStatus === "watchlist" || canonical.publicStatus === "stale" ? "scheduled" : "no-value"}`}>{decisionStatusLabel(canonical.publicStatus)}</span>
          <h2 id="public-decision-title">{publicDecisionLabel}</h2>
          {displayedDecision ? (
            <>
              <p className="match-decision-selection"><span>{displayedDecision.marketId.replaceAll("_", " ")}</span><strong>{displayedDecision.label}</strong></p>
              <DecisionPriceSignal
                modelProbability={displayedDecision.modelProbability}
                marketProbability={displayedDecision.noVigImpliedProbability}
                currentOdds={displayedDecision.odds}
                edge={displayedDecision.edge}
                expectedValue={displayedDecision.expectedValue}
                marketPriorReceipt={marketPriorReceiptFor(prediction.marketPriorAdjustment, displayedDecision.marketId)}
                executionPriceReceipt={displayedDecision}
                publicationGateReceipt={displayedDecision}
                economicConfidenceReceipt={displayedDecision.economicConfidence}
              />
              <div className="match-decision-context">
                <div><span>Confidence</span><ConfidenceBadge level={canonical.confidence} /></div>
                <div><span>Risk</span><RiskBadge level={canonical.risk} /></div>
                <div><span>Decision clock</span><strong><LocalTime iso={canonical.generatedAt} /></strong></div>
              </div>
            </>
          ) : (
            <>
              <p className="muted">{canonical.noPickReason ?? "No clear value found."}</p>
              {engineView.length ? (
                <div className="match-engine-view">
                  <strong>What the model sees</strong>
                  <p className="muted small">The engine passed on every market here, so these numbers are the model&apos;s read, not a recommendation.</p>
                  <table>
                    <thead><tr><th>Selection</th><th>Model</th><th>Market</th><th>Best price</th></tr></thead>
                    <tbody>
                      {engineView.map((row) => (
                        <tr key={row.id}>
                          <td>{row.label}</td>
                          <td>{row.modelProbability === null ? "—" : `${Math.round(row.modelProbability * 100)}%`}</td>
                          <td>{row.impliedProbability === null ? "—" : `${Math.round(row.impliedProbability * 100)}%`}</td>
                          <td>{row.odds > 1 ? row.odds.toFixed(2) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          )}
          <div className="match-risk-list"><strong>Key risks</strong>{publicRisks.length ? <ul>{publicRisks.map((risk) => <li key={risk.topic}>{risk.text}</li>)}</ul> : <p className="muted small">No extra blocker is attached to the current public decision. Match and price uncertainty still applies.</p>}</div>
        </div>
        <div className="match-decision-actions">
          <AddToSlipButton match={match} prediction={prediction} />
          <Link className="button" href={`/community?match=${encodeURIComponent(match.id)}&prompt=${encodeURIComponent(`My read on ${match.homeTeam.name} vs ${match.awayTeam.name}: `)}`}>Discuss match</Link>
        </div>
      </section>

      {communitySport ? (
        <MatchCommunityDesk
          fixtureId={match.id}
          sport={communitySport}
          homeTeam={match.homeTeam.name}
          awayTeam={match.awayTeam.name}
          kickoffAt={match.kickoffTime}
          markets={communityMarkets}
          modelProbabilities={winner ? {
            home: winner.probabilities.home,
            ...(match.sport === "football" ? { draw: winner.probabilities.draw ?? 0 } : {}),
            away: winner.probabilities.away
          } : undefined}
        />
      ) : null}

      <div className="match-detail-actions">
        <FollowTeamButton teamName={match.homeTeam.name} sport={match.sport} />
        <FollowTeamButton teamName={match.awayTeam.name} sport={match.sport} />
      </div>
      <ShareBar pageContext="match_prediction" matchId={match.id} sport={match.sport} league={match.league.name} title={`${match.homeTeam.name} vs ${match.awayTeam.name} analysis`} text={`${match.homeTeam.name} vs ${match.awayTeam.name} — OddsPadi: ${publicDecisionLabel}${displayedDecision ? ` (${Math.round(displayedDecision.modelProbability * 100)}% model chance)` : ""}. Full analysis:`} url={`/predictions/${encodeURIComponent(match.id)}`} />

      <section className="detail-grid">
        <div className="match-list">
          <div className="panel probability-panel">
            <h2>Probability comparison</h2>
            <p className="muted small">The full bar is 100% of the model&apos;s 1X2 distribution. Evidence quality is shown separately so confidence is not confused with probability.</p>
            <ProbabilityDistribution
              selections={[
                { id: "home", label: match.homeTeam.name, value: winner?.probabilities.home ?? 0 },
                ...(match.sport === "football" ? [{ id: "draw" as const, label: "Draw", value: winner?.probabilities.draw ?? 0 }] : []),
                { id: "away", label: match.awayTeam.name, value: winner?.probabilities.away ?? 0 }
              ]}
              dataQuality={match.dataQualityScore}
            />
            <CalibrationReliabilityBand
              interval={displayDecision.beliefState.confidenceInterval}
              modelProbability={displayedDecision?.modelProbability ?? null}
              marketProbability={displayedDecision?.noVigImpliedProbability ?? null}
              selectionLabel={displayedDecision?.label ?? null}
            />
          </div>

          <DecisionEvidenceProfile decision={displayDecision} publicCandidate={displayedDecision} />

          <div className="panel">
            <h2>Market analysis</h2>
            <p className="muted small">
              &ldquo;Value edge&rdquo; is our probability minus the bookmaker&apos;s fair probability (margin removed).
              Positive edge means the price is better than it should be. Current best edge:{" "}
              {displayedDecision ? formatSignedPercent(bestEdge) : "none found"}.
            </p>
            <OddsTable match={match} prediction={displayPrediction} />
          </div>

          <ModelMarketBoard match={match} prediction={displayPrediction} />

          <div className="panel odds-history-panel">
            <h2>Odds movement and freshness</h2>
            <div className="metrics-grid results-metrics">
              <div className="metric"><span className="metric-label">Decision generated</span><span className="metric-value"><LocalTime iso={canonical.generatedAt} variant="datetime" /></span></div>
              <div className="metric"><span className="metric-label">Price expires</span><span className="metric-value">{canonical.expiresAt ? <LocalTime iso={canonical.expiresAt} variant="datetime" /> : "Awaiting fresh odds"}</span></div>
            </div>
            <OddsMovementChart history={oddsHistory} market={historyMarket} marketLabel={historyMarketLabel} />
          </div>

          <PredictionExplanation explanation={prediction.explanation} />

          {/*
            An engine-audit fold used to render the full agent report here:
            deliberation, committee review, self-critique passes, reasoning
            graphs and tool execution — 1,500 lines of operational machinery
            presented as consumer transparency. Real transparency is
            what the model concluded, from what evidence, at what time, and
            whether it was published; that now lives in the sections above and
            in the collapsed methodology block below. The audit views remain
            available to operators through the engine surfaces.
          */}
          <MethodologySection view={intelligence} />
        </div>

        <aside className="match-list">
          <div className="panel">
            <h2>Recent form</h2>
            <p>
              <strong>{match.homeTeam.name}</strong>{homeStanding ? <span className="form-table-position"> · {homeStanding.position}{homeStanding.position === 1 ? "st" : homeStanding.position === 2 ? "nd" : homeStanding.position === 3 ? "rd" : "th"} · {homeStanding.points} pts</span> : null}
            </p>
            <FormGuide form={match.homeForm} />
            <p className="small muted">
              Scored {match.homeForm.goalsFor}, conceded {match.homeForm.goalsAgainst} · attack{" "}
              {formatPercent(match.homeForm.attackStrength)}, defence {formatPercent(match.homeForm.defenseStrength)}
            </p>
            <p>
              <strong>{match.awayTeam.name}</strong>{awayStanding ? <span className="form-table-position"> · {awayStanding.position}{awayStanding.position === 1 ? "st" : awayStanding.position === 2 ? "nd" : awayStanding.position === 3 ? "rd" : "th"} · {awayStanding.points} pts</span> : null}
            </p>
            <FormGuide form={match.awayForm} />
            <p className="small muted">
              Scored {match.awayForm.goalsFor}, conceded {match.awayForm.goalsAgainst} · attack{" "}
              {formatPercent(match.awayForm.attackStrength)}, defence {formatPercent(match.awayForm.defenseStrength)}
            </p>
            {leagueTableSlug ? <Link className="inline-link small" href={`/predictions/league/${encodeURIComponent(leagueTableSlug)}/table`}>View the full {match.league.name} table →</Link> : null}
          </div>

          <div className="panel">
            <h2>Head-to-head</h2>
            {match.headToHead ? <><p className="h2h-aggregate"><strong>{match.homeTeam.name}: {match.headToHead.homeWins}</strong><span>Draws: {match.headToHead.draws}</span><strong>{match.awayTeam.name}: {match.headToHead.awayWins}</strong></p><div className="h2h-list">{match.headToHead.meetings.map((meeting) => <div className="h2h-row" key={meeting.id}><span>{shortDate(meeting.kickoffTime)}</span><span>{meeting.homeTeam}</span><strong>{meeting.homeScore}–{meeting.awayScore}</strong><span>{meeting.awayTeam}</span></div>)}</div><p className="muted small">Last {match.headToHead.meetings.length} completed meetings from API-Football. H2H is context, not a guarantee.</p></> : <p className="muted">No verified recent meetings were available from the provider for this fixture.</p>}
          </div>

          {match.sport === "football" ? <div className="panel">
            <h2>Confirmed lineups</h2>
            {(() => {
              // Team sheets are a real-world timing constraint, not a data gap:
              // confirmed XIs only exist ~1 hour before kickoff. The provider
              // sweep polls for them automatically from 6 hours out, so the
              // panel's job is to show them the moment they land — and to say
              // when to expect them the rest of the time.
              const starters = (match.providerContextSignals ?? [])
                .filter((signal) => signal.category === "lineup")
                .flatMap((signal) => signal.items ?? [])
                .filter((item) => item.player && item.status.toLowerCase().includes("starter"));
              if (starters.length) {
                const columns = [match.homeTeam.name, match.awayTeam.name].map((team) => ({
                  team,
                  xi: starters.filter((item) => item.team === team)
                }));
                const matchedAny = columns.some((column) => column.xi.length > 0);
                return <>
                  <div className="lineup-columns">
                    {(matchedAny ? columns : [{ team: "Confirmed starters", xi: starters }]).map((column) => (
                      <div className="lineup-column" key={column.team}>
                        <h3>{column.team}</h3>
                        {column.xi.length ? <ol>{column.xi.slice(0, 11).map((item, index) => <li key={`${item.player}-${index}`}><strong>{item.player}</strong>{item.reason ? <span>{item.reason}</span> : null}</li>)}</ol> : <p className="muted small">This side&apos;s XI has not been confirmed yet.</p>}
                      </div>
                    ))}
                  </div>
                  <p className="muted small">Straight from the official team sheets. The engine consumed these inside its bounded lineup signal before market comparison.</p>
                </>;
              }
              const untilKickoffMs = Date.parse(match.kickoffTime) - Date.now();
              return <p className="muted">
                {Number.isFinite(untilKickoffMs) && untilKickoffMs > 6 * 60 * 60 * 1000
                  ? "Team sheets do not exist yet — clubs publish them roughly an hour before kickoff. OddsPadi starts checking automatically six hours out, so the confirmed XI appears here the moment it is released."
                  : "The lineup window is open and OddsPadi is checking the provider automatically. If nothing appears, the clubs have not released their team sheets yet."}
              </p>;
            })()}
          </div> : null}

          <div className="panel">
            <h2>Team news</h2>
            {(() => { const news = (match.providerContextSignals ?? []).filter((signal) => ["injury", "suspension"].includes(signal.category)); const items = news.flatMap((signal) => (signal.items ?? []).map((item) => ({ ...item, category: signal.category }))); return items.length ? <div className="team-news-list">{items.slice(0, 28).map((item, index) => <div className="team-news-row" key={`${item.team}-${item.player}-${index}`}><span className={`team-news-kind ${item.category}`}>{item.status}</span><div><strong>{item.player || "Squad update"}</strong><span>{item.team}{item.reason ? ` · ${item.reason}` : ""}</span></div></div>)}</div> : news.length ? <><div className="team-news-signals">{news.map((signal) => <p key={signal.id}><strong>{signal.label}</strong><span>{signal.detail}</span></p>)}</div><p className="muted small">The enriched feed returned aggregate availability context but no player-level rows.</p></> : <p className="muted">This fixture has not entered the enriched context window yet, so there is no verified injury or suspension report. OddsPadi will not invent team news.</p>; })()}
          </div>

          <div className="panel">
            <h2>Player form evidence</h2>
            {(() => {
              const signals = (match.providerContextSignals ?? []).filter((signal) => signal.category === "player-form");
              const items = signals.flatMap((signal) => signal.items ?? []);
              if (!signals.length) return <p className="muted">No leakage-safe player-form sample is available for this fixture. The engine assigns no player-form weight.</p>;
              return <>
                {signals.map((signal) => <div className="player-form-summary" key={signal.id}><div><strong>{signal.label}</strong><span className={`badge ${signal.quality === "strong" ? "positive" : signal.quality === "acceptable" ? "medium" : "scheduled"}`}>{signal.quality}</span></div><p>{signal.detail}</p><small>Applied weight: {(signal.weight * 100).toFixed(2)}% · Source: {signal.source}</small></div>)}
                {items.length ? <div className="player-form-list">{items.slice(0, 6).map((item, index) => <div key={`${item.team}-${item.player}-${index}`}><span>{item.team}</span><strong>{item.player ?? "Squad"}</strong><small>{item.reason ?? item.status}</small></div>)}</div> : null}
                <p className="muted small">Only completed matches with kickoffs earlier than this fixture are included. Same-match and future rows are excluded.</p>
              </>;
            })()}
          </div>

          <ValueEdgeBadge edge={bestEdge} />
          <PredictionDisclaimer />
        </aside>
      </section>
    </main>
  );
}
