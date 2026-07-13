import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";

export const dynamic = "force-dynamic";

async function authenticated() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { response: Response.json({ error: "Community is not enabled yet." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: Response.json({ error: "Sign in to like posts." }, { status: 401 }) };
  return { supabase, user };
}

export async function POST(request: Request) {
  const auth = await authenticated(); if (auth.response) return auth.response;
  const payload = (await request.json().catch(() => ({}))) as { postId?: unknown };
  const postId = typeof payload.postId === "string" ? payload.postId : "";
  if (!postId) return Response.json({ error: "Missing post." }, { status: 400 });
  const { error } = await auth.supabase.from("op_feed_post_likes").insert({ post_id: postId, user_id: auth.user.id });
  if (error && error.code !== "23505") return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const auth = await authenticated(); if (auth.response) return auth.response;
  const postId = new URL(request.url).searchParams.get("postId") ?? "";
  if (!postId) return Response.json({ error: "Missing post." }, { status: 400 });
  const { error } = await auth.supabase.from("op_feed_post_likes").delete().eq("post_id", postId).eq("user_id", auth.user.id);
  if (error) return Response.json({ error: error.message }, { status: 400 });
  return Response.json({ ok: true });
}
