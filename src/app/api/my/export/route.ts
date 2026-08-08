import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { databaseUnavailable } from "@/lib/security/databaseError";

export const dynamic = "force-dynamic";

/**
 * Full personal data export: everything the account stores, in one readable
 * JSON document, through the user's own RLS-scoped client — the export can
 * only ever contain what the user could already read.
 */
export async function GET() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Export is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to export your data." }, { status: 401 });

  const [profile, followedTeams, follows, alertPreferences, workspaces, pushSubscriptions] = await Promise.all([
    supabase.from("op_profiles").select("username,display_name,favourite_team,bio,created_at").eq("id", user.id).maybeSingle(),
    supabase
      .from("op_followed_teams")
      .select("created_at,team:op_teams!op_followed_teams_team_id_fkey(name,sport,country)")
      .eq("user_id", user.id),
    supabase.from("op_follows").select("entity_type,display_name,created_at").eq("user_id", user.id),
    supabase
      .from("op_alert_preferences")
      .select("channels,enabled_types,quiet_hours,timezone,sport_settings,competition_settings,max_alerts_per_day,updated_at")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase.from("op_workspaces").select("workspace_id,payload,archived_at,created_at,updated_at").eq("user_id", user.id),
    supabase.from("op_push_subscriptions").select("endpoint,user_agent,created_at").eq("user_id", user.id)
  ]);

  const firstError =
    profile.error ?? followedTeams.error ?? follows.error ?? alertPreferences.error ?? workspaces.error ?? pushSubscriptions.error;
  if (firstError) return databaseUnavailable("personal export", firstError, "Export is temporarily unavailable; nothing was omitted silently.");

  return privateJson(
    {
      format: "oddspadi-personal-export-v1",
      exportedAt: new Date().toISOString(),
      account: { email: user.email ?? null, createdAt: user.created_at ?? null },
      profile: profile.data ?? null,
      followedTeams: followedTeams.data ?? [],
      follows: follows.data ?? [],
      alertPreferences: alertPreferences.data ?? null,
      workspaces: (workspaces.data ?? []).map((row) => row.payload),
      pushSubscriptions: pushSubscriptions.data ?? []
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": 'attachment; filename="oddspadi-personal-export.json"'
      }
    }
  );
}
