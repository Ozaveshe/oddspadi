import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { normalizeFollowKey } from "@/lib/personal/preferences";

export const dynamic = "force-dynamic";

/**
 * Generic follows (sports, competitions, players) for signed-in users.
 * Team follows keep their own richer route against the catalogue
 * (/api/account/followed-teams); this one carries the name-keyed kinds.
 */

const KINDS = new Set(["sport", "competition", "player"]);

async function authClient() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { error: privateJson({ error: "Follows are not configured." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: privateJson({ error: "Sign in to follow." }, { status: 401 }) };
  return { supabase, user };
}

export async function GET() {
  const auth = await authClient();
  if (auth.error) {
    if (auth.error.status === 401) return privateJson({ follows: [], authenticated: false });
    return auth.error;
  }
  const { data, error } = await auth.supabase
    .from("op_follows")
    .select("entity_type,entity_key,display_name,created_at")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: false });
  if (error) return databaseUnavailable("follows read", error, "Follows are temporarily unavailable.");
  return privateJson(
    { authenticated: true, follows: data ?? [] },
    { headers: { "Cache-Control": "private, max-age=0, must-revalidate" } }
  );
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const auth = await authClient();
  if (auth.error) return auth.error;
  const rateLimit = await enforceUserRateLimit(auth.supabase, "follow_team");
  if (rateLimit) return rateLimit;

  const parsed = await readBoundedJson<{ entityType?: unknown; displayName?: unknown }>(request, 2_048);
  if (!parsed.ok) return parsed.response;
  const entityType = typeof parsed.value.entityType === "string" ? parsed.value.entityType : "";
  const displayName = typeof parsed.value.displayName === "string" ? parsed.value.displayName.trim() : "";
  if (!KINDS.has(entityType) || !displayName || displayName.length > 120) {
    return privateJson({ error: "Send an entityType (sport, competition or player) and a name." }, { status: 400 });
  }

  const { error } = await auth.supabase.from("op_follows").insert({
    user_id: auth.user.id,
    entity_type: entityType,
    entity_key: normalizeFollowKey(displayName),
    display_name: displayName
  });
  if (error && error.code !== "23505") return databaseUnavailable("follow", error, "Could not follow that right now.");
  return privateJson({ ok: true }, { status: error ? 200 : 201 });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const auth = await authClient();
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const entityType = url.searchParams.get("entityType") ?? "";
  const key = url.searchParams.get("key") ?? "";
  if (!KINDS.has(entityType) || !key || key.length > 120) {
    return privateJson({ error: "Name what to unfollow." }, { status: 400 });
  }
  const { error } = await auth.supabase
    .from("op_follows")
    .delete()
    .eq("user_id", auth.user.id)
    .eq("entity_type", entityType)
    .eq("entity_key", normalizeFollowKey(key));
  if (error) return databaseUnavailable("unfollow", error, "Could not unfollow right now.");
  return privateJson({ ok: true });
}
