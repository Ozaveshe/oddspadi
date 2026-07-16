import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { TeamCrest } from "@/components/odds/TeamCrest";
import {
  footballLeagues,
  currentFootballSeason,
  leagueBySlug,
  storedLeagueTable,
} from "@/lib/sports/leagueStandings";
import { sportsProvider } from "@/lib/sports/service";
import { serializeJsonLd } from "@/lib/security/jsonLd";

export const revalidate = 10800;

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return footballLeagues.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const league = leagueBySlug((await params).slug);
  if (!league) return { title: "League table" };

  return {
    title: `${league.leagueName} Table`,
    description: `Current ${league.leagueName} standings: position, results, goal difference, points and recent form.`,
    alternates: { canonical: `/predictions/league/${league.slug}/table` },
  };
}

function Form({ value }: { value: string }) {
  return (
    <span className="standings-form" aria-label={`Recent form ${value || "unavailable"}`}>
      {value
        ? [...value].map((result, index) => (
            <span className={result.toLowerCase()} key={`${result}-${index}`}>
              {result}
            </span>
          ))
        : "—"}
    </span>
  );
}

export default async function LeagueTablePage({ params }: Props) {
  const { slug } = await params;
  const league = leagueBySlug(slug);
  if (!league) notFound();

  const season = currentFootballSeason();
  const table =
    (await sportsProvider.getFootballLeagueTable(slug, season).catch(() => null)) ??
    (await storedLeagueTable(slug, season).catch(() => null));
  const url = `${siteUrl}/predictions/league/${slug}/table`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
      { "@type": "ListItem", position: 2, name: "Predictions", item: `${siteUrl}/predictions` },
      { "@type": "ListItem", position: 3, name: league.leagueName, item: url },
      { "@type": "ListItem", position: 4, name: "Table", item: url },
    ],
  };

  return (
    <main id="main" className="container">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <div className="page-heading">
        <div className="meta">
          <Link className="inline-link" href="/predictions">
            ← Predictions
          </Link>
          <span className="country-inline">
            <CountryFlag country={league.country} size={16} />
            {league.country}
          </span>
          <span>
            {season}/{String(Number(season) + 1).slice(-2)}
          </span>
        </div>
        <h1>
          {league.leagueName} <span className="accent">table</span>
        </h1>
        <p>Current standings, results record and recent form. Refreshed every few hours when provider data is available.</p>
      </div>

      {table?.rows.length ? (
        <>
          <div className="standings-scroll">
            <table className="standings-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Team</th>
                  <th scope="col">P</th>
                  <th scope="col">W</th>
                  <th scope="col">D</th>
                  <th scope="col">L</th>
                  <th scope="col">GD</th>
                  <th scope="col">Pts</th>
                  <th scope="col">Form</th>
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row) => (
                  <tr
                    key={row.teamId}
                    className={row.position <= 4 ? "zone-top" : row.position > table.rows.length - 3 ? "zone-bottom" : undefined}
                  >
                    <td>
                      <span className="position-cell">
                        {row.position}
                        {row.movement ? (
                          <small className={row.movement > 0 ? "up" : "down"}>
                            {row.movement > 0 ? "▲" : "▼"}
                            {Math.abs(row.movement)}
                          </small>
                        ) : null}
                      </span>
                    </td>
                    <th scope="row">
                      <span className="standings-team">
                        <TeamCrest name={row.teamName} logo={row.teamLogo} size={26} />
                        <span>{row.teamName}</span>
                      </span>
                    </th>
                    <td>{row.played}</td>
                    <td>{row.wins}</td>
                    <td>{row.draws}</td>
                    <td>{row.losses}</td>
                    <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
                    <td><strong>{row.points}</strong></td>
                    <td><Form value={row.form} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small standings-source">
            Source: {table.source === "api-football-standings" ? "API-Football" : "latest stored OddsPadi snapshot"}. Updated{" "}
            {new Date(table.updatedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}.
          </p>
        </>
      ) : (
        <div className="empty-state">
          <h2>No verified table yet</h2>
          <p className="muted">
            The provider has not published standings for this league and season, and OddsPadi has no current stored snapshot. We won&apos;t fill the table with estimates.
          </p>
          <Link className="button primary" href="/predictions">Browse match predictions</Link>
        </div>
      )}
    </main>
  );
}
