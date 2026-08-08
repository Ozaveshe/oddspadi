import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { boundedCommunityText } from "@/lib/community/predictionContracts";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ actions: [], appeals: [] });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to see moderation decisions about your account." }, { status: 401 });
  const admin = getSupabaseServerClient();
  if (!admin) return privateJson({ actions: [], appeals: [] });
  const [{ data: actions, error: actionsError }, { data: appeals, error: appealsError }] = await Promise.all([
    admin
      .from("op_moderation_actions")
      .select("id, action, content_type, content_id, reason, created_at")
      .eq("target_user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("op_moderation_appeals")
      .select("id, action_id, body, status, created_at, resolved_at, resolution_note")
      .order("created_at", { ascending: false })
      .limit(50)
  ]);
  if (actionsError) return databaseUnavailable("moderation actions read", actionsError, "Moderation history is temporarily unavailable.");
  if (appealsError) return databaseUnavailable("appeals read", appealsError, "Appeals are temporarily unavailable.");
  return privateJson({ actions: actions ?? [], appeals: appeals ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Appeals are not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to appeal a moderation decision." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_appeal"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<{ actionId?: unknown; body?: unknown }>(request, 4_096);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  if (!isUuid(payload.actionId)) return privateJson({ error: "Invalid moderation action." }, { status: 400 });
  const body = boundedCommunityText(payload.body, 10, 1000);
  if (!body) return privateJson({ error: "Explain the appeal in 10 to 1000 characters." }, { status: 400 });
  const admin = getSupabaseServerClient();
  if (!admin) return privateJson({ error: "Appeals are not enabled yet." }, { status: 503 });
  // Only the person the action targeted may appeal it — verified server-side
  // before the service-role write.
  const { data: action, error: actionError } = await admin
    .from("op_moderation_actions")
    .select("id")
    .eq("id", payload.actionId)
    .eq("target_user_id", user.id)
    .maybeSingle();
  if (actionError) return databaseUnavailable("appeal action lookup", actionError, "Could not file that appeal right now.");
  if (!action) return privateJson({ error: "No moderation action of yours matches that reference." }, { status: 404 });
  const { data, error } = await admin
    .from("op_moderation_appeals")
    .insert({ action_id: payload.actionId, appellant_id: user.id, body })
    .select("id")
    .single();
  if (error && error.code === "23505") return privateJson({ ok: true, note: "Appeal already filed. A moderator will review it." });
  if (error) return databaseUnavailable("appeal create", error, "Could not file that appeal right now.");
  return privateJson({ id: data.id, note: "Appeal filed. A moderator who did not take the original action will review it." }, { status: 201 });
}
