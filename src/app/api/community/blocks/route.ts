import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { privateJson } from "@/lib/security/privateJson";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { isUuid } from "@/lib/security/inputValidation";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ blocks: [] });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to manage blocks." }, { status: 401 });
  const { data, error } = await supabase
    .from("op_user_blocks")
    .select("blocked_id, created_at")
    .eq("blocker_id", user.id)
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return databaseUnavailable("community blocks read", error, "Blocks are temporarily unavailable.");
  return privateJson({ blocks: data ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Blocking is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to block a user." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_block"); if (rateLimit) return rateLimit;
  const parsed = await readBoundedJson<{ blockedId?: unknown }>(request, 1_024);
  if (!parsed.ok) return parsed.response;
  const blockedId = parsed.value.blockedId;
  if (!isUuid(blockedId)) return privateJson({ error: "Invalid user." }, { status: 400 });
  if (blockedId === user.id) return privateJson({ error: "You cannot block yourself." }, { status: 400 });
  const { error } = await supabase.from("op_user_blocks").insert({ blocker_id: user.id, blocked_id: blockedId });
  if (error && error.code === "23505") return privateJson({ ok: true, note: "Already blocked." });
  if (error) return databaseUnavailable("community block create", error, "Could not block that user right now.");
  return privateJson({ ok: true, note: "Blocked. Their posts and comments will no longer appear for you." }, { status: 201 });
}

export async function DELETE(request: Request): Promise<Response> {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const supabase = await createSupabaseServerClient();
  if (!supabase) return privateJson({ error: "Blocking is not enabled yet." }, { status: 503 });
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return privateJson({ error: "Sign in to manage blocks." }, { status: 401 });
  const rateLimit = await enforceUserRateLimit(supabase, "community_block"); if (rateLimit) return rateLimit;
  const blockedId = new URL(request.url).searchParams.get("blockedId");
  if (!isUuid(blockedId)) return privateJson({ error: "Invalid user." }, { status: 400 });
  const { error } = await supabase.from("op_user_blocks").delete().eq("blocker_id", user.id).eq("blocked_id", blockedId);
  if (error) return databaseUnavailable("community block delete", error, "Could not unblock that user right now.");
  return privateJson({ ok: true });
}
