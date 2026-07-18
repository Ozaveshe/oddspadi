import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { parseCommunityTipRevision } from "@/lib/community/predictionContracts";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community tips are not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to amend a community tip." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_tip"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<unknown>(request, 2_048);
  if (!parsed.ok) return parsed.response;
  const revision = parseCommunityTipRevision(parsed.value);
  if (!revision.ok) return Response.json({ error: revision.error }, { status: 400 });
  const { data, error } = await supabase.from("op_community_tip_revisions").insert({
    tip_id: revision.value.tipId,
    author_id: user.id,
    revision_kind: revision.value.revisionKind,
    reason: revision.value.reason
  }).select("id").single();
  if (error) return databaseUnavailable("community tip revision", error, "Could not add that tip note right now.");
  return Response.json({ id: data.id }, { status: 201 });
}
