import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { isAllowedPushEndpoint, isValidPushKey } from "../../src/lib/security/pushSubscription";
import {
  decideAlert,
  officialPublicationCopy,
  type AlertEvent,
  type AlertPreferences,
  type AlertType
} from "../../src/lib/personal/alertPolicy";

declare const Netlify: { env: { get(name: string): string | undefined } };

const clean = (value?: string | null) => value?.trim() || null;
const tokenMatches = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

// `op_fixtures.status` stores the normalised MatchStatus union, not the raw
// provider string. The previous filters also listed "not_started", "ft" and
// "completed", none of which the column can ever hold — dead entries that read
// as coverage while matching nothing.
const KICKOFF_STATUSES = ["scheduled"] as const;
const FINISHED_STATUSES = ["finished"] as const;

// Ceilings for one sweep. The sweep runs every ten minutes, so anything not
// covered by this pass is picked up by the next one rather than being lost.
const MAX_SUBSCRIPTIONS_PER_SWEEP = 2_000;
const MAX_FOLLOW_ROWS = 20_000;
const MAX_TEAM_ROWS = 10_000;

type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string };
type Follow = { user_id: string; team_id: string };
type Team = { id: string; external_id: string; name: string };

/**
 * What a subscriber without an op_alert_preferences row gets: exactly what
 * the push opt-in promised when they granted it — kickoff and full-time for
 * followed teams. Anything newer (publication alerts, movement alerts)
 * requires an explicit preferences row; consent to the old thing is not
 * consent to the new one.
 */
const LEGACY_DEFAULT_PREFERENCES: AlertPreferences = {
  channels: ["push"],
  enabledTypes: ["fixture_start", "final_result"],
  quietHours: null,
  timezone: "Africa/Lagos",
  sportSettings: {},
  competitionSettings: {},
  maxAlertsPerDay: 10
};

type PreferenceRow = {
  user_id: string;
  channels: unknown;
  enabled_types: unknown;
  quiet_hours: unknown;
  timezone: unknown;
  sport_settings: unknown;
  competition_settings: unknown;
  max_alerts_per_day: unknown;
};

