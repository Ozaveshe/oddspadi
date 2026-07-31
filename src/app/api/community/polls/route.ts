import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable, isMissingDatabaseRelation } from "@/lib/security/databaseError";
import { cleanExternalIdentifier, isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { parseCommunityPollVote } from "@/lib/community/predictionContracts";

export const dynamic = "force-dynamic";

const POLL_SELECT = "id,fixture_id,sport,home_label,draw_label,away_label,kickoff_at,status,home_votes,draw_votes,away_votes,updated_at";

/**
 * The fan pulse takes one tap from anyone; only the device key gates repeat
 * votes. Community tips stay account-only because they are an accountable
 * record — a pulse is a mood, and a sign-in wall on a mood widget is why the
 * poll tables sat empty for weeks. The key lives in an httpOnly cookie the
 * server mints, so page scripts never see it, and the guest table is only
 * reachable through a service-role RPC with its own throttle.
 */
const VOTER_COOKIE = "op_pulse_key";
const VOTER_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function voterKeyFrom(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === VOTER_COOKIE) {
      const value = rest.join("=").trim();
      return isUuid(value) ? value : null;
    }
  }
  return null;
}

function withVoterCookie(response: Response, voterKey: string): Response {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.headers.append(
    "Set-Cookie",
    `${VOTER_COOKIE}=${voterKey}; Path=/; Max-Age=${VOTER_COOKIE_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`
  );
  return response;
}

const GUEST_VOTE_ERRORS: Record<string, { message: string; status: number }> = {
  "invalid-request": { message: "Invalid vote.", status: 400 },
  "invalid-choice": { message: "Invalid vote.", status: 400 },
  "poll-missing": { message: "This poll is not open yet.", status: 404 },
  "poll-closed": { message: "Voting has closed for this match.", status: 409 },
  "rate-limited": { message: "Too many votes from this device. Please slow down.", status: 429 }
};

export async function GET(request: Request) {
  const fixtureId = cleanExternalIdentifier(new URL(request.url).searchParams.get("fixtureId"));
  if (!fixtureId) return privateJson({ error: "Invalid fixture." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ poll: null, note: "Community pulse is not enabled yet." });
  const { data: poll, error } = await supabase.from("op_match_polls").select(POLL_SELECT).eq("fixture_id", fixtureId).maybeSingle();
  if (error && isMissingDatabaseRelation(error)) return privateJson({ poll: null, viewerChoice: null, note: "Community pulse is not enabled yet." });
  if (error) return databaseUnavailable("community poll read", error, "Community pulse is temporarily unavailable.");
  if (!poll) return privateJson({ poll: null });
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: vote, error: voteError } = await supabase.from("op_match_poll_votes").select("choice").eq("poll_id", poll.id).eq("user_id", user.id).maybeSingle();
    if (voteError) return databaseUnavailable("community poll viewer vote", voteError, "Community pulse is temporarily unavailable.");
    return privateJson({ poll, viewerChoice: vote?.choice ?? null });
  }
  const voterKey = voterKeyFrom(request);
  const service = voterKey ? getSupabaseServerClient() : null;
  if (!voterKey || !service) return privateJson({ poll, viewerChoice: null });
  const { data: guestVote } = await service.from("op_match_poll_guest_votes").select("choice").eq("poll_id", poll.id).eq("voter_key", voterKey).maybeSingle();
  return privateJson({ poll, viewerChoice: guestVote?.choice ?? null });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  const parsed = await readBoundedJson<unknown>(request, 2_048);
  if (!parsed.ok) return parsed.response;
  const vote = parseCommunityPollVote(parsed.value);
  if (!vote.ok) return privateJson({ error: vote.error }, { status: 400 });

  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (user && supabase) {
    const rateLimit = await enforceUserRateLimit(supabase, "community_poll_vote"); if (rateLimit) return rateLimit;
    const { error } = await supabase.from("op_match_poll_votes").upsert(
      { poll_id: vote.value.pollId, user_id: user.id, choice: vote.value.choice },
      { onConflict: "poll_id,user_id" }
    );
    if (error) return databaseUnavailable("community poll vote", error, "Could not save that vote right now.");
    return privateJson({ ok: true, choice: vote.value.choice });
  }

  const service = getSupabaseServerClient();
  if (!service) return privateJson({ error: "Community pulse is not enabled yet." }, { status: 503 });
  const voterKey = voterKeyFrom(request) ?? crypto.randomUUID();
  const { data, error } = await service.rpc("op_cast_guest_poll_vote", {
    p_poll_id: vote.value.pollId,
    p_voter_key: voterKey,
    p_choice: vote.value.choice
  });
  if (error) return databaseUnavailable("guest poll vote", error, "Could not save that vote right now.");
  const row = (Array.isArray(data) ? data[0] : data) as { saved?: unknown; reason?: unknown } | null;
  if (!row || row.saved !== true) {
    const mapped = GUEST_VOTE_ERRORS[typeof row?.reason === "string" ? row.reason : ""] ?? { message: "Could not save that vote right now.", status: 502 };
    return privateJson({ error: mapped.message }, { status: mapped.status });
  }
  return withVoterCookie(privateJson({ ok: true, choice: vote.value.choice, guest: true }), voterKey);
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const pollId = new URL(request.url).searchParams.get("pollId");
  if (!isUuid(pollId)) return privateJson({ error: "Invalid poll." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = supabase ? await supabase.auth.getUser() : { data: { user: null } };
  if (user && supabase) {
    const rateLimit = await enforceUserRateLimit(supabase, "community_poll_vote"); if (rateLimit) return rateLimit;
    const { error } = await supabase.from("op_match_poll_votes").delete().eq("poll_id", pollId).eq("user_id", user.id);
    if (error) return databaseUnavailable("community poll vote removal", error, "Could not remove that vote right now.");
    return privateJson({ ok: true });
  }
  const voterKey = voterKeyFrom(request);
  if (!voterKey) return privateJson({ ok: true });
  const service = getSupabaseServerClient();
  if (!service) return privateJson({ error: "Community pulse is not enabled yet." }, { status: 503 });
  const { error } = await service.from("op_match_poll_guest_votes").delete().eq("poll_id", pollId).eq("voter_key", voterKey);
  if (error) return databaseUnavailable("guest poll vote removal", error, "Could not remove that vote right now.");
  return privateJson({ ok: true });
}
