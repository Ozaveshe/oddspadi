import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentReport, DecisionEnginePanel, ModelDiagnostics } from "@/components/odds/AgentReport";
import { ConfidenceBadge, MatchStatusBadge, RiskBadge, ValueEdgeBadge } from "@/components/odds/Badges";
import { FormGuide } from "@/components/odds/FormGuide";
import { OddsTable } from "@/components/odds/OddsTable";
import { OddsMovementChart } from "@/components/odds/OddsMovementChart";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { PredictionExplanation } from "@/components/odds/PredictionExplanation";
import { LocalTime } from "@/components/odds/LocalTime";
import { ProbabilityDistribution } from "@/components/odds/ProbabilityDistribution";
import { CalibrationReliabilityBand } from "@/components/odds/CalibrationReliabilityBand";
import { DecisionEvidenceProfile } from "@/components/odds/DecisionEvidenceProfile";
import { TeamCrest } from "@/components/odds/TeamCrest";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { AddToSlipButton } from "@/components/odds/AddToSlipButton";
import { formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { getCachedMatchPrediction, getCachedStoredFixtureAnalysis } from "@/lib/sports/prediction/cachedPublicReads";
import { StoredFixtureAnalysisView } from "@/components/odds/StoredFixtureAnalysisView";
import { ShareBar } from "@/components/share/ShareBar";
import { FollowTeamButton } from "@/components/account/FollowTeamButton";
import Link from "next/link";
import { leagueSlugFromProviderId } from "@/lib/sports/leagueStandings";
import { publicWatchlistReason } from "@/lib/sports/prediction/publicDecisionCopy";

export const revalidate = 180;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";

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

function shortDate(value: string) { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" }) : "Previous meeting"; }

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
  const displayDecision = prediction.decision;
  const displayPrediction = prediction;
  const winner = prediction.markets.find((market) => market.marketId === "match_winner");
  const canonical = prediction.canonicalDecision;
  const publishedPick = canonical.bestPublishedPick;
  const displayedDecision = publishedPick ?? canonical.bestLean ?? canonical.bestWatchlistCandidate;
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
          ? "Needs data before publication."
          : canonical.publicStatus === "suspended"
            ? "Suspended — no new pre-match decision."
            : "No clear value found.";
  const publicRisks = [...new Set([...(displayedDecision?.blockers ?? []), ...canonical.auditSummary.blockers])].slice(0, 3);
  const leagueTableSlug = leagueSlugFromProviderId(match.league.id);
  const homeStanding = match.leagueTable?.rows.find((row) => row.teamId === match.homeTeam.id || row.teamName.toLowerCase() === match.homeTeam.name.toLowerCase());
  const awayStanding = match.leagueTable?.rows.find((row) => row.teamId === match.awayTeam.id || row.teamName.toLowerCase() === match.awayTeam.name.toLowerCase());

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
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="page-heading">
        <div className="meta">
          <MatchStatusBadge status={match.status} />
          <span>{match.league.name}</span>
          <span className="country-inline"><CountryFlag country={match.league.country} flag={match.league.flag} size={16} />{match.league.country}</span>
          <LocalTime iso={match.kickoffTime} variant="datetime" />
        </div>
        <h1 className="match-title">
          <span className="team-inline">
            <TeamCrest name={match.homeTeam.name} logo={match.homeTeam.logo} size={34} />
            {match.homeTeam.name}
          </span>
          <span className="accent">vs</span>
          <span className="team-inline">
            <TeamCrest name={match.awayTeam.name} logo={match.awayTeam.logo} size={34} />
            {match.awayTeam.name}
          </span>
        </h1>
        {match.score ? (
          <p>
            <strong>
              Score: {match.score.home}-{match.score.away}
              {match.score.minute ? ` (${match.score.minute}')` : ""}
            </strong>
          </p>
        ) : (
          <p>Here&apos;s everything the engine sees for this match — odds, probabilities, value, and risk.</p>
        )}
      </div>

      <section className={`match-decision-hero status-${canonical.publicStatus}`} aria-labelledby="public-decision-title">
        <div>
          <span className={`badge ${hasValue ? "positive" : canonical.publicStatus === "lean" ? "medium" : canonical.publicStatus === "watchlist" || canonical.publicStatus === "stale" ? "scheduled" : "no-value"}`}>{canonical.publicStatus.replaceAll("_", " ")}</span>
          <h2 id="public-decision-title">{publicDecisionLabel}</h2>
          {displayedDecision ? (
            <>
              <p className="match-decision-selection"><span>{displayedDecision.marketId.replaceAll("_", " ")}</span><strong>{displayedDecision.label}</strong></p>
              <div className="match-decision-primary">
                <div><span>Current odds</span><strong>{displayedDecision.odds.toFixed(2)}</strong></div>
                <div><span>Model chance</span><strong>{formatPercent(displayedDecision.modelProbability)}</strong></div>
                <div><span>Fair market chance</span><strong>{formatPercent(displayedDecision.noVigImpliedProbability)}</strong></div>
                <div className={displayedDecision.edge > 0 ? "positive" : "negative"}><span>Model edge</span><strong>{formatSignedPercent(displayedDecision.edge)}</strong></div>
              </div>
              <div className="match-decision-context">
                <div><span>Confidence</span><ConfidenceBadge level={canonical.confidence} /></div>
                <div><span>Risk</span><RiskBadge level={canonical.risk} /></div>
                <div><span>Decision clock</span><strong>{new Date(canonical.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong></div>
              </div>
            </>
          ) : <p className="muted">{canonical.noPickReason ?? "No clear value found."}</p>}
          <div className="match-risk-list"><strong>Key risks</strong>{publicRisks.length ? <ul>{publicRisks.map((risk) => <li key={risk}>{risk}</li>)}</ul> : <p className="muted small">No extra blocker is attached to the current public decision. Match and price uncertainty still applies.</p>}</div>
        </div>
        <div className="match-decision-actions">
          <AddToSlipButton match={match} prediction={prediction} />
          <Link className="button" href={`/community?match=${encodeURIComponent(match.id)}&prompt=${encodeURIComponent(`My read on ${match.homeTeam.name} vs ${match.awayTeam.name}: `)}`}>Discuss match</Link>
        </div>
      </section>

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

          <div className="panel odds-history-panel">
            <h2>Odds movement and freshness</h2>
            <div className="metrics-grid results-metrics">
              <div className="metric"><span className="metric-label">Decision generated</span><span className="metric-value">{new Date(canonical.generatedAt).toLocaleString()}</span></div>
              <div className="metric"><span className="metric-label">Price expires</span><span className="metric-value">{canonical.expiresAt ? new Date(canonical.expiresAt).toLocaleString() : "Awaiting fresh odds"}</span></div>
            </div>
            <OddsMovementChart history={oddsHistory} market={historyMarket} marketLabel={historyMarketLabel} />
          </div>

          <PredictionExplanation explanation={prediction.explanation} />

          <details className="fold">
            <summary>Advanced engine audit</summary>
            <div className="fold-body">
              <p className="muted small" style={{ margin: 0 }}>
                Audit-only detail cannot override the canonical public decision above. Candidate markets below show
                the engine&apos;s working, including blocked opportunities, but only the canonical status is publishable.
              </p>
              <DecisionEnginePanel decision={displayDecision} />
              <AgentReport report={prediction.agentReport} diagnostics={prediction.diagnostics} />
              <ModelDiagnostics diagnostics={prediction.diagnostics} />
            </div>
          </details>
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
            {leagueTableSlug ? <Link className="inline-link small" href={`/predictions/league/${leagueTableSlug}/table`}>View the full {match.league.name} table →</Link> : null}
          </div>

          <div className="panel">
            <h2>Head-to-head</h2>
            {match.headToHead ? <><p className="h2h-aggregate"><strong>{match.homeTeam.name}: {match.headToHead.homeWins}</strong><span>Draws: {match.headToHead.draws}</span><strong>{match.awayTeam.name}: {match.headToHead.awayWins}</strong></p><div className="h2h-list">{match.headToHead.meetings.map((meeting) => <div className="h2h-row" key={meeting.id}><span>{shortDate(meeting.kickoffTime)}</span><span>{meeting.homeTeam}</span><strong>{meeting.homeScore}–{meeting.awayScore}</strong><span>{meeting.awayTeam}</span></div>)}</div><p className="muted small">Last {match.headToHead.meetings.length} completed meetings from API-Football. H2H is context, not a guarantee.</p></> : <p className="muted">No verified recent meetings were available from the provider for this fixture.</p>}
          </div>

          <div className="panel">
            <h2>Team news</h2>
            {(() => { const news = (match.providerContextSignals ?? []).filter((signal) => ["injury", "suspension", "lineup"].includes(signal.category)); const items = news.flatMap((signal) => (signal.items ?? []).map((item) => ({ ...item, category: signal.category }))); return items.length ? <div className="team-news-list">{items.slice(0, 28).map((item, index) => <div className="team-news-row" key={`${item.team}-${item.player}-${index}`}><span className={`team-news-kind ${item.category}`}>{item.status}</span><div><strong>{item.player || "Squad update"}</strong><span>{item.team}{item.reason ? ` · ${item.reason}` : ""}</span></div></div>)}</div> : news.length ? <><div className="team-news-signals">{news.map((signal) => <p key={signal.id}><strong>{signal.label}</strong><span>{signal.detail}</span></p>)}</div><p className="muted small">The enriched feed returned aggregate availability context but no player-level rows.</p></> : <p className="muted">This fixture has not entered the enriched context window yet, so there is no verified injury, suspension, or lineup report. OddsPadi will not invent team news.</p>; })()}
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
