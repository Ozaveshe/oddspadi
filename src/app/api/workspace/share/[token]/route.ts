import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { shareSecret, verifyShareToken } from "@/lib/workspaceSync/shareToken";

export const dynamic = "force-dynamic";

/**
 * Reading a shared workspace.
 *
 * The token is verified before the database is touched; the row is then
 * checked for revocation and expiry independently, because the row is the
 * authority on whether the share is still meant to work. Responses are
 * uncacheable and explicitly non-indexable — a share link is a private
 * hand-off, not a public page.
 */

const SHARE_READ_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive"
};

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const secret = shareSecret();
  const service = getSupabaseServerClient();
  if (!secret || !service) {
    return privateJson({ error: "Sharing is not configured on this deployment." }, { status: 503, headers: SHARE_READ_HEADERS });
  }

  const verdict = verifyShareToken(token, secret, Date.now());
  if (!verdict.ok) {
    const message =
      verdict.reason === "expired"
        ? "This share link has expired."
        : "This share link could not be verified.";
    return privateJson({ error: message }, { status: verdict.reason === "expired" ? 410 : 403, headers: SHARE_READ_HEADERS });
  }

  const { data, error } = await service
    .from("op_workspace_shares")
    .select("payload,expires_at,revoked_at")
    .eq("share_id", verdict.shareId)
    .maybeSingle();
  if (error) return databaseUnavailable("workspace share read", error, "This share is temporarily unavailable.");
  if (!data) return privateJson({ error: "This share no longer exists." }, { status: 404, headers: SHARE_READ_HEADERS });
  if (data.revoked_at) return privateJson({ error: "This share link has been revoked." }, { status: 410, headers: SHARE_READ_HEADERS });
  if (Date.parse(String(data.expires_at)) <= Date.now()) {
    return privateJson({ error: "This share link has expired." }, { status: 410, headers: SHARE_READ_HEADERS });
  }

  return privateJson({ shared: data.payload }, { headers: SHARE_READ_HEADERS });
}
