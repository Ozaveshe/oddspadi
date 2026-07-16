import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { isAllowedPushEndpoint, isValidPushKey } from "../../src/lib/security/pushSubscription";

declare const Netlify: { env: { get(name: string): string | undefined } };

const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Follow = { user_id: string; team_id: string };
type Team = { id: string; external_id: string; name: string };
type Fixture = {
  external_id: string;
  kickoff_at: string;
  status: string;
  home_team_external_id: string;
  away_team_external_id: string;
  home_score: number | null;
  away_score: number | null;
  updated_at: string;
};

export async function runPushNotificationWorker({
  scheduleToken,
  adminToken,
  supabaseUrl,
  supabaseKey,
  vapidPublicKey,
  vapidPrivateKey,
  vapidSubject,
  now = new Date()
}: {
  scheduleToken: string | null;
  adminToken: string | null;
  supabaseUrl: string | null;
  supabaseKey: string | null;
  vapidPublicKey: string | null;
  vapidPrivateKey: string | null;
  vapidSubject: string | null;
  now?: Date;
}) {
  if (!adminToken || !scheduleToken || !tokenMatches(adminToken, scheduleToken)) {
    return Response.json({ success: false, error: "Push worker authorization failed." }, { status: 401 });
  }
  if (!supabaseUrl || !supabaseKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return Response.json({ success: false, error: "Push worker configuration is incomplete." }, { status: 503 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  const db = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const from = new Date(now.getTime() - 45 * 60_000).toISOString();
  const soon = new Date(now.getTime() + 20 * 60_000).toISOString();
  const [subscriptionResult, followResult, teamResult, kickoffResult, finishedResult] = await Promise.all([
    db.from("op_push_subscriptions").select("id,user_id,endpoint,p256dh,auth"),
    db.from("op_followed_teams").select("user_id,team_id"),
    db.from("op_teams").select("id,external_id,name"),
    db.from("op_fixtures").select("external_id,kickoff_at,status,home_team_external_id,away_team_external_id,home_score,away_score,updated_at").gte("kickoff_at", now.toISOString()).lte("kickoff_at", soon).in("status", ["scheduled", "not_started"]),
    db.from("op_fixtures").select("external_id,kickoff_at,status,home_team_external_id,away_team_external_id,home_score,away_score,updated_at").gte("updated_at", from).in("status", ["finished", "ft", "completed"])
  ]);

  const readError = [subscriptionResult, followResult, teamResult, kickoffResult, finishedResult].find((result) => result.error)?.error;
  if (readError) {
    console.error("[push-worker] source read failed", { code: readError.code ?? "unknown" });
    return Response.json({ success: false, error: "Push notification source data is unavailable." }, { status: 502 });
  }

  const subscriptions = (subscriptionResult.data ?? []) as Subscription[];
  const follows = (followResult.data ?? []) as Follow[];
  const teams = (teamResult.data ?? []) as Team[];
  const kickoff = (kickoffResult.data ?? []) as Fixture[];
  const finished = (finishedResult.data ?? []) as Fixture[];
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const teamByExternalId = new Map(teams.map((team) => [team.external_id, team]));
  const followedByUser = new Map<string, Set<string>>();

  for (const follow of follows) {
    const external = teamById.get(follow.team_id)?.external_id;
    if (!external) continue;
    const set = followedByUser.get(follow.user_id) ?? new Set<string>();
    set.add(external);
    followedByUser.set(follow.user_id, set);
  }

  const fixtures = [
    ...kickoff.map((fixture) => ({ fixture, kind: "kickoff" as const })),
    ...finished.map((fixture) => ({ fixture, kind: "full-time" as const }))
  ];
  let sent = 0;
  let removed = 0;
  let failed = 0;

  for (const subscription of subscriptions) {
    if (
      !isAllowedPushEndpoint(subscription.endpoint) ||
      !isValidPushKey(subscription.p256dh, 40, 256) ||
      !isValidPushKey(subscription.auth, 8, 128)
    ) {
      await db.from("op_push_subscriptions").delete().eq("id", subscription.id);
      removed++;
      continue;
    }

    for (const event of fixtures) {
      const followed = followedByUser.get(subscription.user_id);
      if (!followed?.has(event.fixture.home_team_external_id) && !followed?.has(event.fixture.away_team_external_id)) continue;

      const eventKey = `${event.kind}:${event.fixture.external_id}`;
      const { data: prior } = await db.from("op_push_notification_deliveries")
        .select("event_key")
        .eq("subscription_id", subscription.id)
        .eq("event_key", eventKey)
        .maybeSingle();
      if (prior) continue;

      const home = teamByExternalId.get(event.fixture.home_team_external_id)?.name ?? "Home";
      const away = teamByExternalId.get(event.fixture.away_team_external_id)?.name ?? "Away";
      const payload = event.kind === "kickoff"
        ? {
            title: "Kickoff soon, padi ⚽",
            body: `${home} vs ${away} starts shortly. Come see the match analysis.`,
            url: `/predictions/${encodeURIComponent(event.fixture.external_id)}`,
            tag: eventKey
          }
        : {
            title: "Full time ⚽",
            body: `${home} ${event.fixture.home_score ?? "–"}–${event.fixture.away_score ?? "–"} ${away}. See how the analysis landed.`,
            url: `/predictions/${encodeURIComponent(event.fixture.external_id)}`,
            tag: eventKey
          };

      try {
        await webpush.sendNotification(
          { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
          JSON.stringify(payload)
        );
        await db.from("op_push_notification_deliveries").insert({ subscription_id: subscription.id, event_key: eventKey });
        sent++;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.from("op_push_subscriptions").delete().eq("id", subscription.id);
          removed++;
          break;
        }
        failed++;
      }
    }
  }

  return Response.json({ success: failed === 0, sent, removed, failed, candidates: fixtures.length }, { status: failed === 0 ? 200 : 502 });
}

export default async function handler(request: Request, _context: Context) {
  return runPushNotificationWorker({
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    supabaseUrl: clean(Netlify.env.get("SUPABASE_URL")),
    supabaseKey: clean(Netlify.env.get("SUPABASE_SECRET_KEY")) ?? clean(Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY")),
    vapidPublicKey: clean(Netlify.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY")),
    vapidPrivateKey: clean(Netlify.env.get("VAPID_PRIVATE_KEY")),
    vapidSubject: clean(Netlify.env.get("VAPID_SUBJECT"))
  });
}
