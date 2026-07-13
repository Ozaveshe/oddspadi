import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentReport, DecisionEnginePanel, ModelDiagnostics } from "@/components/odds/AgentReport";
import { ConfidenceBadge, MatchStatusBadge, RiskBadge, ValueEdgeBadge } from "@/components/odds/Badges";
import { FormGuide } from "@/components/odds/FormGuide";
import { OddsTable } from "@/components/odds/OddsTable";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { PredictionExplanation } from "@/components/odds/PredictionExplanation";
import { LocalTime } from "@/components/odds/LocalTime";
import { ProbabilityBar } from "@/components/odds/ProbabilityBar";
import { TeamCrest } from "@/components/odds/TeamCrest";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { getCachedMatchPrediction } from "@/lib/sports/prediction/cachedPublicReads";
import { ShareBar } from "@/components/share/ShareBar";
import { FollowTeamButton } from "@/components/account/FollowTeamButton";
import Link from "next/link";
import { leagueSlugFromProviderId } from "@/lib/sports/leagueStandings";

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
  if (!row) return { title: "Match Prediction" };
  const title = `${row.match.homeTeam.name} vs ${row.match.awayTeam.name} — Prediction & Analysis`;
  const description = `AI prediction for ${row.match.homeTeam.name} vs ${row.match.awayTeam.name} (${row.match.league.name}): probabilities vs odds, value edge, confidence and risk — explained in plain language.`;
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
  if (!row) notFound();

  const { match, prediction } = row;
  const displayDecision = prediction.decision;
  const displayPrediction = prediction;
  const winner = prediction.markets.find((market) => market.marketId === "match_winner");
  const hasValue = prediction.bestPick.hasValue;
  const bestEdge = hasValue ? prediction.bestPick.edge : 0;
  const hasWinnerOdds = match.oddsMarkets.some((m) => m.id === "match_winner" && m.selections.length > 0);
  const leanEntries: Array<[string, number]> = [
    [match.homeTeam.name, winner?.probabilities.home ?? 0],
    ...(match.sport === "football" ? ([["Draw", winner?.probabilities.draw ?? 0]] as Array<[string, number]>) : []),
    [match.awayTeam.name, winner?.probabilities.away ?? 0]
  ];
  const [leanLabel, leanProb] = leanEntries.reduce((best, current) => (current[1] > best[1] ? current : best));
  const winnerTitle = "Who wins? The model's view";
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

      <div className="feed-actions" style={{ marginTop: 0 }}>
        <FollowTeamButton teamName={match.homeTeam.name} sport={match.sport} />
        <FollowTeamButton teamName={match.awayTeam.name} sport={match.sport} />
      </div>
      <ShareBar
        pageContext="match_prediction"
        matchId={match.id}
        sport={match.sport}
        league={match.league.name}
        title={`${match.homeTeam.name} vs ${match.awayTeam.name} analysis`}
        text={`⚽ ${match.homeTeam.name} vs ${match.awayTeam.name} — OddsPadi’s analysis leans ${hasValue ? prediction.bestPick.label : leanLabel} (${Math.round((hasValue ? prediction.bestPick.modelProbability : leanProb) * 100)}%). Full analysis:`}
        url={`/predictions/${encodeURIComponent(match.id)}`}
      />
      <Link className="discuss-match-cta" href={`/community?match=${encodeURIComponent(match.id)}&prompt=${encodeURIComponent(`My read on ${match.homeTeam.name} vs ${match.awayTeam.name}: `)}`}>💬 Discuss this match</Link>

      <section className="detail-grid">
        <div className="match-list">
          <div className="panel">
            <h2>The short version</h2>
            <div className="metrics-grid" style={{ marginTop: 12 }}>
              <div className="metric">
                <span className="metric-label">Best pick</span>
                <span className="metric-value">{hasValue ? prediction.bestPick.label : "No value bet"}</span>
              </div>
              <div className="metric">
                <span className="metric-label">Model lean</span>
                <span className="metric-value">
                  {leanLabel} · {formatPercent(leanProb)}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">Value edge</span>
                <span className="metric-value">
                  {hasValue ? formatSignedPercent(prediction.bestPick.edge) : hasWinnerOdds ? "None found" : "Needs odds"}
                </span>
              </div>
              <div className="metric">
                <span className="metric-label">Expected value</span>
                <span className="metric-value">
                  {hasValue ? formatSignedPercent(prediction.bestPick.expectedValue) : hasWinnerOdds ? "Not positive" : "Needs odds"}
                </span>
              </div>
              {hasValue ? (
                <>
                  <div className="metric">
                    <span className="metric-label">Confidence</span>
                    <span className="metric-value">
                      <ConfidenceBadge level={prediction.confidence} />
                    </span>
                  </div>
                  <div className="metric">
                    <span className="metric-label">Risk</span>
                    <span className="metric-value">
                      <RiskBadge level={prediction.risk} />
                    </span>
                  </div>
                </>
              ) : (
                <div className="metric">
                  <span className="metric-label">Value check</span>
                  <span className="metric-value" style={{ fontSize: 13, fontWeight: 600 }}>
                    {hasWinnerOdds ? "No edge at current odds" : "Odds pending"}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <h2>{winnerTitle}</h2>
            <div className="grid-2" style={{ marginTop: 12 }}>
              <ProbabilityBar label={match.homeTeam.name} value={winner?.probabilities.home ?? 0} />
              {match.sport === "football" ? <ProbabilityBar label="Draw" value={winner?.probabilities.draw ?? 0} /> : null}
              <ProbabilityBar label={match.awayTeam.name} value={winner?.probabilities.away ?? 0} />
              <ProbabilityBar label="Data quality" value={match.dataQualityScore} />
            </div>
          </div>

          <div className="panel">
            <h2>Odds vs our numbers</h2>
            <p className="muted small">
              &ldquo;Value edge&rdquo; is our probability minus the bookmaker&apos;s fair probability (margin removed).
              Positive edge means the price is better than it should be. Current best edge:{" "}
              {prediction.bestPick.hasValue ? formatSignedPercent(bestEdge) : "none found"}.
            </p>
            <OddsTable match={match} prediction={displayPrediction} />
          </div>

          <PredictionExplanation explanation={prediction.explanation} />

          <details className="fold">
            <summary>🔬 Deep dive — full AI decision breakdown</summary>
            <div className="fold-body">
              <p className="muted small" style={{ margin: 0 }}>
                This is the engine&apos;s complete working: every check, every doubt, every guardrail. Perfect if you
                like to see the maths behind the call.
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

          <ValueEdgeBadge edge={bestEdge} />
          <PredictionDisclaimer />
        </aside>
      </section>
    </main>
  );
}