function toPreferences(row: PreferenceRow): AlertPreferences {
  const quiet = row.quiet_hours as { start?: unknown; end?: unknown } | null;
  return {
    channels: Array.isArray(row.channels) ? (row.channels as AlertPreferences["channels"]) : [],
    enabledTypes: Array.isArray(row.enabled_types) ? (row.enabled_types as AlertType[]) : [],
    quietHours:
      quiet && typeof quiet.start === "string" && typeof quiet.end === "string"
        ? { start: quiet.start, end: quiet.end }
        : null,
    timezone: typeof row.timezone === "string" ? row.timezone : "Africa/Lagos",
    sportSettings: (row.sport_settings ?? {}) as Record<string, boolean>,
    competitionSettings: (row.competition_settings ?? {}) as Record<string, boolean>,
    maxAlertsPerDay: Number(row.max_alerts_per_day) || 10
  };
}
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
  const [subscriptionResult, followResult, teamResult, kickoffResult, finishedResult, preferenceResult, publicationResult] = await Promise.all([
    // These reads were unbounded. A scheduled function has a hard wall-clock
    // budget, so "select every row" stops working long before the product
    // does — an explicit ceiling fails visibly instead of timing out.
    db.from("op_push_subscriptions").select("id,user_id,endpoint,p256dh,auth").limit(MAX_SUBSCRIPTIONS_PER_SWEEP),
    db.from("op_followed_teams").select("user_id,team_id").limit(MAX_FOLLOW_ROWS),
    db.from("op_teams").select("id,external_id,name").limit(MAX_TEAM_ROWS),
    db.from("op_fixtures").select("external_id,kickoff_at,status,home_team_external_id,away_team_external_id,home_score,away_score,updated_at").gte("kickoff_at", now.toISOString()).lte("kickoff_at", soon).in("status", KICKOFF_STATUSES),
    db.from("op_fixtures").select("external_id,kickoff_at,status,home_team_external_id,away_team_external_id,home_score,away_score,updated_at").gte("updated_at", from).in("status", FINISHED_STATUSES),
    db.from("op_alert_preferences").select("user_id,channels,enabled_types,quiet_hours,timezone,sport_settings,competition_settings,max_alerts_per_day").limit(MAX_SUBSCRIPTIONS_PER_SWEEP),
    db.from("op_publications").select("id,fixture_external_id,sport,competition,selection_label,published_at").gte("published_at", from).in("publication_status", ["published"]).limit(200)
  ]);

  const readError = [subscriptionResult, followResult, teamResult, kickoffResult, finishedResult, preferenceResult, publicationResult].find((result) => result.error)?.error;
  if (readError) {
    console.error("[push-worker] source read failed", { code: readError.code ?? "unknown" });
    return Response.json({ success: false, error: "Push notification source data is unavailable." }, { status: 502 });
  }

  const subscriptions = (subscriptionResult.data ?? []) as Subscription[];
  const follows = (followResult.data ?? []) as Follow[];
  const teams = (teamResult.data ?? []) as Team[];
  const kickoff = (kickoffResult.data ?? []) as Fixture[];
  const finished = (finishedResult.data ?? []) as Fixture[];
  const preferenceRows = (preferenceResult.data ?? []) as PreferenceRow[];
  const publications = (publicationResult.data ?? []) as Array<{
    id: string;
    fixture_external_id: string | null;
    sport: string | null;
    competition: string | null;
    selection_label: string | null;
    published_at: string | null;
  }>;
  const teamById = new Map(teams.map((team) => [team.id, team]));
  const teamByExternalId = new Map(teams.map((team) => [team.external_id, team]));
  const followedByUser = new Map<string, Set<string>>();
  const preferencesByUser = new Map(preferenceRows.map((row) => [row.user_id, toPreferences(row)]));

  for (const follow of follows) {
    const external = teamById.get(follow.team_id)?.external_id;
    if (!external) continue;
    const set = followedByUser.get(follow.user_id) ?? new Set<string>();
    set.add(external);
    followedByUser.set(follow.user_id, set);
  }

  // Publication alerts key on the publication's fixture, whose row may sit
  // outside both fixture windows — fetch the missing ones in one read.
  const publicationFixtureIds = [
    ...new Set(publications.map((row) => row.fixture_external_id).filter((value): value is string => Boolean(value)))
  ];
  const knownFixtures = new Map([...kickoff, ...finished].map((fixture) => [fixture.external_id, fixture]));
  const missingIds = publicationFixtureIds.filter((id) => !knownFixtures.has(id));
  if (missingIds.length) {
    const { data: extraFixtures } = await db
      .from("op_fixtures")
      .select("external_id,kickoff_at,status,home_team_external_id,away_team_external_id,home_score,away_score,updated_at")
      .in("external_id", missingIds.slice(0, 200));
    for (const fixture of (extraFixtures ?? []) as Fixture[]) knownFixtures.set(fixture.external_id, fixture);
  }

  type SweepEvent = {
    kind: "kickoff" | "full-time" | "publication";
    fixture: Fixture;
    alertEvent: AlertEvent;
    publication?: { id: string; selectionLabel: string };
  };

  const fixtures: SweepEvent[] = [
    ...kickoff.map((fixture) => ({
      fixture,
      kind: "kickoff" as const,
      alertEvent: {
        type: "fixture_start" as const,
        fixtureExternalId: fixture.external_id,
        publicationId: null,
        competition: null,
        sport: "football",
        occurredAt: fixture.kickoff_at
      }
    })),
    ...finished.map((fixture) => ({
      fixture,
      kind: "full-time" as const,
      alertEvent: {
        type: "final_result" as const,
        fixtureExternalId: fixture.external_id,
        publicationId: null,
        competition: null,
        sport: "football",
        occurredAt: fixture.updated_at
      }
    })),
    ...publications.flatMap((publication) => {
      const fixture = publication.fixture_external_id ? knownFixtures.get(publication.fixture_external_id) : undefined;
      if (!fixture || !publication.published_at) return [];
      return [
        {
          fixture,
          kind: "publication" as const,
          publication: { id: publication.id, selectionLabel: publication.selection_label ?? "Official pick" },
          alertEvent: {
            type: "official_publication" as const,
            fixtureExternalId: fixture.external_id,
            publicationId: publication.id,
            competition: publication.competition ?? null,
            sport: publication.sport ?? "football",
            occurredAt: publication.published_at
          }
        }
      ];
    })
  ];

  // Every candidate event key for this sweep, loaded once.
  //
  // The dedupe check used to run *inside* the subscription x fixture loop as a
  // separate awaited round-trip — 1,000 subscribers and 50 candidate fixtures
  // meant up to 50,000 sequential queries in a function with a wall-clock
  // budget measured in seconds, so the sweep could not finish. One query for
  // the whole sweep replaces all of them.
  const eventKeys = fixtures.map((event) =>
    event.kind === "publication" ? `publication:${event.publication!.id}` : `${event.kind}:${event.fixture.external_id}`
  );
  const alreadyDelivered = new Set<string>();
  if (eventKeys.length && subscriptions.length) {
    const { data: priorDeliveries, error: priorError } = await db
      .from("op_push_notification_deliveries")
      .select("subscription_id,event_key")
      .in("event_key", eventKeys)
      .in("subscription_id", subscriptions.map((subscription) => subscription.id));
    if (priorError) {
      console.error("[push-worker] delivery ledger read failed", { code: priorError.code ?? "unknown" });
      return Response.json({ success: false, error: "Push delivery history is unavailable." }, { status: 502 });
    }
    for (const row of priorDeliveries ?? []) alreadyDelivered.add(`${row.subscription_id}:${row.event_key}`);
  }

  // Daily-cap accounting: one bounded read of the last 24 hours of the
  // delivery ledger, counted per subscription in memory.
  const deliveredToday = new Map<string, number>();
  if (subscriptions.length) {
    const { data: recentDeliveries } = await db
      .from("op_push_notification_deliveries")
      .select("subscription_id")
      .gte("sent_at", new Date(now.getTime() - 24 * 60 * 60_000).toISOString())
      .in("subscription_id", subscriptions.map((subscription) => subscription.id))
      .limit(20_000);
    for (const row of recentDeliveries ?? []) {
      deliveredToday.set(String(row.subscription_id), (deliveredToday.get(String(row.subscription_id)) ?? 0) + 1);
    }
  }

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

      const eventKey =
        event.kind === "publication" ? `publication:${event.publication!.id}` : `${event.kind}:${event.fixture.external_id}`;
      if (alreadyDelivered.has(`${subscription.id}:${eventKey}`)) continue;

      // The policy gate: preferences (or the legacy default for subscribers
      // predating the preferences table), quiet hours, daily cap, per-sport
      // toggles — all decided by the same pure engine the tests pin.
      const verdict = decideAlert(event.alertEvent, preferencesByUser.get(subscription.user_id) ?? LEGACY_DEFAULT_PREFERENCES, {
        now: now.toISOString(),
        deliveredToday: deliveredToday.get(subscription.id) ?? 0
      });
      if (!verdict.deliver) continue;

      const home = teamByExternalId.get(event.fixture.home_team_external_id)?.name ?? "Home";
      const away = teamByExternalId.get(event.fixture.away_team_external_id)?.name ?? "Away";
      const payload = event.kind === "kickoff"
        ? {
            title: "Kickoff soon, padi ⚽",
            body: `${home} vs ${away} starts shortly. Come see the match analysis.`,
            url: `/predictions/${encodeURIComponent(event.fixture.external_id)}`,
            tag: eventKey
          }
        : event.kind === "publication"
          ? {
              ...officialPublicationCopy(event.alertEvent, event.publication!.selectionLabel, `${home} vs ${away}`),
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
        // The dedupe ledger is what stops this notification going out again on
        // the next sweep. The insert result was discarded, so a failed write
        // meant the same push every ten minutes, indefinitely — count it as a
        // failure rather than reporting a delivery that will repeat.
        const { error: ledgerError } = await db
          .from("op_push_notification_deliveries")
          .insert({ subscription_id: subscription.id, event_key: eventKey });
        if (ledgerError) {
          console.error("[push-worker] delivery ledger write failed", { code: ledgerError.code ?? "unknown" });
          failed++;
        } else {
          alreadyDelivered.add(`${subscription.id}:${eventKey}`);
          deliveredToday.set(subscription.id, (deliveredToday.get(subscription.id) ?? 0) + 1);
          sent++;
        }
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
