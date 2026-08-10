import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CommunitySubjectPanel } from "@/components/community/CommunitySubjectPanel";
import { EntityFixtureList } from "@/components/entities/EntityFixtureList";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readTeamFixtures, deriveFormFromResults } from "@/lib/entities/entityReads";
import { playerSections, type EntitySport } from "@/lib/entities/sportSections";
import { getNewsStories } from "@/lib/editorial/news";
import {
  loadHistoricalTennisStrength,
  type HistoricalTennisPlayerStrength
} from "@/lib/sports/prediction/historicalTennisStrength";
import { personNamesAlign } from "@/lib/sports/providers/teamNameAlignment";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ playerId: string }> };

/** Accept both the raw external id and the dash form used in shared URLs. */
function candidatePlayerIds(raw: string): string[] {
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

type PlayerRecord = { externalId: string; sport: EntitySport; name: string; country: string | null };

async function lookupPlayer(raw: string): Promise<PlayerRecord | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;
  for (const candidate of candidatePlayerIds(raw)) {
    const { data } = await client
      .from("op_teams")
      .select("external_id,sport,name,country")
      .eq("external_id", candidate)
      .limit(1);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (row) {
      const sport = String(row.sport ?? "tennis");
      return {
        externalId: String(row.external_id),
        sport: (["football", "basketball", "tennis"].includes(sport) ? sport : "tennis") as EntitySport,
        name: String(row.name ?? "Player"),
        country: row.country ? String(row.country) : null
      };
    }
  }
  return null;
}

async function resolveStrength(playerName: string): Promise<HistoricalTennisPlayerStrength | null> {
  const strengths = await loadHistoricalTennisStrength().catch(() => new Map());
  for (const entry of strengths.values()) {
    if (personNamesAlign(entry.overall.playerName, playerName)) return entry;
  }
  return null;
}

const SMALL_SAMPLE = 20;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { playerId } = await params;
  const player = await lookupPlayer(playerId);
  // Unknown players 404 below and must never be crawled as thin soft-404s.
  if (!player) return { title: "Player", robots: { index: false, follow: false } };
  const [fixtures, strength] = await Promise.all([
    readTeamFixtures(player.externalId),
    player.sport === "tennis" ? resolveStrength(player.name) : Promise.resolve(null)
  ]);
  const matches = fixtures.upcoming.length + fixtures.liveNow.length + fixtures.results.length;
  // Thin-page rule: a player page is indexable only with a durable record —
  // at least five stored matches AND a corpus rating. Everything else stays
  // reachable but out of the index.
  const durable = matches >= 5 && strength !== null;
  const base = pageMetadata({
    title: `${player.name} — matches, form and surface ratings`,
    description: `${player.name} on OddsPadi: stored matches, form and per-surface ratings with sample sizes, connected to the canonical player identity.`,
    path: `/predictions/player/${encodeURIComponent(player.externalId)}`
  });
  return durable ? base : { ...base, robots: { index: false, follow: true } };
}

