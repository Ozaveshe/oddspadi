import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { escapeIlikePattern } from "@/lib/security/inputValidation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Team search is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to search teams." }, { status: 401 });
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (query.length < 2) return privateJson({ teams: [] });
  const { data, error } = await supabase.from("op_teams")
    .select("id,external_id,name,sport,country,metadata")
    .ilike("name", `%${escapeIlikePattern(query)}%`).order("name").limit(20);
  if (error) return databaseUnavailable("account team search", error, "Team search is temporarily unavailable.");
  return privateJson({ teams: (data ?? []).map((team) => ({
    id: team.id, externalId: team.external_id, name: team.name, sport: team.sport, country: team.country,
    logo: typeof team.metadata?.logo === "string" ? team.metadata.logo : null
  })) });
}
