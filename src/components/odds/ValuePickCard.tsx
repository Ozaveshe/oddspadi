import Link from "next/link";
import type { MatchSummary, PredictionSummary } from "@/lib/sports/prediction/listRow";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { ConfidenceBadge, RiskBadge } from "./Badges";
import { LocalTime } from "./LocalTime";
import { ShareBar } from "@/components/share/ShareBar";
import { AddToSlipButton } from "./AddToSlipButton";
import { AffiliateBookmakerLink } from "./AffiliateBookmakerLink";
import { bookmakerDisplayName } from "@/lib/affiliate/bookmakerLinks";

export function ValuePickCard({ match, prediction }: { match: MatchSummary; prediction: PredictionSummary }) {
  const bestPick = prediction.canonicalDecision.bestPublishedPick;
  if (prediction.canonicalDecision.publicStatus !== "value_pick" || !bestPick) return null;
  const pricedMarket = match.oddsMarkets.find((market) => market.id === bestPick.marketId);
  const pricedSelection = pricedMarket?.selections.find((selection) => selection.id === bestPick.selectionId);
  const priceBookmaker = bestPick.bookmaker ?? pricedSelection?.bookmaker ?? pricedMarket?.bookmaker;

  return (
    <article className="value-card">
      <div className="row-between">
        <div>
          <strong>
            {match.homeTeam.name} vs {match.awayTeam.name}
          </strong>
          <div className="small muted">
            {match.league.name} · <LocalTime iso={match.kickoffTime} />
          </div>
        </div>
        <Link
          className="button small-btn"
          href={`/predictions/${match.id}`}
          aria-label={`See why: ${match.homeTeam.name} vs ${match.awayTeam.name}`}
          data-analytics-event="value_pick_clicked"
          data-analytics-match-id={match.id}
          data-analytics-sport={match.sport}
          data-analytics-league={match.league.name}
          data-analytics-source="value_pick_card"
        >
          See why
        </Link>
      </div>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Pick</span>
          <span className="metric-value">{bestPick.label}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Odds</span>
          <span className="metric-value">{formatOdds(bestPick.odds)}</span>
          {priceBookmaker ? <span className="small muted">Best at {bookmakerDisplayName(priceBookmaker.id, priceBookmaker.name)}</span> : null}
        </div>
        <div className="metric">
          <span className="metric-label">Model / no-vig</span>
          <span className="metric-value">
            {formatPercent(bestPick.modelProbability)} / {formatPercent(bestPick.noVigImpliedProbability)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">No-vig edge</span>
          <span className="metric-value">{formatSignedPercent(bestPick.edge)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">EV / unit</span>
          <span className="metric-value">{formatSignedPercent(bestPick.expectedValue)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Book margin</span>
          <span className="metric-value">{formatSignedPercent(bestPick.bookmakerMargin)}</span>
        </div>
      </div>
      <div className="meta">
        <ConfidenceBadge level={bestPick.confidence} />
        <RiskBadge level={bestPick.risk} />
      </div>
      <div className="card-actions"><AddToSlipButton match={match} prediction={prediction} /><Link className="button" href="/predictions/bet-slip">Check slip</Link></div>
      {priceBookmaker ? <AffiliateBookmakerLink bookmaker={priceBookmaker} country={match.league.country} matchId={match.id} sport={match.sport} league={match.league.name} placement="value_pick_card" /> : null}
      <ShareBar
        compact
        pageContext="value_pick"
        matchId={match.id}
        sport={match.sport}
        league={match.league.name}
        title={`${match.homeTeam.name} vs ${match.awayTeam.name} analysis`}
        text={`⚽ ${match.homeTeam.name} vs ${match.awayTeam.name} — OddsPadi’s analysis flags ${bestPick.label} at ${Math.round(bestPick.modelProbability * 100)}% model probability. Full analysis:`}
        url={`/predictions/${encodeURIComponent(match.id)}`}
      />
    </article>
  );
}
