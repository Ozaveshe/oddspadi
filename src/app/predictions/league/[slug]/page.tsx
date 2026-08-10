import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { TeamCrest } from "@/components/odds/TeamCrest";
import { LocalTimeText } from "@/components/odds/LocalTime";
import { CommunitySubjectPanel } from "@/components/community/CommunitySubjectPanel";
import { EntityFixtureList } from "@/components/entities/EntityFixtureList";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { pageMetadata, siteUrl } from "@/lib/seo/pageMetadata";
import { serializeJsonLd } from "@/lib/security/jsonLd";
import { getCachedFootballLeagueTable } from "@/lib/sports/cachedLeagueTable";
import { buildOfficialTable, classifyTableFreshness } from "@/lib/discovery/tableState";
import {
  currentFootballSeason,
  leagueBySlug,
  resolveVerifiedLeagueTable,
  storedLeagueTable,
  toStandingRows,
  featuredFootballLeagueTables
} from "@/lib/sports/leagueStandings";
import { readCompetitionFixtures } from "@/lib/entities/entityReads";
import { competitionSections } from "@/lib/entities/sportSections";
import { readOfficialPublicationsInWindow, summarisePublications } from "@/lib/domain/canonicalReads";
import { getNewsStories } from "@/lib/editorial/news";
import { seasonCoverageQueue, premierLeague2026Baseline } from "@/lib/sports/prediction/seasonOutlooks";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const league = leagueBySlug((await params).slug);
  // Unknown slugs 404 below; keep them out of the index (no soft-404 crawl).
  if (!league) return { title: "Competition hub", robots: { index: false, follow: false } };
  return pageMetadata({
    title: `${league.leagueName} hub`,
    description: `${league.leagueName} intelligence: official table, fixtures, results, model coverage, official picks, news and community.`,
    path: `/predictions/league/${league.slug}`,
    socialTitle: `${league.leagueName} — fixtures, table, picks and analysis`,
    socialDescription: `Everything OddsPadi tracks for the ${league.leagueName}: standings, fixtures, model coverage and the official pick record.`
  });
}

const PERFORMANCE_WINDOW_DAYS = 180;

