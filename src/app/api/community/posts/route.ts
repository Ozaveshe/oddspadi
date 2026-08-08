import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { publicReadAbortSignal } from "@/lib/supabase/publicReadClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable, reportDatabaseError } from "@/lib/security/databaseError";
import { cleanExternalIdentifier, isIsoTimestampCursor, isUuid } from "@/lib/security/inputValidation";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
import { prepareCommunityText } from "@/lib/community/textContent";
import { assessCommunityText } from "@/lib/community/contentSafety";
import { parseCommunitySubject } from "@/lib/community/subjects";

export const dynamic = "force-dynamic";

// op_feed_post_likes doubles as a many-to-many join between posts and profiles,
// so the author embed must name its FK or PostgREST rejects it as ambiguous.
const POST_SELECT = "id, author_id, body, match_id, created_at, author:op_profiles!op_feed_posts_author_id_fkey(username, display_name, avatar_url, account_type), likes:op_feed_post_likes(user_id), comments:op_feed_comments!op_feed_comments_post_id_fkey(count)";
const COMMUNITY_READ_UNAVAILABLE_NOTE = "Community posts are temporarily unavailable. Please try again shortly.";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ posts: [] });
  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor && !isIsoTimestampCursor(cursor)) return privateJson({ error: "Invalid cursor." }, { status: 400 });
    let query = supabase
      .from("op_feed_posts")
      .select(POST_SELECT)
      .order("created_at", { ascending: false })
      .limit(21);
    if (cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query.abortSignal(publicReadAbortSignal());
    if (error) {
      reportDatabaseError("community posts read", error);
      return privateJson({ posts: [], note: COMMUNITY_READ_UNAVAILABLE_NOTE });
    }
    let rows = data ?? [];
    // A signed-in viewer never sees authors they blocked.
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: blocks } = await supabase
        .from("op_user_blocks")
        .select("blocked_id")
        .eq("blocker_id", user.id)
        .limit(500);
      const blocked = new Set((blocks ?? []).map((block) => String(block.blocked_id)));
      if (blocked.size) rows = rows.filter((row) => !blocked.has(String(row.author_id)));
    }
    return privateJson({ posts: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]?.created_at : null });
  } catch {
    return privateJson({ posts: [], note: COMMUNITY_READ_UNAVAILABLE_NOTE });
  }
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to delete a post." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_post"); if (rateLimit) return rateLimit;
  const postId = new URL(request.url).searchParams.get("postId") ?? "";
  if (!isUuid(postId)) return privateJson({ error: "Missing post." }, { status: 400 });
  // RLS is the final ownership check; author_id also avoids ambiguous success.
  const { error } = await supabase.from("op_feed_posts").delete().eq("id", postId).eq("author_id", user.id);
  if (error) return databaseUnavailable("community post delete", error, "Could not delete that post right now.");
  return privateJson({ ok: true });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community is not enabled yet." }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to post." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_post"); if (rateLimit) return rateLimit;

  const parsed = await readBoundedJson<{ body?: unknown; matchId?: unknown; subjectType?: unknown; subjectId?: unknown }>(request, 8_192);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const body = typeof payload.body === "string" ? prepareCommunityText(payload.body) : "";
  if (!body || body.length > 2000) {
    return privateJson({ error: "A post must be between 1 and 2000 characters." }, { status: 400 });
  }
  const safety = assessCommunityText(body);
  if (!safety.allowed) return privateJson({ error: safety.reasons[0] }, { status: 400 });
  const matchId = cleanExternalIdentifier(payload.matchId);
  // Canonical context: an explicit subject wins; a match id is a fixture subject.
  const subject =
    parseCommunitySubject({ subjectType: payload.subjectType, subjectId: payload.subjectId }) ??
    (matchId ? ({ subject_type: "fixture", subject_id: matchId } as const) : null);

  // RLS enforces author_id = auth.uid() on insert.
  const { data, error } = await supabase
    .from("op_feed_posts")
    .insert({
      author_id: user.id,
      body,
      match_id: subject?.subject_type === "fixture" ? subject.subject_id : matchId,
      subject_type: subject?.subject_type ?? null,
      subject_id: subject?.subject_id ?? null
    })
    .select("id")
    .single();

  if (error) return databaseUnavailable("community post create", error, "Could not publish that post right now.");
  return privateJson({ id: data.id }, { status: 201 });
}
