import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable, isMissingDatabaseRelation } from "@/lib/security/databaseError";
import { cleanExternalIdentifier, isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { parseCommunityPollVote } from "@/lib/community/predictionContracts";

export const dynamic = "force-dynamic";

const POLL_SELECT = "id,fixture_id,sport,home_label,draw_label,away_label,kickoff_at,status,home_votes,draw_votes,away_votes,updated_at";

export async function GET(request: Request) {
  const fixtureId = cleanExternalIdentifier(new URL(request.url).searchParams.get("fixtureId"));
  if (!fixtureId) return Response.json({ error: "Invalid fixture." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ poll: null, note: "Community pulse is not enabled yet." });
  const { data: poll, error } = await supabase.from("op_match_polls").select(POLL_SELECT).eq("fixture_id", fixtureId).maybeSingle();
  if (error && isMissingDatabaseRelation(error)) return Response.json({ poll: null, viewerChoice: null, note: "Community pulse is not enabled yet." });
  if (error) return databaseUnavailable("community poll read", error, "Community pulse is temporarily unavailable.");
  if (!poll) return Response.json({ poll: null });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ poll, viewerChoice: null });
  const { data: vote, error: voteError } = await supabase.from("op_match_poll_votes").select("choice").eq("poll_id", poll.id).eq("user_id", user.id).maybeSingle();
  if (voteError) return databaseUnavailable("community poll viewer vote", voteError, "Community pulse is temporarily unavailable.");
  return Response.json({ poll, viewerChoice: vote?.choice ?? null });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community pulse is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to vote." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_poll_vote"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<unknown>(request, 2_048);
  if (!parsed.ok) return parsed.response;
  const vote = parseCommunityPollVote(parsed.value);
  if (!vote.ok) return Response.json({ error: vote.error }, { status: 400 });
  const { error } = await supabase.from("op_match_poll_votes").upsert(
    { poll_id: vote.value.pollId, user_id: user.id, choice: vote.value.choice },
    { onConflict: "poll_id,user_id" }
  );
  if (error) return databaseUnavailable("community poll vote", error, "Could not save that vote right now.");
  return Response.json({ ok: true, choice: vote.value.choice });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const pollId = new URL(request.url).searchParams.get("pollId");
  if (!isUuid(pollId)) return Response.json({ error: "Invalid poll." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community pulse is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to remove a vote." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_poll_vote"); if (rateLimit) return rateLimit;
  const { error } = await supabase.from("op_match_poll_votes").delete().eq("poll_id", pollId).eq("user_id", user.id);
  if (error) return databaseUnavailable("community poll vote removal", error, "Could not remove that vote right now.");
  return Response.json({ ok: true });
}