export default async function CompetitionHubPage({ params }: Props) {
  const { slug } = await params;
  const league = leagueBySlug(slug);
  if (!league) notFound();

  const now = new Date();
  const asOf = now.toISOString();
  const requestedSeason = currentFootballSeason(now);
  const isFeaturedLeague = featuredFootballLeagueTables.some((featured) => featured.slug === slug);

  const [{ table }, fixtures, publicationsWindow, stories] = await Promise.all([
    resolveVerifiedLeagueTable(
      slug,
      requestedSeason,
      (leagueSlug, season) => getCachedFootballLeagueTable(leagueSlug, season),
      storedLeagueTable,
      isFeaturedLeague ? (leagueSlug, season) => getCachedFootballLeagueTable(leagueSlug, season) : undefined
    ),
    readCompetitionFixtures(league.leagueId, { now }),
    readOfficialPublicationsInWindow({
      publishedSince: new Date(now.getTime() - PERFORMANCE_WINDOW_DAYS * 24 * 3600_000).toISOString(),
      publishedUntil: asOf,
      sport: "football"
    }).catch(() => ({ availability: "unavailable" as const, unavailableReason: "read-failed", items: [], truncated: false })),
    getNewsStories().catch(() => [])
  ]);

  const officialTable = buildOfficialTable(table ? toStandingRows(table) : null, {
    verifiedAt: table?.updatedAt ?? null
  });
  const freshness = classifyTableFreshness(table?.updatedAt ?? null, now);
  const rawById = new Map((table?.rows ?? []).map((row) => [row.teamId, row]));
  const tableRows = officialTable.state === "unavailable" ? [] : officialTable.rows.slice(0, 6);
  const topTeams = officialTable.state === "in-progress" ? officialTable.rows.slice(0, 3) : [];

  const competitionNames = new Set([league.name, league.leagueName]);
  const competitionPublications = publicationsWindow.items.filter((item) => competitionNames.has(item.competition));
  const performance = summarisePublications(competitionPublications, publicationsWindow.availability, publicationsWindow.unavailableReason, asOf);

  const sportStories = stories.filter((story) => story.sport === "football").slice(0, 3);
  const leagueSpecificStories = sportStories.filter(
    (story) => story.title.includes(league.name) || story.excerpt.includes(league.name)
  );

  const outlookQueueEntry = seasonCoverageQueue.find(
    (entry) => entry.competition === league.name || entry.competition === league.leagueName
  );
  const hasOutlook = slug === "premier-league";
  const sections = new Map(competitionSections("football").map((section) => [section.key, section]));

  const hubUrl = `${siteUrl}/predictions/league/${league.slug}`;
  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "SportsOrganization",
      name: league.leagueName,
      sport: "Soccer",
      url: hubUrl
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "Predictions", item: `${siteUrl}/predictions` },
        { "@type": "ListItem", position: 3, name: league.leagueName, item: hubUrl }
      ]
    }
  ];

  return (
    <main id="main" className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }} />
      <div className="page-heading">
        <div className="meta">
          <Link className="inline-link" href="/predictions">← Predictions</Link>
          <span className="country-inline"><CountryFlag country={league.country} size={16} />{league.country}</span>
        </div>
        <h1>{league.leagueName} <span className="accent">hub</span></h1>
        <p>Official standings, fixtures, model coverage and the accountable pick record for the {league.leagueName} — with simulations kept strictly apart from official facts.</p>
      </div>

      <section className="section" aria-label="Official table">
        <div className="section-title">
          <div><span className="section-kicker">Official</span><h2>{officialTable.label}</h2></div>
          <Link className="button secondary" href={`/predictions/league/${encodeURIComponent(league.slug)}/table`}>Full official table</Link>
        </div>
        {officialTable.state === "unavailable" || !tableRows.length ? (
          <p className="muted">{officialTable.state === "unavailable" ? officialTable.note : "No table rows are available for this season yet."}</p>
        ) : (
          <>
            {officialTable.state === "season-not-started" ? <p className="notice">{officialTable.note}</p> : null}
            <ol className="hub-table-summary">
              {tableRows.map((row) => {
                const raw = rawById.get(row.teamId);
                const position = "position" in row && typeof row.position === "number" ? row.position : null;
                return (
                  <li key={row.teamId}>
                    <span className="standings-team">
                      <span className="muted small">{position ?? "—"}</span>
                      <TeamCrest name={row.teamName} logo={raw?.teamLogo} size={20} />
                      <Link href={`/predictions/team/${encodeURIComponent(row.teamId)}`}>{row.teamName}</Link>
                    </span>
                    <span className="muted small">{row.played} played · {row.points} pts{row.pointsAdjustment ? ` (${row.pointsAdjustment} pts: ${row.adjustmentNote ?? "adjustment"})` : ""}</span>
                  </li>
                );
              })}
            </ol>
            {table ? (
              <p className="muted small">
                Updated <LocalTimeText iso={table.updatedAt} variant="datetime" />.{freshness.note ? ` ${freshness.note}` : ""}
              </p>
            ) : null}
          </>
        )}
      </section>

      {fixtures.liveNow.length ? (
        <section className="section" aria-label="Live now">
          <div className="section-title"><div><span className="section-kicker">Live</span><h2>Live now</h2></div></div>
          <EntityFixtureList fixtures={fixtures.liveNow} emptyNote="" asOf={asOf} showScores />
        </section>
      ) : null}

      <section className="section" aria-label="Upcoming fixtures">
        <div className="section-title"><div><span className="section-kicker">Next up</span><h2>Upcoming fixtures</h2></div></div>
        <EntityFixtureList
          fixtures={fixtures.upcoming}
          emptyNote={fixtures.availability === "unavailable" ? "Fixtures could not be read right now. Nothing has been substituted." : "No fixtures are scheduled in the next two weeks."}
          asOf={asOf}
        />
      </section>

      <section className="section" aria-label="Recent results">
        <div className="section-title"><div><span className="section-kicker">Results</span><h2>Recent results</h2></div></div>
        <EntityFixtureList
          fixtures={fixtures.results}
          emptyNote={fixtures.availability === "unavailable" ? "Results could not be read right now. Nothing has been substituted." : "No results in the last two weeks."}
          asOf={asOf}
          showScores
        />
      </section>

      {topTeams.length ? (
        <section className="section" aria-label="Form and top teams">
          <div className="section-title"><div><span className="section-kicker">In form</span><h2>Top of the table</h2></div></div>
          <div className="explore-tile-row">
            {topTeams.map((row) => {
              const raw = rawById.get(row.teamId);
              return (
                <Link className="explore-tile" href={`/predictions/team/${encodeURIComponent(row.teamId)}`} key={row.teamId}>
                  <strong>{row.teamName}</strong>
                  <span>{row.points} pts · form {raw?.form || "—"}</span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="section" aria-label="Official pick record">
        <div className="section-title">
          <div><span className="section-kicker">Accountable</span><h2>OddsPadi in the {league.leagueName}</h2></div>
          <Link className="button secondary" href={`/track-record?competition=${encodeURIComponent(league.name)}`}>Track record filter</Link>
        </div>
        {performance.availability === "unavailable" ? (
          <p className="muted">The publication ledger could not be read right now, so no record is shown.</p>
        ) : performance.totalPublished === 0 ? (
          <p className="muted">No official picks have been published for this competition in the last {PERFORMANCE_WINDOW_DAYS} days.</p>
        ) : (
          <p>
            {performance.totalPublished} official pick{performance.totalPublished === 1 ? "" : "s"} in the last {PERFORMANCE_WINDOW_DAYS} days:
            {" "}{performance.won} won, {performance.lost} lost, {performance.push} push, {performance.voided} void.
            {performance.accuracy !== null ? ` Accuracy ${(performance.accuracy * 100).toFixed(1)}% on settled picks.` : " Not enough settled picks for a rate yet."}
          </p>
        )}
      </section>

      <section className="section" aria-label="Season outlook">
        <div className="section-title"><div><span className="section-kicker">Research</span><h2>Season outlook</h2></div></div>
        {hasOutlook ? (
          <p>
            A versioned returning-team simulation exists for this competition (revision {premierLeague2026Baseline.revision}, published {premierLeague2026Baseline.publishedAt}).
            {" "}<Link className="inline-link" href="/season-outlooks">Read the season outlook</Link> — it is a research object, kept apart from the official table above.
          </p>
        ) : outlookQueueEntry ? (
          <p className="muted">No outlook is published yet. Coverage queue status: {outlookQueueEntry.status.replaceAll("-", " ")} ({outlookQueueEntry.nextInput}).</p>
        ) : (
          <p className="muted">No season outlook is published for this competition.</p>
        )}
        {sections.get("projection")?.note ? <p className="muted small">{sections.get("projection")?.note}</p> : null}
      </section>

      <section className="section" aria-label="News">
        <div className="section-title"><div><span className="section-kicker">News desk</span><h2>News</h2></div></div>
        {sportStories.length ? (
          <>
            {leagueSpecificStories.length === 0 ? (
              <p className="muted small">From the football news desk — not competition-specific.</p>
            ) : null}
            <ul className="hub-news-list">
              {(leagueSpecificStories.length ? leagueSpecificStories : sportStories).map((story) => (
                <li key={story.slug}>
                  <Link href={`/news/${encodeURIComponent(story.slug)}`}>{story.title}</Link>
                  <span className="muted small"> · {story.category}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">No football stories are published right now.</p>
        )}
      </section>

      <CommunitySubjectPanel subjectType="competition" subjectId={league.slug} title={`${league.name} talk`} />

      <section className="section"><ResponsibleUseNotice /></section>
    </main>
  );
}
