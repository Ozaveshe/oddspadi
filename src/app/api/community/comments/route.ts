import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable, reportDatabaseError } from "@/lib/security/databaseError";
import { isIsoTimestampCursor, isUuid } from "@/lib/security/inputValidation";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";

export const dynamic = "force-dynamic";

// The author embed must name its FK: op_feed_comments carries FKs to both
// op_feed_posts and op_profiles, so bare embeds are ambiguous to PostgREST.
const COMMENT_SELECT = "id, post_id, author_id, body, created_at, author:op_profiles!op_feed_comments_author_id_fkey(username, display_name)";

const COMMENT_PAGE_SIZE = 100;

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ comments: [] });
  const params = new URL(request.url).searchParams;
  const postId = params.get("postId") ?? "";
  if (!isUuid(postId)) return privateJson({ error: "Missing post." }, { status: 400 });

  const cursor = params.get("cursor");
  if (cursor && !isIsoTimestampCursor(cursor)) return privateJson({ error: "Invalid cursor." }, { status: 400 });

  // A hard `.limit(100)` silently dropped every comment past the hundredth,
  // with nothing in the payload to say more existed. Fetch one extra row to
  // detect the overflow, then hand back a cursor so the thread can continue.
  let query = supabase
    .from("op_feed_comments")
    .select(COMMENT_SELECT)
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(COMMENT_PAGE_SIZE + 1);
  if (cursor) query = query.gt("created_at", cursor);

  const { data, error } = await query;
  if (error) {
    reportDatabaseError("community comments read", error);
    return privateJson({ comments: [], note: "Comments are temporarily unavailable." });
  }

  const rows = data ?? [];
  const comments = rows.slice(0, COMMENT_PAGE_SIZE);
  return privateJson({
    comments,
    nextCursor: rows.length > COMMENT_PAGE_SIZE ? comments.at(-1)?.created_at ?? null : null
  });
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to comment." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_comment"); if (rateLimit) return rateLimit;

  const parsed = await readBoundedJson<{ postId?: unknown; body?: unknown }>(request, 8_192);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const postId = typeof payload.postId === "string" ? payload.postId : "";
  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!isUuid(postId)) return privateJson({ error: "Missing post." }, { status: 400 });
  if (!body || body.length > 1000) return privateJson({ error: "A comment must be between 1 and 1000 characters." }, { status: 400 });

  // RLS enforces author_id = auth.uid() on insert.
  const { data, error } = await supabase
    .from("op_feed_comments")
    .insert({ post_id: postId, author_id: user.id, body })
    .select(COMMENT_SELECT)
    .single();
  if (error) return databaseUnavailable("community comment create", error, "Could not publish that comment right now.");
  return privateJson({ comment: data }, { status: 201 });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Community is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to delete a comment." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_comment"); if (rateLimit) return rateLimit;
  const commentId = new URL(request.url).searchParams.get("commentId") ?? "";
  if (!isUuid(commentId)) return privateJson({ error: "Missing comment." }, { status: 400 });
  // RLS is the final ownership check; author_id also avoids ambiguous success.
  const { error } = await supabase.from("op_feed_comments").delete().eq("id", commentId).eq("author_id", user.id);
  if (error) return databaseUnavailable("community comment delete", error, "Could not delete that comment right now.");
  return privateJson({ ok: true });
}
