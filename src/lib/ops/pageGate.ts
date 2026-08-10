import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

/**
 * Is the current viewer a staff member? True only when signed in with a profile
 * that is BOTH is_admin (access) AND account_type='staff' (role) — the same
 * account the operations API trusts. Used to gate the /ops workspace pages.
 */
export async function isStaffViewer(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return false;
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase
    .from("op_profiles")
    .select("is_admin, account_type")
    .eq("id", user.id)
    .maybeSingle();
  return Boolean(profile?.is_admin && profile.account_type === "staff");
}
