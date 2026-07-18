import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable, isMissingDatabaseRelation } from "@/lib/security/databaseError";
import { cleanExternalIdentifier, isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { parseCommunityTipDraft } from "@/lib/community/predictionContracts";

export const dynamic = "force-dynamic";

const TIP_SELECT = "id,author_id,fixture_id,sport,home_team,away_team,kickoff_at,market,selection,selection_label,tipped_odds,stake_units,rationale,published_at,author:op_profiles!op_community_tips_author_id_fkey(username,display_name,avatar_url),revisions:op_community_tip_revisions(revision_kind,reason,created_at),settlement:op_community_tip_settlements(result,net_units,reason,settled_at)";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixtureId = url.searchParams.has("fixtureId") ? cleanExternalIdentifier(url.searchParams.get("fixtureId")) : null;
  const authorId = url.searchParams.get("authorId");
  if (url.searchParams.has("fixtureId") && !fixtureId) return Response.json({ error: "Invalid fixture." }, { status: 400 });
  if (authorId && !isUuid(authorId)) return Response.json({ error: "Invalid tipster." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ tips: [], note: "Community tips are not enabled yet." });
  let query = supabase.from("op_community_tips").select(TIP_SELECT).order("published_at", { ascending: false }).limit(50);
  if (fixtureId) query = query.eq("fixture_id", fixtureId);
  if (authorId) query = query.eq("author_id", authorId);
  const { data, error } = await query;
  if (error && isMissingDatabaseRelation(error)) return Response.json({ tips: [], truthLane: "community-opinion", note: "Community tips are not enabled yet." });
  if (error) return databaseUnavailable("community tips read", error, "Community tips are temporarily unavailable.");
  return Response.json({ tips: data ?? [], truthLane: "community-opinion" });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community tips are not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to publish a community tip." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_tip"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<unknown>(request, 8_192);
  if (!parsed.ok) return parsed.response;
  const draft = parseCommunityTipDraft(parsed.value);
  if (!draft.ok) return Response.json({ error: draft.error }, { status: 400 });
  const { data, error } = await supabase.from("op_community_tips").insert({ author_id: user.id, ...draft.value }).select("id").single();
  if (error) return databaseUnavailable("community tip publish", error, "Could not publish that community tip right now.");
  return Response.json({ id: data.id, truthLane: "community-opinion" }, { status: 201 });
}
