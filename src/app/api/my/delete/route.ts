import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";

export const dynamic = "force-dynamic";

/**
 * Personal data deletion.
 *
 * Deletes every personal row the account owns — workspaces, follows, alert
 * preferences, push subscriptions — and revokes any share links the user
 * issued. Requires the literal confirmation string so a stray API call
 * cannot erase a user's history.
 *
 * The auth identity itself (email + password row) is Supabase-managed;
 * per-table cascades already tie every op_ row to it, so an account-level
 * deletion request removes anything this route might have missed. This
 * route is the self-service half: everything personal, gone now.
 */
export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Deletion is not configured." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to delete your data." }, { status: 401 });

  const parsed = await readBoundedJson<{ confirm?: unknown }>(request, 2_048);
  if (!parsed.ok) return parsed.response;
  if (parsed.value.confirm !== "delete my personal data") {
    return privateJson(
      { error: 'Send { "confirm": "delete my personal data" } to proceed. This cannot be undone.' },
      { status: 400 }
    );
  }

  // Owner-scoped deletes through the user's own client; RLS is the guard.
  const deletions = [
    supabase.from("op_workspaces").delete().eq("user_id", user.id),
    supabase.from("op_follows").delete().eq("user_id", user.id),
    supabase.from("op_alert_preferences").delete().eq("user_id", user.id),
    supabase.from("op_followed_teams").delete().eq("user_id", user.id),
    supabase.from("op_push_subscriptions").delete().eq("user_id", user.id)
  ];
  for (const deletion of deletions) {
    const { error } = await deletion;
    if (error) return databaseUnavailable("personal deletion", error, "Deletion failed part-way; retry to finish. Nothing partial is hidden.");
  }

  // Shares are service-role-only, so their revocation goes through the
  // service client — scoped to this owner, revoke rather than delete so an
  // already-shared link dies loudly instead of 404ing ambiguously.
  const service = getSupabaseServerClient();
  if (service) {
    await service
      .from("op_workspace_shares")
      .update({ revoked_at: new Date().toISOString() })
      .eq("owner_user_id", user.id)
      .is("revoked_at", null);
  }

  return privateJson({
    ok: true,
    deleted: ["workspaces", "follows", "alert preferences", "followed teams", "push subscriptions"],
    sharesRevoked: true,
    note: "Your sign-in identity remains so you can keep using the account; ask support to remove the account itself."
  });
}
