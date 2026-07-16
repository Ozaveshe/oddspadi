import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Profiles are not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to update your profile." }, { status: 401 });
  const payload = (await request.json().catch(() => ({}))) as { displayName?: unknown; bio?: unknown; favouriteTeamId?: unknown };
  const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
  const bio = typeof payload.bio === "string" ? payload.bio.trim() : "";
  const favouriteTeamRequested = payload.favouriteTeamId !== undefined;
  const favouriteTeamId = typeof payload.favouriteTeamId === "string" ? payload.favouriteTeamId : "";
  if (displayName.length > 80) return Response.json({ error: "Display name must be 80 characters or fewer." }, { status: 400 });
  if (bio.length > 500) return Response.json({ error: "Bio must be 500 characters or fewer." }, { status: 400 });
  let favouriteTeam: string | null = null;
  if (favouriteTeamRequested && favouriteTeamId) {
    if (!isUuid(favouriteTeamId)) return Response.json({ error: "Choose a team from the search results." }, { status: 400 });
    const { data: team, error: teamError } = await supabase.from("op_teams").select("name").eq("id", favouriteTeamId).maybeSingle();
    if (teamError) return databaseUnavailable("profile favourite team lookup", teamError, "Could not verify that team right now.");
    if (!team) return Response.json({ error: "Choose a team from the search results." }, { status: 400 });
    favouriteTeam = team.name;
  }
  const updates: { display_name: string | null; bio: string | null; favourite_team?: string | null } = { display_name: displayName || null, bio: bio || null };
  if (favouriteTeamRequested) updates.favourite_team = favouriteTeam;
  const { error } = await supabase.from("op_profiles").update(updates).eq("id", user.id);
  if (error) return databaseUnavailable("profile update", error, "Could not update your profile right now.");
  return Response.json({ ok: true, favouriteTeam });
}