export default async function PlayerPage({ params }: Props) {
  const { playerId } = await params;
  const player = await lookupPlayer(playerId);
  if (!player) notFound();

  const now = new Date();
  const asOf = now.toISOString();
  const fixtures = await readTeamFixtures(player.externalId, { now });
  const strength = player.sport === "tennis" ? await resolveStrength(player.name) : null;
  const sections = new Map(playerSections(player.sport).map((section) => [section.key, section]));
  const form = deriveFormFromResults(player.externalId, fixtures.results);
  const stories = (await getNewsStories().catch(() => [])).filter((story) => story.sport === player.sport).slice(0, 3);
  const surfaceRows = strength ? [...strength.bySurface.values()] : [];

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <div className="meta">
          <Link className="inline-link" href="/predictions">← Predictions</Link>
          {player.country ? <span>{player.country}</span> : null}
          <span className="badge scheduled">{player.sport}</span>
        </div>
        <h1>{player.name}</h1>
        <p>Stored matches, form and rating evidence for {player.name}. Sections only appear where durable data supports them.</p>
      </div>

      {player.sport !== "tennis" ? (
        <section className="section" aria-label="Data coverage">
          <p className="muted">{sections.get("fixtures")?.note ?? "Per-player data is not tracked for this sport."}</p>
        </section>
      ) : null}

      {sections.get("surface_ratings")?.supported ? (
        <section className="section" aria-label="Surface ratings">
          <div className="section-title"><div><span className="section-kicker">Ratings</span><h2>Surface ratings</h2></div></div>
          {strength ? (
            <>
              <ul className="hub-news-list">
                <li>
                  Overall: <strong>{strength.overall.modelRating.toFixed(1)}</strong>
                  <span className="muted small"> · {strength.overall.sampleSize} matches{strength.overall.sampleSize < SMALL_SAMPLE ? " · small sample — treat with caution" : ""}</span>
                </li>
                {surfaceRows.map((rating) => (
                  <li key={rating.surface ?? "overall"}>
                    {rating.surface ?? "Unknown surface"}: <strong>{rating.modelRating.toFixed(1)}</strong>
                    <span className="muted small"> · {rating.sampleSize} matches{rating.sampleSize < SMALL_SAMPLE ? " · small sample — treat with caution" : ""}</span>
                  </li>
                ))}
              </ul>
              <p className="muted small">Ratings come from the historical corpus (as of <span>{strength.overall.asOf}</span>); they are research evidence, not a certainty about the next match.</p>
            </>
          ) : (
            <p className="muted">No corpus rating exists for this player yet, so none is shown.</p>
          )}
        </section>
      ) : null}

      {form.length ? (
        <section className="section" aria-label="Form">
          <div className="section-title"><div><span className="section-kicker">Form</span><h2>Recent form</h2></div></div>
          <p className="standings-form">{form.map((result, index) => <span className={result.toLowerCase()} key={`${result}-${index}`}>{result}</span>)}</p>
        </section>
      ) : null}

      <section className="section" aria-label="Upcoming matches">
        <div className="section-title"><div><span className="section-kicker">Next up</span><h2>Matches</h2></div></div>
        <EntityFixtureList
          fixtures={[...fixtures.liveNow, ...fixtures.upcoming]}
          emptyNote={fixtures.availability === "unavailable" ? "Matches could not be read right now. Nothing has been substituted." : "No upcoming matches are stored for this player."}
          asOf={asOf}
        />
      </section>

      <section className="section" aria-label="Results">
        <div className="section-title"><div><span className="section-kicker">Results</span><h2>Results</h2></div></div>
        <EntityFixtureList
          fixtures={fixtures.results}
          emptyNote={fixtures.availability === "unavailable" ? "Results could not be read right now. Nothing has been substituted." : "No recent results are stored for this player."}
          asOf={asOf}
          showScores
        />
      </section>

      {sections.get("head_to_head")?.note ? (
        <section className="section" aria-label="Head to head">
          <div className="section-title"><div><span className="section-kicker">Context</span><h2>Head-to-head</h2></div></div>
          <p className="muted">{sections.get("head_to_head")?.note} Head-to-head records appear on match pages beside the sample that produced them.</p>
        </section>
      ) : null}
      {!sections.get("tournament_draw")?.supported && sections.get("tournament_draw")?.note ? (
        <section className="section" aria-label="Tournament draw">
          <div className="section-title"><div><span className="section-kicker">Draw</span><h2>Tournament draw</h2></div></div>
          <p className="muted">{sections.get("tournament_draw")?.note}</p>
        </section>
      ) : null}

      <section className="section" aria-label="News">
        <div className="section-title"><div><span className="section-kicker">News desk</span><h2>News</h2></div></div>
        {stories.length ? (
          <>
            <p className="muted small">From the {player.sport} news desk — not player-specific.</p>
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

      <CommunitySubjectPanel subjectType="player" subjectId={player.externalId} title={`${player.name} talk`} />

      <section className="section"><ResponsibleUseNotice /></section>
    </main>
  );
}
