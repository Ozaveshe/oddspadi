import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { readOfficialPublications } from "@/lib/domain/canonicalReads";
import { todayWindow, normalizeTimeZone } from "@/lib/time/dayWindow";

export const dynamic = "force-dynamic";

/**
 * The My Padi matchday summary: a prepared, bounded personal read.
 *
 * POST because guests send their local follows in the body (an account read
 * derives follows server-side and ignores the body's follows). Every query
 * is follow-filtered and capped — this route never loads the public fixture
 * catalogue, and a visitor following nothing gets an honest empty summary,
 * not a firehose.
 *
 * Each section carries its own availability so the page can distinguish
 * "nothing followed today" from "the read failed" — a failed read is never
 * presented as an empty matchday.
 */

const MAX_FOLLOW_NAMES = 50;
const MAX_FIXTURES = 60;
const PUBLICATION_LIMIT = 12;

type SummaryFollows = {
  teamNames: string[];
  competitions: string[];
  sports: string[];
};

function readFollowList(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0 && entry.length <= 120)
        .slice(0, MAX_FOLLOW_NAMES)
    : [];
}

async function accountFollows(): Promise<{ follows: SummaryFollows; authenticated: boolean }> {
  const empty: SummaryFollows = { teamNames: [], competitions: [], sports: [] };
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { follows: empty, authenticated: false };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { follows: empty, authenticated: false };

  const [teams, follows] = await Promise.all([
    supabase
      .from("op_followed_teams")
      .select("team:op_teams!op_followed_teams_team_id_fkey(name)")
      .eq("user_id", user.id)
      .limit(MAX_FOLLOW_NAMES),
    supabase.from("op_follows").select("entity_type,display_name").eq("user_id", user.id).limit(MAX_FOLLOW_NAMES * 3)
  ]);

  const teamNames = (teams.data ?? []).flatMap(({ team }) => {
    const value = Array.isArray(team) ? team[0] : team;
    const name = (value as { name?: unknown } | null)?.name;
    return typeof name === "string" ? [name] : [];
  });
  const rows = follows.data ?? [];
  return {
    authenticated: true,
    follows: {
      teamNames,
      competitions: rows.filter((row) => row.entity_type === "competition").map((row) => String(row.display_name)),
      sports: rows.filter((row) => row.entity_type === "sport").map((row) => String(row.display_name))
    }
  };
}

type FixtureRow = {
  external_id: string;
  sport: string;
  status: string;
  kickoff_at: string;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | null;
  away_score: number | null;
};

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const service = getSupabaseServerClient();
  if (!service) return privateJson({ error: "The personal summary is not configured." }, { status: 503 });

  const parsed = await readBoundedJson<{ follows?: Partial<SummaryFollows>; timezone?: unknown }>(request, 16_000);
  if (!parsed.ok) return parsed.response;

  const account = await accountFollows();
  // Account follows are authoritative when present; guests supply their own.
  const follows: SummaryFollows = account.authenticated
    ? account.follows
    : {
        teamNames: readFollowList(parsed.value.follows?.teamNames),
        competitions: readFollowList(parsed.value.follows?.competitions),
        sports: readFollowList(parsed.value.follows?.sports)
      };

  const timezone = normalizeTimeZone(typeof parsed.value.timezone === "string" ? parsed.value.timezone : null);
  const window = todayWindow(new Date(), timezone);

  // --- Followed fixtures today (and live among them) -----------------------
  let fixtures: FixtureRow[] = [];
  let fixturesAvailability: "complete" | "unavailable" | "not_followed" = "not_followed";
  const followsAnything = follows.teamNames.length || follows.competitions.length || follows.sports.length;

  if (followsAnything) {
    const parts: FixtureRow[][] = [];
    const base = () =>
      service
        .from("op_fixtures")
        .select("external_id,sport,status,kickoff_at,league_name,home_team_name,away_team_name,home_score,away_score")
        .gte("kickoff_at", window.startUtc)
        .lt("kickoff_at", window.endUtc)
        .order("kickoff_at", { ascending: true })
        .limit(MAX_FIXTURES);

    const reads = [];
    if (follows.teamNames.length) {
      reads.push(base().in("home_team_name", follows.teamNames));
      reads.push(base().in("away_team_name", follows.teamNames));
    }
    if (follows.competitions.length) reads.push(base().in("league_name", follows.competitions));
    if (follows.sports.length) reads.push(base().in("sport", follows.sports.map((sport) => sport.toLowerCase())));

    fixturesAvailability = "complete";
    for (const read of reads) {
      const { data, error } = await read;
      if (error) {
        fixturesAvailability = "unavailable";
        break;
      }
      parts.push((data ?? []) as FixtureRow[]);
    }
    if (fixturesAvailability === "complete") {
      const byId = new Map<string, FixtureRow>();
      for (const row of parts.flat()) byId.set(row.external_id, row);
      fixtures = [...byId.values()].sort((left, right) => left.kickoff_at.localeCompare(right.kickoff_at)).slice(0, MAX_FIXTURES);
    }
  }

  // --- Watchlist / decision state for the followed fixtures ----------------
  const watchlistStates: Record<string, string> = {};
  if (fixtures.length) {
    const { data } = await service
      .from("op_fixture_decision_summaries")
      .select("fixture_external_id,public_status")
      .in("fixture_external_id", fixtures.map((row) => row.external_id))
      .is("superseded_by", null)
      .order("generated_at", { ascending: false })
      .limit(fixtures.length * 2);
    for (const row of data ?? []) {
      const key = String(row.fixture_external_id);
      if (!(key in watchlistStates)) watchlistStates[key] = String(row.public_status);
    }
  }

  // --- Latest official publications and recent settlements ------------------
  const publications = await readOfficialPublications({ limit: PUBLICATION_LIMIT * 4, client: service });
  const latestPublished = publications.items
    .filter((item) => item.publicationStatus === "published" || item.publicationStatus === "corrected")
    .sort((left, right) => (right.publishedAt ?? "").localeCompare(left.publishedAt ?? ""))
    .slice(0, PUBLICATION_LIMIT);
  const recentSettlements = publications.items
    .filter((item) => item.settledAt)
    .sort((left, right) => (right.settledAt ?? "").localeCompare(left.settledAt ?? ""))
    .slice(0, PUBLICATION_LIMIT);

  return privateJson(
    {
      authenticated: account.authenticated,
      timezone,
      window,
      followedFixtures: {
        availability: fixturesAvailability,
        today: fixtures,
        live: fixtures.filter((row) => row.status === "live"),
        watchlistStates
      },
      officialPublications: {
        availability: publications.availability,
        latest: latestPublished,
        recentSettlements
      },
      generatedAt: new Date().toISOString()
    },
    { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } }
  );
}
