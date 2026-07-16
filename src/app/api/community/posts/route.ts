import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { publicReadAbortSignal } from "@/lib/supabase/publicReadClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable, reportDatabaseError } from "@/lib/security/databaseError";
import { cleanExternalIdentifier, isIsoTimestampCursor, isUuid } from "@/lib/security/inputValidation";

export const dynamic = "force-dynamic";

// op_feed_post_likes doubles as a many-to-many join between posts and profiles,
// so the author embed must name its FK or PostgREST rejects it as ambiguous.
const POST_SELECT = "id, author_id, body, match_id, created_at, author:op_profiles!op_feed_posts_author_id_fkey(username, display_name, avatar_url), likes:op_feed_post_likes(user_id), comments:op_feed_comments!op_feed_comments_post_id_fkey(count)";
const COMMUNITY_READ_UNAVAILABLE_NOTE = "Community posts are temporarily unavailable. Please try again shortly.";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ posts: [] });
  try {
    const cursor = new URL(request.url).searchParams.get("cursor");
    if (cursor && !isIsoTimestampCursor(cursor)) return Response.json({ error: "Invalid cursor." }, { status: 400 });
    let query = supabase
      .from("op_feed_posts")
      .select(POST_SELECT)
      .order("created_at", { ascending: false })
      .limit(21);
    if (cursor) query = query.lt("created_at", cursor);
    const { data, error } = await query.abortSignal(publicReadAbortSignal());
    if (error) {
      reportDatabaseError("community posts read", error);
      return Response.json({ posts: [], note: COMMUNITY_READ_UNAVAILABLE_NOTE });
    }
    const rows = data ?? [];
    return Response.json({ posts: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]?.created_at : null });
  } catch {
    return Response.json({ posts: [], note: COMMUNITY_READ_UNAVAILABLE_NOTE });
  }
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to delete a post." }, { status: 401 });
  const postId = new URL(request.url).searchParams.get("postId") ?? "";
  if (!isUuid(postId)) return Response.json({ error: "Missing post." }, { status: 400 });
  // RLS is the final ownership check; author_id also avoids ambiguous success.
  const { error } = await supabase.from("op_feed_posts").delete().eq("id", postId).eq("author_id", user.id);
  if (error) return databaseUnavailable("community post delete", error, "Could not delete that post right now.");
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community is not enabled yet." }, { status: 503 });

  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to post." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { body?: unknown; matchId?: unknown };
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body || body.length > 2000) {
    return Response.json({ error: "A post must be between 1 and 2000 characters." }, { status: 400 });
  }
  const matchId = cleanExternalIdentifier(payload.matchId);

  // RLS enforces author_id = auth.uid() on insert.
  const { data, error } = await supabase
    .from("op_feed_posts")
    .insert({ author_id: user.id, body, match_id: matchId })
    .select("id")
    .single();

  if (error) return databaseUnavailable("community post create", error, "Could not publish that post right now.");
  return Response.json({ id: data.id }, { status: 201 });
}
