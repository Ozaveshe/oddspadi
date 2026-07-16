import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable, reportDatabaseError } from "@/lib/security/databaseError";

export const dynamic = "force-dynamic";

// The author embed must name its FK: op_feed_comments carries FKs to both
// op_feed_posts and op_profiles, so bare embeds are ambiguous to PostgREST.
const COMMENT_SELECT = "id, post_id, author_id, body, created_at, author:op_profiles!op_feed_comments_author_id_fkey(username, display_name)";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ comments: [] });
  const postId = new URL(request.url).searchParams.get("postId") ?? "";
  if (!UUID.test(postId)) return Response.json({ error: "Missing post." }, { status: 400 });
  const { data, error } = await supabase
    .from("op_feed_comments")
    .select(COMMENT_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(100);
  if (error) {
    reportDatabaseError("community comments read", error);
    return Response.json({ comments: [], note: "Comments are temporarily unavailable." });
  }
  return Response.json({ comments: data ?? [] });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to comment." }, { status: 401 });

  const payload = (await request.json().catch(() => ({}))) as { postId?: unknown; body?: unknown };
  const postId = typeof payload.postId === "string" ? payload.postId : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!UUID.test(postId)) return Response.json({ error: "Missing post." }, { status: 400 });
  if (!body || body.length > 1000) return Response.json({ error: "A comment must be between 1 and 1000 characters." }, { status: 400 });

  // RLS enforces author_id = auth.uid() on insert.
  const { data, error } = await supabase
    .from("op_feed_comments")
    .insert({ post_id: postId, author_id: user.id, body })
    .select(COMMENT_SELECT)
    .single();
  if (error) return databaseUnavailable("community comment create", error, "Could not publish that comment right now.");
  return Response.json({ comment: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return Response.json({ error: "Community is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Sign in to delete a comment." }, { status: 401 });
  const commentId = new URL(request.url).searchParams.get("commentId") ?? "";
  if (!UUID.test(commentId)) return Response.json({ error: "Missing comment." }, { status: 400 });
  // RLS is the final ownership check; author_id also avoids ambiguous success.
  const { error } = await supabase.from("op_feed_comments").delete().eq("id", commentId).eq("author_id", user.id);
  if (error) return databaseUnavailable("community comment delete", error, "Could not delete that comment right now.");
  return Response.json({ ok: true });
}
