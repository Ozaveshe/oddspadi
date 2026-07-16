import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { isAllowedPushEndpoint, isValidPushKey } from "@/lib/security/pushSubscription";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { enforceUserRateLimit } from "@/lib/security/userRateLimit";
export const dynamic = "force-dynamic";

async function authClient() { const supabase = await createSupabaseServerClient(); if (!supabase) return { response: Response.json({ error: "Push notifications are not configured." }, { status: 503 }) }; const { data: { user } } = await supabase.auth.getUser(); if (!user) return { response: Response.json({ error: "Sign in to manage notifications." }, { status: 401 }) }; return { supabase, user }; }

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const ctx = await authClient(); if (ctx.response) return ctx.response;
  const rateLimit = await enforceUserRateLimit(ctx.supabase, "push_subscription"); if (rateLimit) return rateLimit;
  const { count, error: followError } = await ctx.supabase.from("op_followed_teams").select("team_id", { count: "exact", head: true }).eq("user_id", ctx.user.id);
  if (followError) return databaseUnavailable("push follow check", followError, "Could not verify your followed teams right now.");
  if (!count) return Response.json({ error: "Follow a team before enabling match alerts." }, { status: 400 });
  const parsed = await readBoundedJson<PushSubscriptionJSON>(request, 12_288);
  if (!parsed.ok) return parsed.response;
  const payload = parsed.value;
  const endpoint = payload?.endpoint; const p256dh = payload?.keys?.p256dh; const auth = payload?.keys?.auth;
  if (!isAllowedPushEndpoint(endpoint) || !isValidPushKey(p256dh, 40, 256) || !isValidPushKey(auth, 8, 128)) return Response.json({ error: "Invalid push subscription." }, { status: 400 });
  const { error } = await ctx.supabase.from("op_push_subscriptions").upsert({ user_id: ctx.user.id, endpoint, p256dh, auth, user_agent: request.headers.get("user-agent"), updated_at: new Date().toISOString() }, { onConflict: "endpoint" });
  if (error) return databaseUnavailable("push subscription upsert", error, "Could not enable alerts right now."); return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossSiteMutation(request); if (originError) return originError;
  const ctx = await authClient(); if (ctx.response) return ctx.response;
  const rateLimit = await enforceUserRateLimit(ctx.supabase, "push_subscription"); if (rateLimit) return rateLimit;
  const endpoint = new URL(request.url).searchParams.get("endpoint") ?? "";
  if (!isAllowedPushEndpoint(endpoint)) return Response.json({ error: "Missing subscription." }, { status: 400 });
  const { error } = await ctx.supabase.from("op_push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", ctx.user.id);
  if (error) return databaseUnavailable("push subscription delete", error, "Could not disable alerts right now."); return Response.json({ ok: true });
}
