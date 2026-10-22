import { getSupabaseServerClient } from "@/lib/supabase/server";
import { readLatestDecisionSummary } from "@/lib/sports/intelligence/repository";
import { privateJson } from "@/lib/security/privateJson";
import { workspaceOptions, type WorkspaceFixture } from "@/lib/workspace/options";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("fixtureId");
  const q = (params.get("q") ?? "").trim().slice(0, 80).replace(/[^\p{L}\p{N} -]/gu, "");
  if (id && !/^[a-zA-Z0-9:_-]{1,120}$/.test(id)) return privateJson({ error: "Invalid fixture." }, { status: 400 });
  if (!id && q.length < 2) return privateJson({ fixtures: [] });
  const service = getSupabaseServerClient();
  if (!service) return privateJson({ error: "Fixture search is unavailable." }, { status: 503 });
  const now = new Date();
  let query = service.from("op_fixtures")
    .select("external_id,sport,home_team_name,away_team_name,league_name,kickoff_at,last_synced_at,provider,metadata")
    .in("sport", ["football", "basketball", "tennis"]).eq("status", "scheduled")
    .gt("kickoff_at", now.toISOString()).lt("kickoff_at", new Date(now.getTime() + 7 * 86400000).toISOString());
  query = id ? query.eq("external_id", id) : query.or(`home_team_name.ilike.%${q}%,away_team_name.ilike.%${q}%`);
  const { data, error } = await query.order("kickoff_at").limit(20);
  if (error) return privateJson({ error: "Fixture search is temporarily unavailable." }, { status: 503 });
  const fixtures: WorkspaceFixture[] = (data ?? []).filter((row) =>
    !String(row.provider).includes("mock") && !["demo", "mock"].includes(row.metadata?.sourceKind) && !row.metadata?.duplicateOf
  ).map((row) => ({ id: row.external_id, sport: row.sport, label: `${row.home_team_name} vs ${row.away_team_name}`,
    competition: row.league_name, kickoffAt: row.kickoff_at, lastSyncedAt: row.last_synced_at }));
  if (!id) return privateJson({ fixtures });
  const fixture = fixtures[0];
  if (!fixture) return privateJson({ error: "This fixture is no longer available for pre-match analysis." }, { status: 404 });
  const summary = await readLatestDecisionSummary(id, service);
  return privateJson({ fixture, options: workspaceOptions(fixture, summary, now) });
}
