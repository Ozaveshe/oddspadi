import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable, isMissingDatabaseRelation } from "@/lib/security/databaseError";
import { cleanExternalIdentifier, isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { parseCommunityTipDraft, boundedCommunityText } from "@/lib/community/predictionContracts";
import { prepareCommunityText } from "@/lib/community/textContent";

export const dynamic = "force-dynamic";

const TIP_SELECT = "id,author_id,fixture_id,sport,home_team,away_team,kickoff_at,market,selection,selection_label,market_line,tipped_odds,odds_source,canonical_selection_key,market_version,stake_units,rationale,rationale_updated_at,published_at,deleted_at,moderated_at,author:op_profiles!op_community_tips_author_id_fkey(username,display_name,avatar_url,account_type),revisions:op_community_tip_revisions(revision_kind,reason,created_at),settlement:op_community_tip_settlements(result,net_units,reason,settled_at)";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const fixtureId = url.searchParams.has("fixtureId") ? cleanExternalIdentifier(url.searchParams.get("fixtureId")) : null;
  const authorId = url.searchParams.get("authorId");
  if (url.searchParams.has("fixtureId") && !fixtureId) return privateJson({ error: "Invalid fixture." }, { status: 400 });
  if (authorId && !isUuid(authorId)) return privateJson({ error: "Invalid tipster." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ tips: [], note: "Community tips are not enabled yet." });
  // Deleted and moderated tips leave normal display; their settled results
  // stay in the accountable statistics views and the profile page tombstones.
  let query = supabase
    .from("op_community_tips")
    .select(TIP_SELECT)
    .is("deleted_at", null)
    .is("moderated_at", null)
    .order("published_at", { ascending: false })
    .limit(50);
  if (fixtureId) query = query.eq("fixture_id", fixtureId);
  if (authorId) query = query.eq("author_id", authorId);
  const { data, error } = await query;
  if (error && isMissingDatabaseRelation(error)) return privateJson({ tips: [], truthLane: "community-opinion", note: "Community tips are not enabled yet." });
  if (error) return databaseUnavailable("community tips read", error, "Community tips are temporarily unavailable.");
  return privateJson({ tips: data ?? [], truthLane: "community-opinion" });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community tips are not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to publish a community tip." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_tip"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<unknown>(request, 8_192);
  if (!parsed.ok) return parsed.response;
  const draft = parseCommunityTipDraft(parsed.value);
  if (!draft.ok) return privateJson({ error: draft.error }, { status: 400 });
  const { data, error } = await supabase.from("op_community_tips").insert({ author_id: user.id, ...draft.value }).select("id").single();
  if (error) return databaseUnavailable("community tip publish", error, "Could not publish that community tip right now.");
  return privateJson({ id: data.id, truthLane: "community-opinion" }, { status: 201 });
}

export async function PATCH(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community tips are not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to edit your commentary." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_tip"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<unknown>(request, 4_096);
  if (!parsed.ok) return parsed.response;
  const body = parsed.value as { tipId?: unknown; rationale?: unknown };
  if (!isUuid(body.tipId)) return privateJson({ error: "Invalid community tip." }, { status: 400 });
  const rationale = boundedCommunityText(typeof body.rationale === "string" ? prepareCommunityText(body.rationale) : body.rationale, 50, 2000);
  if (!rationale) return privateJson({ error: "Explain the match-specific reasoning in 50 to 2000 characters." }, { status: 400 });
  // Only commentary is editable; the DB grant plus freeze trigger make the
  // tracked market, odds, line and timestamps immutable for everyone.
  const { data, error } = await supabase
    .from("op_community_tips")
    .update({ rationale })
    .eq("id", body.tipId)
    .eq("author_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseUnavailable("community tip edit", error, "Could not update that commentary right now.");
  if (!data) return privateJson({ error: "Tip not found or already deleted." }, { status: 404 });
  return privateJson({ id: data.id, note: "Commentary updated. The tracked market, odds and timestamps stay as posted." });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community tips are not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to manage your tips." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_tip"); if (rateLimit) return rateLimit;
  const tipId = new URL(request.url).searchParams.get("tipId");
  if (!isUuid(tipId)) return privateJson({ error: "Invalid community tip." }, { status: 400 });
  // Soft delete: a tombstone hides the tip from normal display, but a validly
  // posted result is never erased from the accountable record.
  const { data, error } = await supabase
    .from("op_community_tips")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", tipId)
    .eq("author_id", user.id)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();
  if (error) return databaseUnavailable("community tip delete", error, "Could not delete that tip right now.");
  if (!data) return privateJson({ error: "Tip not found or already deleted." }, { status: 404 });
  return privateJson({ ok: true, note: "Tip removed from display. A settled result stays in your accountable record." });
}
