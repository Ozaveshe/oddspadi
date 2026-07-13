import { createSupabaseServerClient } from "@/lib/supabase/serverAuthClient";
export const dynamic = "force-dynamic";

async function authClient() { const supabase = await createSupabaseServerClient(); if (!supabase) return { response: Response.json({ error: "Push notifications are not configured." }, { status: 503 }) }; const { data: { user } } = await supabase.auth.getUser(); if (!user) return { response: Response.json({ error: "Sign in to manage notifications." }, { status: 401 }) }; return { supabase, user }; }

export async function POST(request: Request) {
  const ctx = await authClient(); if (ctx.response) return ctx.response;
  const { count } = await ctx.supabase.from("op_followed_teams").select("team_id", { count: "exact", head: true }).eq("user_id", ctx.user.id);
  if (!count) return Response.json({ error: "Follow a team before enabling match alerts." }, { status: 400 });
  const payload = (await request.json().catch(() => null)) as PushSubscriptionJSON | null;
  const endpoint = payload?.endpoint; const p256dh = payload?.keys?.p256dh; const auth = payload?.keys?.auth;
  if (!endpoint || !p256dh || !auth || endpoint.length > 2048) return Response.json({ error: "Invalid push subscription." }, { status: 400 });
  const { error } = await ctx.supabase.from("op_push_subscriptions").upsert({ user_id: ctx.user.id, endpoint, p256dh, auth, user_agent: request.headers.get("user-agent"), updated_at: new Date().toISOString() }, { onConflict: "endpoint" });
  if (error) return Response.json({ error: error.message }, { status: 400 }); return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  const ctx = await authClient(); if (ctx.response) return ctx.response; const endpoint = new URL(request.url).searchParams.get("endpoint") ?? "";
  if (!endpoint) return Response.json({ error: "Missing subscription." }, { status: 400 });
  const { error } = await ctx.supabase.from("op_push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", ctx.user.id);
  if (error) return Response.json({ error: error.message }, { status: 400 }); return Response.json({ ok: true });
}
