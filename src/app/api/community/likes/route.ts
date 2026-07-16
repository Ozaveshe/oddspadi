import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { readBoundedJson } from "@/lib/security/boundedJson";

export const dynamic = "force-dynamic";

async function authenticated() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return { response: Response.json({ error: "Community is not enabled yet." }, { status: 503 }) };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { response: Response.json({ error: "Sign in to like posts." }, { status: 401 }) };
  return { supabase, user };
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const auth = await authenticated(); if (auth.response) return auth.response;
  const parsed = await readBoundedJson<{ postId?: unknown }>(request, 2_048);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const postId = typeof payload.postId === "string" ? payload.postId : "";
  if (!isUuid(postId)) return Response.json({ error: "Missing post." }, { status: 400 });
  const { error } = await auth.supabase.from("op_feed_post_likes").insert({ post_id: postId, user_id: auth.user.id });
  if (error && error.code !== "23505") return databaseUnavailable("community like create", error, "Could not like that post right now.");
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const auth = await authenticated(); if (auth.response) return auth.response;
  const postId = new URL(request.url).searchParams.get("postId") ?? "";
  if (!isUuid(postId)) return Response.json({ error: "Missing post." }, { status: 400 });
  const { error } = await auth.supabase.from("op_feed_post_likes").delete().eq("post_id", postId).eq("user_id", auth.user.id);
  if (error) return databaseUnavailable("community like delete", error, "Could not remove that like right now.");
  return Response.json({ ok: true });
}
