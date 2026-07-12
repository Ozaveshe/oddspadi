import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AgentReport, DecisionEnginePanel, ModelDiagnostics } from "@/components/odds/AgentReport";
import { ConfidenceBadge, MatchStatusBadge, RiskBadge, ValueEdgeBadge } from "@/components/odds/Badges";
import { FormGuide } from "@/components/odds/FormGuide";
import { OddsTable } from "@/components/odds/OddsTable";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { PredictionExplanation } from "@/components/odds/PredictionExplanation";
import { ProbabilityBar } from "@/components/odds/ProbabilityBar";
import { TeamCrest } from "@/components/odds/TeamCrest";
import { formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { getMatchPrediction } from "@/lib/sports/service";

type PageProps = {
  params: Promise<{ matchId: string }>;
};

function decodeMatchId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { matchId: rawMatchId } = await params;
  const matchId = decodeMatchId(rawMatchId);
  const row = await getMatchPrediction(matchId);
  if (!row) return { title: "Match Prediction" };
  const title = `${row.match.homeTeam.name} vs ${row.match.awayTeam.name} — Prediction & Analysis`;
  const description = `AI prediction for ${row.match.homeTeam.name} vs ${row.match.awayTeam.name} (${row.match.league.name}): probabilities vs odds, value edge, confidence and risk — explained in plain language.`;
  return {
    title,
    description,
    alternates: { canonical: `/predictions/${encodeURIComponent(matchId)}` },
    openGraph: { title: `${title} | OddsPadi`, description }
  };
}

export default async function MatchDetailPage({ params }: PageProps) {
  const { matchId: rawMatchId } = await params;
  const matchId = decodeMatchId(rawMatchId);
  const row = await getMatchPrediction(matchId);
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

  const sportsEventJsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `${match.homeTeam.name} vs ${match.awayTeam.name}`,
    sport: match.sport === "football" ? "Soccer" : match.sport,
    startDate: match.kickoffTime,
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
  };

  return (
    <main id="main" className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(sportsEventJsonLd) }} />

      <div className="page-heading">
        <div className="meta">
          <MatchStatusBadge status={match.status} />
          <span>{match.league.name}</span>
          <span>{match.league.country}</span>
          <span suppressHydrationWarning>
            {new Date(match.kickoffTime).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
          </span>
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
            <OddsTable oddsMarkets={match.oddsMarkets} prediction={displayPrediction} />
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
              <strong>{match.homeTeam.name}</strong>
            </p>
            <FormGuide form={match.homeForm} />
            <p className="small muted">
              Scored {match.homeForm.goalsFor}, conceded {match.homeForm.goalsAgainst} · attack{" "}
              {formatPercent(match.homeForm.attackStrength)}, defence {formatPercent(match.homeForm.defenseStrength)}
            </p>
            <p>
              <strong>{match.awayTeam.name}</strong>
            </p>
            <FormGuide form={match.awayForm} />
            <p className="small muted">
              Scored {match.awayForm.goalsFor}, conceded {match.awayForm.goalsAgainst} · attack{" "}
              {formatPercent(match.awayForm.attackStrength)}, defence {formatPercent(match.awayForm.defenseStrength)}
            </p>
          </div>

          <div className="panel">
            <h2>Head-to-head</h2>
            <p className="muted">Coming soon — past meetings between these two, right here.</p>
          </div>

          <div className="panel">
            <h2>Team news</h2>
            <p className="muted">
              Coming soon — injuries, suspensions, and lineups will feed straight into the prediction.
            </p>
          </div>

          <ValueEdgeBadge edge={bestEdge} />
          <PredictionDisclaimer />
        </aside>
      </section>
    </main>
  );
}
