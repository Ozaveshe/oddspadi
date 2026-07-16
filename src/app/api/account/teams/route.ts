import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { databaseUnavailable } from "@/lib/security/databaseError";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Team search is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to search teams." }, { status: 401 });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2) return Response.json({ teams: [] });
  const { data, error } = await supabase.from("op_teams")
    .select("id,external_id,name,sport,country,metadata")
    .ilike("name", `%${query}%`).order("name").limit(20);
  if (error) return databaseUnavailable("account team search", error, "Team search is temporarily unavailable.");
  return Response.json({ teams: (data ?? []).map((team) => ({
    id: team.id, externalId: team.external_id, name: team.name, sport: team.sport, country: team.country,
    logo: typeof team.metadata?.logo === "string" ? team.metadata.logo : null
  })) });
}
