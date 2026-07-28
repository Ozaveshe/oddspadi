import { describe, expect, it, vi } from "vitest";

const sendNotification = vi.fn();
vi.mock("web-push", () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: (...args: unknown[]) => sendNotification(...args) }
}));

type Row = Record<string, unknown>;

/**
 * Minimal PostgREST-shaped stub. It records every table read so the tests can
 * assert on how *many* round-trips the sweep makes, not just what it produces —
 * the dedupe check used to run once per subscription x fixture pair.
 */
function createDb(tables: Record<string, Row[]>) {
  const reads: string[] = [];
  const inserts: Array<{ table: string; row: Row }> = [];
  const deletes: Array<{ table: string; id: unknown }> = [];
  let insertShouldFail = false;

  function builder(table: string) {
    let rows = [...(tables[table] ?? [])];
    const chain = {
      select() {
        reads.push(table);
        return chain;
      },
      eq(column: string, value: unknown) {
        rows = rows.filter((row) => row[column] === value);
        return chain;
      },
      in(column: string, values: unknown[]) {
        rows = rows.filter((row) => values.includes(row[column]));
        return chain;
      },
      gte() { return chain; },
      lte() { return chain; },
      limit() { return chain; },
      maybeSingle() { return Promise.resolve({ data: rows[0] ?? null, error: null }); },
      insert(row: Row) {
        if (insertShouldFail) return Promise.resolve({ data: null, error: { code: "23505" } });
        inserts.push({ table, row });
        (tables[table] ??= []).push(row);
        return Promise.resolve({ data: null, error: null });
      },
      delete() {
        return {
          eq(_column: string, value: unknown) {
            deletes.push({ table, id: value });
            return Promise.resolve({ data: null, error: null });
          }
        };
      },
      then(resolve: (value: { data: Row[]; error: null }) => unknown) {
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      }
    };
    return chain;
  }

  return {
    client: { from: builder },
    reads,
    inserts,
    deletes,
    failInserts() { insertShouldFail = true; }
  };
}

const NOW = new Date("2026-07-20T12:00:00.000Z");

function fixtureRow(externalId: string, home: string, away: string) {
  return {
    external_id: externalId,
    kickoff_at: "2026-07-20T12:10:00.000Z",
    status: "scheduled",
    home_team_external_id: home,
    away_team_external_id: away,
    home_score: null,
    away_score: null,
    updated_at: NOW.toISOString()
  };
}

function subscriptionRow(id: string, userId: string) {
  return {
    id,
    user_id: userId,
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: "p".repeat(80),
    auth: "a".repeat(24)
  };
}

async function runWorker(db: ReturnType<typeof createDb>) {
  vi.resetModules();
  vi.doMock("@supabase/supabase-js", () => ({ createClient: () => db.client }));
  const { runPushNotificationWorker } = await import("../../netlify/functions/push-notification-worker-background");
  return runPushNotificationWorker({
    scheduleToken: "token",
    adminToken: "token",
    supabaseUrl: "https://project.supabase.co",
    supabaseKey: "service-key",
    vapidPublicKey: "public",
    vapidPrivateKey: "private",
    vapidSubject: "mailto:ops@oddspadi.test",
    now: NOW
  });
}

function scenario(subscriptionCount: number, fixtureCount: number) {
  const subscriptions = Array.from({ length: subscriptionCount }, (_, index) =>
    subscriptionRow(`sub-${index}`, `user-${index}`)
  );
  const fixtures = Array.from({ length: fixtureCount }, (_, index) =>
    fixtureRow(`fixture-${index}`, "team-home", "team-away")
  );
  return createDb({
    op_push_subscriptions: subscriptions,
    // Every user follows the home team, so every subscription matches every fixture.
    op_followed_teams: subscriptions.map((subscription) => ({ user_id: subscription.user_id, team_id: "t-home" })),
    op_teams: [
      { id: "t-home", external_id: "team-home", name: "Arsenal" },
      { id: "t-away", external_id: "team-away", name: "Chelsea" }
    ],
    op_fixtures: fixtures,
    op_push_notification_deliveries: []
  });
}

describe("push notification worker", () => {
  it("reads the delivery ledger once per sweep, not once per subscription x fixture", async () => {
    sendNotification.mockReset().mockResolvedValue(undefined);
    const db = scenario(10, 5);

    const response = await runWorker(db);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ sent: 50, failed: 0 });
    // Five source tables plus exactly one ledger read. The previous shape did
    // one ledger query per pair, which is 50 here and 50,000 at real scale.
    const ledgerReads = db.reads.filter((table) => table === "op_push_notification_deliveries");
    expect(ledgerReads).toHaveLength(1);
  });

  it("never re-sends an event already in the delivery ledger", async () => {
    sendNotification.mockReset().mockResolvedValue(undefined);
    const db = scenario(2, 2);
    db.client.from("op_push_notification_deliveries");
    // Pre-record one delivery.
    await db.client.from("op_push_notification_deliveries").insert({
      subscription_id: "sub-0",
      event_key: "kickoff:fixture-0"
    });

    const response = await runWorker(db);

    expect(await response.json()).toMatchObject({ sent: 3 });
  });

  it("counts a failed ledger write as a failure rather than a delivery", async () => {
    // Without the ledger row nothing stops the same push going out on the next
    // sweep, so reporting it as sent hides a notification loop.
    sendNotification.mockReset().mockResolvedValue(undefined);
    const db = scenario(1, 1);
    db.failInserts();

    const response = await runWorker(db);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ sent: 0, failed: 1, success: false });
  });

  it("drops a subscription the push service reports as gone", async () => {
    sendNotification.mockReset().mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 410 }));
    const db = scenario(1, 1);

    const response = await runWorker(db);

    expect(await response.json()).toMatchObject({ removed: 1, sent: 0 });
    expect(db.deletes).toEqual([{ table: "op_push_subscriptions", id: "sub-0" }]);
  });

  it("rejects an unauthenticated invocation", async () => {
    vi.resetModules();
    const { runPushNotificationWorker } = await import("../../netlify/functions/push-notification-worker-background");
    const response = await runPushNotificationWorker({
      scheduleToken: "wrong",
      adminToken: "token",
      supabaseUrl: "https://project.supabase.co",
      supabaseKey: "service-key",
      vapidPublicKey: "public",
      vapidPrivateKey: "private",
      vapidSubject: "mailto:ops@oddspadi.test",
      now: NOW
    });
    expect(response.status).toBe(401);
  });
});
