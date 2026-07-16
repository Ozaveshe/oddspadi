import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";

export const dynamic = "force-dynamic";

const PRIVATE_READ_HEADERS = { "Cache-Control": "private, max-age=0, must-revalidate" };

function teamRows(rows: Array<{ team: unknown }> | null) {
  return (rows ?? []).flatMap(({ team }) => {
    const value = Array.isArray(team) ? team[0] : team;
    if (!value || typeof value !== "object") return [];
    const row = value as Record<string, unknown>;
    return [{ id: String(row.id), externalId: String(row.external_id), name: String(row.name), sport: String(row.sport), country: typeof row.country === "string" ? row.country : null, logo: typeof (row.metadata as Record<string, unknown> | null)?.logo === "string" ? String((row.metadata as Record<string, unknown>).logo) : null }];
  });
}

async function authClient() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: Response.json({ error: "Followed teams are not configured." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: Response.json({ error: "Sign in to follow teams." }, { status: 401 }) };
  return { supabase, user };
}

export async function GET() {
  const auth = await authClient();
  // Reading the optional follow list happens in the global shell. Anonymous
  // visitors are a normal state, so keep that read out of the browser's error
  // console while mutations continue to require authentication.
  if (auth.error) {
    if (auth.error.status === 401) {
      return Response.json({ teams: [], authenticated: false }, { headers: PRIVATE_READ_HEADERS });
    }
    return auth.error;
  }
  const { data, error } = await auth.supabase.from("op_followed_teams")
    .select("team:op_teams!op_followed_teams_team_id_fkey(id,external_id,name,sport,country,metadata)")
    .eq("user_id", auth.user.id).order("created_at");
  if (error) return databaseUnavailable("followed teams read", error, "Followed teams are temporarily unavailable.");
  return Response.json(
    { teams: teamRows(data as Array<{ team: unknown }> | null), authenticated: true },
    { headers: PRIVATE_READ_HEADERS }
  );
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const auth = await authClient(); if (auth.error) return auth.error;
  const payload = (await request.json().catch(() => ({}))) as { teamId?: unknown };
  const teamId = typeof payload.teamId === "string" ? payload.teamId : "";
  if (!isUuid(teamId)) return Response.json({ error: "Choose a team to follow." }, { status: 400 });
  const { error } = await auth.supabase.from("op_followed_teams").insert({ user_id: auth.user.id, team_id: teamId });
  // Following an already-followed team is an idempotent success. Avoiding an
  // upsert also means the public API never needs UPDATE privileges on the join.
  if (error && error.code !== "23505") return databaseUnavailable("follow team", error, "Could not follow that team right now.");
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const auth = await authClient(); if (auth.error) return auth.error;
  const teamId = new URL(request.url).searchParams.get("teamId") ?? "";
  if (!isUuid(teamId)) return Response.json({ error: "Choose a team to unfollow." }, { status: 400 });
  const { error } = await auth.supabase.from("op_followed_teams").delete().eq("user_id", auth.user.id).eq("team_id", teamId);
  if (error) return databaseUnavailable("unfollow team", error, "Could not unfollow that team right now.");
  return Response.json({ ok: true });
}
