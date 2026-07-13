import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
declare const Netlify: { env: { get(name: string): string | undefined } };
const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (a: string, b: string) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Follow = { user_id: string; team_id: string };
type Team = { id: string; external_id: string; name: string };
type Fixture = { external_id: string; kickoff_at: string; status: string; home_team_external_id: string; away_team_external_id: string; home_score: number | null; away_score: number | null; updated_at: string };

export async function runPushNotificationWorker({ scheduleToken, adminToken, supabaseUrl, supabaseKey, vapidPublicKey, vapidPrivateKey, vapidSubject, now = new Date() }: { scheduleToken: string | null; adminToken: string | null; supabaseUrl: string | null; supabaseKey: string | null; vapidPublicKey: string | null; vapidPrivateKey: string | null; vapidSubject: string | null; now?: Date }) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) return Response.json({ success: false, error: "Push worker authorization failed." }, { status: 401 });
  if (!supabaseUrl || !supabaseKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) return Response.json({ success: false, error: "Push worker configuration is incomplete." }, { status: 503 });
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const from = new Date(now.getTime() - 45 * 60_000).toISOString(); const soon = new Date(now.getTime() + 20 * 60_000).toISOString();
  const [{ data: subscriptions }, { data: follows }, { data: teams }, { data: kickoff }, { data: finished }] = await Promise.all([
    db.from("op_push_subscriptions").select("id,user_id,endpoint,p256dh,auth"), db.from("op_followed_teams").select("user_id,team_id"), db.from("op_teams").select("id,external_id,name"),
    db.from("op_fixtures").select("external_id,kickoff_at,status,home_team_external_id,away_team_external_id,home_score,away_score,updated_at").gte("kickoff_at", now.toISOString()).lte("kickoff_at", soon).in("status", ["scheduled", "not_started"]),
    db.from("op_fixtures").select("external_id,kickoff_at,status,home_team_external_id,away_team_external_id,home_score,away_score,updated_at").gte("updated_at", from).in("status", ["finished", "ft", "completed"])
  ]);
  const teamMap = new Map((teams as Team[] | null ?? []).map((team) => [team.id, team])); const followedByUser = new Map<string, Set<string>>();
  for (const follow of follows as Follow[] | null ?? []) { const external = teamMap.get(follow.team_id)?.external_id; if (external) { const set = followedByUser.get(follow.user_id) ?? new Set<string>(); set.add(external); followedByUser.set(follow.user_id, set); } }
  let sent = 0; let removed = 0; const fixtures = [...(kickoff as Fixture[] | null ?? []).map((fixture) => ({ fixture, kind: "kickoff" as const })), ...(finished as Fixture[] | null ?? []).map((fixture) => ({ fixture, kind: "full-time" as const }))];
  for (const subscription of subscriptions as Subscription[] | null ?? []) for (const event of fixtures) {
    const followed = followedByUser.get(subscription.user_id); if (!followed?.has(event.fixture.home_team_external_id) && !followed?.has(event.fixture.away_team_external_id)) continue;
    const eventKey = `${event.kind}:${event.fixture.external_id}`; const { data: prior } = await db.from("op_push_notification_deliveries").select("event_key").eq("subscription_id", subscription.id).eq("event_key", eventKey).maybeSingle(); if (prior) continue;
    const home = [...teamMap.values()].find((team) => team.external_id === event.fixture.home_team_external_id)?.name ?? "Home"; const away = [...teamMap.values()].find((team) => team.external_id === event.fixture.away_team_external_id)?.name ?? "Away";
    const payload = event.kind === "kickoff" ? { title: "Kickoff soon, padi ⚽", body: `${home} vs ${away} starts shortly. Come see the match analysis.`, url: `/predictions/${encodeURIComponent(event.fixture.external_id)}`, tag: eventKey } : { title: "Full time ⚽", body: `${home} ${event.fixture.home_score ?? "–"}–${event.fixture.away_score ?? "–"} ${away}. See how the analysis landed.`, url: `/predictions/${encodeURIComponent(event.fixture.external_id)}`, tag: eventKey };
    try { await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify(payload)); await db.from("op_push_notification_deliveries").insert({ subscription_id: subscription.id, event_key: eventKey }); sent++; }
    catch (error) { const status = (error as { statusCode?: number }).statusCode; if (status === 404 || status === 410) { await db.from("op_push_subscriptions").delete().eq("id", subscription.id); removed++; } }
  }
  return Response.json({ success: true, sent, removed, candidates: fixtures.length });
}

export default async function handler(request: Request, _context: Context) { return runPushNotificationWorker({ scheduleToken: request.headers.get("x-oddspadi-schedule-token"), adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")), supabaseUrl: clean(Netlify.env.get("SUPABASE_URL")), supabaseKey: clean(Netlify.env.get("SUPABASE_SECRET_KEY")) ?? clean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")), vapidPublicKey: clean(Netlify.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY")), vapidPrivateKey: clean(Netlify.env.get("VAPID_PRIVATE_KEY")), vapidSubject: clean(Netlify.env.get("VAPID_SUBJECT")) }); }
