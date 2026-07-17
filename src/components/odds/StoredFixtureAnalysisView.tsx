import Link from "next/link";
import { LocalTime } from "@/components/odds/LocalTime";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import type { StoredFixtureAnalysisRead } from "@/lib/sports/intelligence/storedFixture";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { TeamCrest } from "@/components/odds/TeamCrest";

export function StoredFixtureAnalysisView({ read }: { read: StoredFixtureAnalysisRead }) {
  if (read.status !== "ready") {
    return (
      <main id="main" className="container">
        <section className="section intelligence-empty-slate">
          <div className="intelligence-empty-copy">
            <span className="section-kicker">Stored analysis temporarily unavailable</span>
            <h1>This fixture exists, but its stored receipt could not be read.</h1>
            <p>{read.reason}</p>
            <div className="intelligence-empty-actions"><Link className="button primary" href="/predictions/today">Today&apos;s tips</Link><Link className="button" href="/predictions/week">Weekly radar</Link></div>
          </div>
        </section>
      </main>
    );
  }

  const { analysis } = read;
  const summary = analysis.summary;
  const candidate = summary?.bestPublishedPick ?? summary?.bestLean ?? summary?.bestWatchlistCandidate ?? null;
  const blockers = summary?.auditSummary.blockers ?? [];
  return (
    <main id="main" className="container" data-analytics-match-id={analysis.fixtureId} data-analytics-sport={analysis.sport} data-analytics-league={analysis.league.name}>
      <div className="page-heading">
        <div className="meta"><span className={`badge ${analysis.stale ? "no-value" : "scheduled"}`}>{analysis.stale ? "Archived receipt" : "Stored receipt"}</span><span>{analysis.league.name}</span><span className="country-inline"><CountryFlag country={analysis.league.country} flag={analysis.league.flag} size={16} />{analysis.league.country}</span><LocalTime iso={analysis.kickoffAt} variant="datetime" /></div>
        <h1 className="match-title">
          <span className="team-inline"><TeamCrest name={analysis.homeTeam.name} logo={analysis.homeTeam.logo} size={34} /><span>{analysis.homeTeam.name}<small className="team-country-line"><CountryFlag country={analysis.homeTeam.country} size={14} />{analysis.homeTeam.country ?? "Country pending"}</small></span></span>
          <span className="accent">vs</span>
          <span className="team-inline"><TeamCrest name={analysis.awayTeam.name} logo={analysis.awayTeam.logo} size={34} /><span>{analysis.awayTeam.name}<small className="team-country-line"><CountryFlag country={analysis.awayTeam.country} size={14} />{analysis.awayTeam.country ?? "Country pending"}</small></span></span>
        </h1>
        <p>This page is resolved from OddsPadi&apos;s stored provider and engine receipt because the upstream provider no longer returns the fixture. No model output is invented or silently rerun.</p>
      </div>

      <section className={`match-decision-hero status-${summary?.publicStatus ?? "needs_data"}`} aria-labelledby="stored-decision-title">
        <div>
          <span className="badge scheduled">{summary?.publicStatus?.replaceAll("_", " ") ?? "No stored decision"}</span>
          <h2 id="stored-decision-title">{candidate ? `${candidate.marketId.replaceAll("_", " ")} — ${candidate.label}` : summary?.noPickReason ?? "No audited model decision was stored for this fixture."}</h2>
          {candidate ? <div className="match-decision-primary"><div><span>Stored odds</span><strong>{formatOdds(candidate.odds)}</strong></div><div><span>Model chance</span><strong>{formatPercent(candidate.modelProbability)}</strong></div><div><span>Fair market chance</span><strong>{formatPercent(candidate.noVigImpliedProbability)}</strong></div><div><span>Model edge</span><strong>{formatSignedPercent(candidate.edge)}</strong></div></div> : null}
          <div className="match-risk-list"><strong>Audit blockers</strong>{blockers.length ? <ul>{blockers.slice(0, 6).map((blocker) => <li key={blocker}>{blocker}</li>)}</ul> : <p className="muted small">No additional blocker was stored.</p>}</div>
        </div>
        <div className="match-decision-actions"><Link className="button primary" href="/predictions/today">Today&apos;s tips</Link><Link className="button" href="/predictions/week">Weekly radar</Link><Link className="button" href="/predictions/history">Results ledger</Link></div>
      </section>

      <section className="grid-2 section">
        <div className="panel"><h2>Receipt integrity</h2><div className="metrics-grid results-metrics"><div className="metric"><span className="metric-label">Provider</span><span className="metric-value">{analysis.provider}</span></div><div className="metric"><span className="metric-label">Fixture status</span><span className="metric-value">{analysis.status}</span></div><div className="metric"><span className="metric-label">Last provider sync</span><span className="metric-value">{new Date(analysis.lastSyncedAt).toLocaleString()}</span></div><div className="metric"><span className="metric-label">Decision generated</span><span className="metric-value">{summary ? new Date(summary.generatedAt).toLocaleString() : "Not stored"}</span></div><div className="metric"><span className="metric-label">Data quality</span><span className="metric-value">{formatPercent(analysis.dataQuality)}</span></div><div className="metric"><span className="metric-label">Verified odds rows</span><span className="metric-value">{analysis.oddsHistory.rowsRead}</span></div></div></div>
        <div className="panel"><h2>Stored market audit</h2>{summary?.allMarketAnalyses.length ? <div className="breakdown-list">{summary.allMarketAnalyses.slice(0, 8).map((market) => <div key={`${market.marketId}-${market.selectionId}`}><span>{market.marketId.replaceAll("_", " ")} · {market.label}</span><strong>{formatOdds(market.odds)} · {formatSignedPercent(market.edge)} <small>{market.analysisStatus.replaceAll("_", " ")}</small></strong></div>)}</div> : <p className="muted">No priced market analysis was stored. The abstention remains visible instead of being reconstructed from current data.</p>}</div>
      </section>
    </main>
  );
}
