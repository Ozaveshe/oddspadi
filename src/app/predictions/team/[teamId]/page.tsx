import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TeamCrest } from "@/components/odds/TeamCrest";
import { CommunitySubjectPanel } from "@/components/community/CommunitySubjectPanel";
import { EntityFixtureList } from "@/components/entities/EntityFixtureList";
import { FollowTeamButton } from "@/components/account/FollowTeamButton";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readTeamFixtures, deriveFormFromResults } from "@/lib/entities/entityReads";
import { teamSections, type EntitySport } from "@/lib/entities/sportSections";
import { readOfficialPublicationsInWindow } from "@/lib/domain/canonicalReads";
import { getNewsStories } from "@/lib/editorial/news";
import {
  buildOfficialTable
} from "@/lib/discovery/tableState";
import {
  currentFootballSeason,
  leagueSlugFromProviderId,
  resolveVerifiedLeagueTable,
  storedLeagueTable,
  toStandingRows
} from "@/lib/sports/leagueStandings";
import { getCachedFootballLeagueTable } from "@/lib/sports/cachedLeagueTable";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ teamId: string }> };

/** Accept both the raw external id and the dash form used in shared URLs. */
function candidateTeamIds(raw: string): string[] {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    /* keep raw */
  }
  if (decoded.includes(":")) return [decoded];
  const dashToColon = decoded.replace(/-(?=[^-]*$)/, ":");
  return dashToColon === decoded ? [decoded] : [decoded, dashToColon];
}

type TeamRecord = { externalId: string; sport: EntitySport; name: string; country: string | null; logo: string | null };

async function lookupTeam(raw: string): Promise<TeamRecord | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;
  for (const candidate of candidateTeamIds(raw)) {
    const { data } = await client
      .from("op_teams")
      .select("external_id,sport,name,country,metadata")
      .eq("external_id", candidate)
      .limit(1);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (row) {
      const sport = String(row.sport ?? "football");
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      return {
        externalId: String(row.external_id),
        sport: (["football", "basketball", "tennis"].includes(sport) ? sport : "football") as EntitySport,
        name: String(row.name ?? "Team"),
        country: row.country ? String(row.country) : null,
        logo: typeof metadata.logo === "string" ? metadata.logo : null
      };
    }
  }
  return null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { teamId } = await params;
  const team = await lookupTeam(teamId);
  // Unknown teams 404 below and must never be crawled as thin soft-404s.
  if (!team) return { title: "Team", robots: { index: false, follow: false } };
  const fixtures = await readTeamFixtures(team.externalId);
  const durable = fixtures.upcoming.length + fixtures.liveNow.length + fixtures.results.length > 0;
  const base = pageMetadata({
    title: `${team.name} — fixtures, results and analysis`,
    description: `${team.name} on OddsPadi: fixtures, results, form, official picks and community discussion around the canonical team record.`,
    path: `/predictions/team/${encodeURIComponent(team.externalId)}`
  });
  // Thin-page rule: a team with no stored fixtures has no durable value yet.
  return durable ? base : { ...base, robots: { index: false, follow: true } };
}

const PERFORMANCE_WINDOW_DAYS = 180;

