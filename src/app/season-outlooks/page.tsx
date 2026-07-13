import type { Metadata } from "next";
import Link from "next/link";
import { TeamCrest } from "@/components/odds/TeamCrest";
import { buildPremierLeague2026Projection, premierLeague2026Baseline, seasonCoverageQueue } from "@/lib/sports/prediction/seasonOutlooks";

export const revalidate = 21_600;

export const metadata: Metadata = {
  title: "2026/27 season predictions and outlooks",
  description: "Revision-dated football, basketball and tennis season outlooks with transparent probabilities, source dates and missing-input warnings.",
  alternates: { canonical: "/season-outlooks" }
};

const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

export default function SeasonOutlooksPage() {
  const projection = buildPremierLeague2026Projection();
  const datasetJsonLd = {
    "@context": "https://schema.org", "@type": "Dataset",
    name: `OddsPadi ${premierLeague2026Baseline.competition} ${premierLeague2026Baseline.targetSeason} returning-team outlook`,
    dateModified: premierLeague2026Baseline.publishedAt,
    description: premierLeague2026Baseline.caveat,
    creator: { "@type": "Organization", name: "OddsPadi" }
  };
  return <main id="main" className="container season-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }} />
    <header className="page-heading season-hero">
      <span className="section-kicker">Revision 01 · published {premierLeague2026Baseline.publishedAt}</span>
      <h1>Upcoming seasons, <span className="accent">without fake certainty.</span></h1>
      <p>Early forecasts should move when squads and schedules move. Every OddsPadi outlook names its evidence date, missing inputs and next revision trigger.</p>
    </header>

    <section className="season-feature">
      <div className="season-feature-copy">
        <div className="story-meta"><span>⚽ Football</span><span>🏴 England</span><span>{premierLeague2026Baseline.targetSeason}</span></div>
        <h2>{premierLeague2026Baseline.competition} returning-team baseline</h2>
        <p>{premierLeague2026Baseline.caveat}</p>
        <dl className="proof-list">
          <div><dt>Evidence as of</dt><dd>{premierLeague2026Baseline.sourceAsOf.slice(0, 10)}</dd></div>
          <div><dt>Model</dt><dd>{premierLeague2026Baseline.model}</dd></div>
          <div><dt>Simulations</dt><dd>{premierLeague2026Baseline.simulations.toLocaleString()}</dd></div>
          <div><dt>Source</dt><dd>{premierLeague2026Baseline.source}</dd></div>
          <div><dt>Season starts</dt><dd>{premierLeague2026Baseline.seasonStarts}</dd></div>
          <div><dt>Confirmed promoted</dt><dd>{premierLeague2026Baseline.confirmedPromoted.join(", ")}</dd></div>
        </dl>
        <div className="season-sources"><strong>Official checks</strong>{premierLeague2026Baseline.officialSources.map(source => <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>{source.label} · checked {source.checkedAt} ↗</a>)}</div>
      </div>
      <div className="season-podium" aria-label="Leading title probabilities">
        {projection.slice(0, 3).map((team, index) => <article key={team.name}>
          <span className="podium-rank">0{index + 1}</span><TeamCrest name={team.name} size={38} />
          <h3>{team.name}</h3><strong>{percent.format(team.titleProbability)}</strong><span>title baseline</span>
        </article>)}
      </div>
    </section>

    <section className="section">
      <div className="section-title"><div><span className="section-kicker">Full returning-team field</span><h2>Probability bands</h2></div><span className="muted small">Not a betting market · not final squads</span></div>
      <div className="table-wrap season-table-wrap"><table className="data-table season-table"><thead><tr><th>Baseline rank</th><th>Club</th><th>2025 finish</th><th>Title</th><th>Top four</th><th>Median rank</th></tr></thead>
        <tbody>{projection.map((team, index) => <tr key={team.name}><td>{index + 1}</td><td><span className="team-inline"><TeamCrest name={team.name} size={24}/>{team.name}</span></td><td>{team.position}</td><td><strong>{percent.format(team.titleProbability)}</strong></td><td>{percent.format(team.topFourProbability)}</td><td>{team.medianPosition}</td></tr>)}</tbody>
      </table></div>
      <div className="notice season-method"><strong>How to read this:</strong> the simulation carries forward 2025 points-per-game and goal-difference strength, then applies season-level volatility. Coventry City, Ipswich Town and Hull City are officially promoted but stay outside this first probability table until calibrated Championship strength is added. Transfers, injuries, managers and opening prices are also pending.</div>
    </section>

    <section className="section">
      <div className="section-title"><div><span className="section-kicker">Coverage queue</span><h2>What updates next</h2></div></div>
      <div className="outlook-queue">{seasonCoverageQueue.map(item => <article key={item.competition}><span className={`badge ${item.status === "baseline-live" ? "positive" : "scheduled"}`}>{item.status.replaceAll("-", " ")}</span><h3>{item.competition}</h3><p>{item.sport} · {item.season}</p><small>Next evidence: {item.nextInput}</small></article>)}</div>
    </section>

    <section className="story-cta"><strong>Ready for match-level analysis?</strong><p>Fixture predictions take over when teams, kickoff times and usable prices are confirmed.</p><Link className="button primary" href="/predictions">Open today&apos;s predictions</Link></section>
  </main>;
}
