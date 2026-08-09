import { createHash } from "node:crypto";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { actorTokenFingerprint } from "@/lib/security/adminStepUp";
import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";

/**
 * Staff gate for the operations workspace.
 *
 * Two callers exist: the scheduled case-sync and the ops scripts authenticate
 * with the shared admin bearer token; a signed-in staff member uses the
 * workspace UI with their session cookie. Either is acceptable — but a cookie
 * caller must be BOTH is_admin (the access control) AND account_type='staff'
 * (the role label), the same account the moderation queue trusts.
 *
 * The audit actor is a non-reversible fingerprint in both cases: the token
 * fingerprint for the machine path, a hash of the profile id for the UI path.
 * Fail closed: anything else is a non-revealing 401.
 */

export type StaffAuth = { ok: true; actorFingerprint: string } | { ok: false; response: Response };

function profileFingerprint(userId: string): string {
  return `usr:${createHash("sha256").update(userId).digest("hex").slice(0, 16)}`;
}

export async function requireStaff(request: Request): Promise<StaffAuth> {
  // 1) Machine path — the sweep worker and ops scripts.
  if (isCronAuthorized(request)) {
    return { ok: true, actorFingerprint: actorTokenFingerprint(request) };
  }

  // 2) Cookie path — a staff member in the workspace UI.
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    const {
      data: { user }
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("op_profiles")
        .select("is_admin, account_type")
        .eq("id", user.id)
        .maybeSingle();
      if (profile?.is_admin && profile.account_type === "staff") {
        return { ok: true, actorFingerprint: profileFingerprint(user.id) };
      }
    }
  }

  return { ok: false, response: privateJson({ error: "Staff access required." }, { status: 401 }) };
}