export default async function TeamPage({ params }: Props) {
  const { teamId } = await params;
  const team = await lookupTeam(teamId);
  if (!team) notFound();

  const now = new Date();
  const asOf = now.toISOString();
  const fixtures = await readTeamFixtures(team.externalId, { now });
  const sections = new Map(teamSections(team.sport).map((section) => [section.key, section]));
  const form = deriveFormFromResults(team.externalId, fixtures.results);

  // Table position from the league of the most recent fixture, through the
  // official-table builder so a pre-season table never implies a rank.
  const anchorFixture = fixtures.results[0] ?? fixtures.upcoming[0] ?? fixtures.liveNow[0] ?? null;
  let tablePosition: { position: number | null; leagueSlug: string; note: string | null } | null = null;
  if (team.sport === "football" && anchorFixture?.leagueExternalId) {
    const providerLeagueId = anchorFixture.leagueExternalId.includes(":")
      ? anchorFixture.leagueExternalId
      : `api-football:${anchorFixture.leagueExternalId}`;
    const leagueSlug = leagueSlugFromProviderId(providerLeagueId);
    if (leagueSlug) {
      const { table } = await resolveVerifiedLeagueTable(
        leagueSlug,
        currentFootballSeason(now),
        (slug, season) => getCachedFootballLeagueTable(slug, season),
        storedLeagueTable
      ).catch(() => ({ table: null, requestedSeason: "", displaySeason: "", historicalFallback: false }));
      const officialTable = buildOfficialTable(table ? toStandingRows(table) : null);
      if (officialTable.state === "in-progress") {
        const row = officialTable.rows.find(
          (candidate) => candidate.teamId === team.externalId || candidate.teamName.toLowerCase() === team.name.toLowerCase()
        );
        tablePosition = { position: row?.position ?? null, leagueSlug, note: null };
      } else if (officialTable.state === "season-not-started") {
        tablePosition = { position: null, leagueSlug, note: "Season not started — no table position yet." };
      }
    }
  }

  const fixtureIds = new Set(
    [...fixtures.upcoming, ...fixtures.liveNow, ...fixtures.results].map((fixture) => fixture.fixtureId)
  );
  const publicationsWindow = await readOfficialPublicationsInWindow({
    publishedSince: new Date(now.getTime() - PERFORMANCE_WINDOW_DAYS * 24 * 3600_000).toISOString(),
    publishedUntil: asOf,
    sport: team.sport
  }).catch(() => ({ availability: "unavailable" as const, unavailableReason: "read-failed", items: [], truncated: false }));
  const teamPublications = publicationsWindow.items.filter((item) => fixtureIds.has(item.fixtureExternalId)).slice(0, 10);

  const stories = (await getNewsStories().catch(() => [])).filter((story) => story.sport === team.sport).slice(0, 3);

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <div className="meta">
          <Link className="inline-link" href="/predictions">← Predictions</Link>
          {team.country ? <span>{team.country}</span> : null}
        </div>
        <h1>
          <span className="standings-team">
            <TeamCrest name={team.name} logo={team.logo} size={34} />
            <span>{team.name}</span>
          </span>
        </h1>
        <p>Fixtures, results, form and the official OddsPadi record involving {team.name} — connected to the canonical team identity.</p>
        <FollowTeamButton teamName={team.name} sport={team.sport} />
      </div>

      {tablePosition ? (
        <section className="section" aria-label="Table position">
          <div className="section-title"><div><span className="section-kicker">Official</span><h2>Table position</h2></div>
            <Link className="button secondary" href={`/predictions/league/${encodeURIComponent(tablePosition.leagueSlug)}/table`}>Official table</Link>
          </div>
          <p>{tablePosition.note ?? (tablePosition.position ? `Currently ${tablePosition.position}${tablePosition.position === 1 ? "st" : tablePosition.position === 2 ? "nd" : tablePosition.position === 3 ? "rd" : "th"} in the official table.` : "Not in the current official table.")}</p>
        </section>
      ) : null}

      {form.length ? (
        <section className="section" aria-label="Form">
          <div className="section-title"><div><span className="section-kicker">Form</span><h2>Recent form</h2></div></div>
          <p className="standings-form">{form.map((result, index) => <span className={result.toLowerCase()} key={`${result}-${index}`}>{result}</span>)}</p>
        </section>
      ) : null}

      {fixtures.liveNow.length ? (
        <section className="section" aria-label="Live now">
          <div className="section-title"><div><span className="section-kicker">Live</span><h2>Live now</h2></div></div>
          <EntityFixtureList fixtures={fixtures.liveNow} emptyNote="" asOf={asOf} showScores />
        </section>
      ) : null}

      <section className="section" aria-label="Upcoming fixtures">
        <div className="section-title"><div><span className="section-kicker">Next up</span><h2>Fixtures</h2></div></div>
        <EntityFixtureList
          fixtures={fixtures.upcoming}
          emptyNote={fixtures.availability === "unavailable" ? "Fixtures could not be read right now. Nothing has been substituted." : "No upcoming fixtures are stored for this team."}
          asOf={asOf}
        />
      </section>

      <section className="section" aria-label="Results">
        <div className="section-title"><div><span className="section-kicker">Results</span><h2>Results</h2></div></div>
        <EntityFixtureList
          fixtures={fixtures.results}
          emptyNote={fixtures.availability === "unavailable" ? "Results could not be read right now. Nothing has been substituted." : "No recent results are stored for this team."}
          asOf={asOf}
          showScores
        />
      </section>

      <section className="section" aria-label="Official picks involving this team">
        <div className="section-title"><div><span className="section-kicker">Accountable</span><h2>Official picks involving {team.name}</h2></div></div>
        {publicationsWindow.availability === "unavailable" ? (
          <p className="muted">The publication ledger could not be read right now, so no record is shown.</p>
        ) : teamPublications.length ? (
          <ul className="hub-news-list">
            {teamPublications.map((publication) => (
              <li key={publication.publicationId}>
                <Link href={`/track-record/publication/${encodeURIComponent(publication.publicationId)}`}>
                  {publication.market} · {publication.selectionLabel}
                </Link>
                <span className="muted small"> · {publication.settlementStatus}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No official picks touched this team&apos;s fixtures in the last {PERFORMANCE_WINDOW_DAYS} days.</p>
        )}
      </section>

      {!sections.get("squad")?.supported && sections.get("squad")?.note ? (
        <section className="section" aria-label="Squad">
          <div className="section-title"><div><span className="section-kicker">Squad</span><h2>Squad &amp; availability</h2></div></div>
          <p className="muted">{sections.get("squad")?.note}</p>
        </section>
      ) : null}
      {!sections.get("roster")?.supported && sections.get("roster")?.note ? (
        <section className="section" aria-label="Roster">
          <div className="section-title"><div><span className="section-kicker">Roster</span><h2>Roster</h2></div></div>
          <p className="muted">{sections.get("roster")?.note}</p>
        </section>
      ) : null}

      <section className="section" aria-label="News">
        <div className="section-title"><div><span className="section-kicker">News desk</span><h2>News</h2></div></div>
        {stories.length ? (
          <>
            <p className="muted small">From the {team.sport} news desk — not team-specific.</p>
            <ul className="hub-news-list">
              {stories.map((story) => (
                <li key={story.slug}>
                  <Link href={`/news/${encodeURIComponent(story.slug)}`}>{story.title}</Link>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">No stories are published right now.</p>
        )}
      </section>

      <CommunitySubjectPanel subjectType="team" subjectId={team.externalId} title={`${team.name} talk`} />

      <section className="section"><ResponsibleUseNotice /></section>
    </main>
  );
}
