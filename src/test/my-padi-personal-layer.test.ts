import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PREFERENCES,
  GUEST_PERSISTENCE_COPY,
  mergeFollowLists,
  normalizeFollowKey,
  toggleFollow,
  isFollowing
} from "@/lib/personal/preferences";
import {
  ALERT_TYPES,
  decideAlert,
  isQuietTime,
  officialPublicationCopy,
  watchlistChangeCopy,
  DELIVERABLE_CHANNELS,
  type AlertEvent,
  type AlertPreferences
} from "@/lib/personal/alertPolicy";
import { buildPersonalRecord, PERSONAL_RECORD_SEPARATION_COPY } from "@/lib/personal/record";
import type { StoredWorkspace } from "@/lib/workspace/store";
import type { WorkspaceSnapshot } from "@/lib/workspace/analysis";

/** My Padi personal layer: guest persistence, migration merge, alerts, record. */

describe("guest preferences", () => {
  it("toggles follows case-insensitively without duplicates", () => {
    let preferences = toggleFollow(DEFAULT_PREFERENCES, "competition", "Premier League");
    expect(isFollowing(preferences, "competition", "premier league")).toBe(true);
    preferences = toggleFollow(preferences, "competition", "PREMIER LEAGUE");
    expect(preferences.followedCompetitions).toEqual([]);
  });

  it("explains device-local persistence in one fixed sentence", () => {
    expect(GUEST_PERSISTENCE_COPY).toContain("this device only");
    expect(GUEST_PERSISTENCE_COPY).toContain("private sync");
  });
});

describe("guest-to-account merge", () => {
  it("merges without duplicates, keeping the first spelling seen", () => {
    const merged = mergeFollowLists(["Arsenal", "Chelsea"], ["arsenal", "Liverpool", "CHELSEA", "Liverpool"]);
    expect(merged).toEqual(["Arsenal", "Chelsea", "Liverpool"]);
  });

  it("normalises keys the same way the migration route stores them", () => {
    expect(normalizeFollowKey("  Premier League  ")).toBe("premier league");
  });

  it("is idempotent: merging the merged result changes nothing", () => {
    const once = mergeFollowLists(["Arsenal"], ["Liverpool"]);
    expect(mergeFollowLists(once, ["Liverpool", "arsenal"])).toEqual(once);
  });
});

describe("alert eligibility", () => {
  const event: AlertEvent = {
    type: "official_publication",
    fixtureExternalId: "api-football:9",
    publicationId: "pub-1",
    competition: "Premier League",
    sport: "football",
    occurredAt: "2026-08-08T12:00:00.000Z"
  };
  const preferences: AlertPreferences = {
    channels: ["push"],
    enabledTypes: ["official_publication", "watchlist_change"],
    quietHours: null,
    timezone: "Africa/Lagos",
    sportSettings: {},
    competitionSettings: {},
    maxAlertsPerDay: 10
  };
  const context = { now: "2026-08-08T12:05:00.000Z", deliveredToday: 0 };

  it("requires consent: no preferences row means no alert", () => {
    const verdict = decideAlert(event, null, context);
    expect(verdict).toMatchObject({ deliver: false });
  });

  it("delivers an enabled type on a deliverable channel", () => {
    expect(decideAlert(event, preferences, context)).toEqual({ deliver: true, channels: ["push"] });
  });

  it("refuses a type the user did not enable", () => {
    const verdict = decideAlert({ ...event, type: "odds_movement" }, preferences, context);
    expect(verdict).toMatchObject({ deliver: false });
  });

  it("demands canonical references and timestamps", () => {
    expect(decideAlert({ ...event, publicationId: null }, preferences, context)).toMatchObject({ deliver: false });
    expect(
      decideAlert({ ...event, type: "fixture_start", fixtureExternalId: null }, { ...preferences, enabledTypes: [...ALERT_TYPES] }, context)
    ).toMatchObject({ deliver: false });
    expect(decideAlert({ ...event, occurredAt: "not a time" }, preferences, context)).toMatchObject({ deliver: false });
  });

  it("respects per-sport switches and the daily cap", () => {
    expect(decideAlert(event, { ...preferences, sportSettings: { football: false } }, context)).toMatchObject({ deliver: false });
    expect(decideAlert(event, preferences, { ...context, deliveredToday: 10 })).toMatchObject({ deliver: false });
  });

  it("refuses channels that cannot deliver instead of pretending", () => {
    expect(DELIVERABLE_CHANNELS).toEqual(["push"]);
    const verdict = decideAlert(event, { ...preferences, channels: ["email", "whatsapp"] }, context);
    expect(verdict).toMatchObject({ deliver: false });
    if (!verdict.deliver) expect(verdict.reason).toContain("does not exist yet");
  });
});

describe("quiet hours and timezone", () => {
  it("holds alerts inside an overnight window, in the user's zone", () => {
    // 23:30 UTC is 00:30 in Lagos (UTC+1) — inside a 22:00→07:00 window.
    expect(isQuietTime({ start: "22:00", end: "07:00" }, "Africa/Lagos", "2026-08-08T23:30:00.000Z")).toBe(true);
    // 11:00 UTC is 12:00 in Lagos — outside it.
    expect(isQuietTime({ start: "22:00", end: "07:00" }, "Africa/Lagos", "2026-08-08T11:00:00.000Z")).toBe(false);
  });

  it("evaluates the same instant differently across timezones", () => {
    const instant = "2026-08-08T22:30:00.000Z";
    // 23:30 in Lagos — quiet; 18:30 in New York — not.
    expect(isQuietTime({ start: "23:00", end: "06:00" }, "Africa/Lagos", instant)).toBe(true);
    expect(isQuietTime({ start: "23:00", end: "06:00" }, "America/New_York", instant)).toBe(false);
  });

  it("fails toward silence on a malformed window", () => {
    expect(isQuietTime({ start: "25:99", end: "07:00" }, "Africa/Lagos", "2026-08-08T12:00:00.000Z")).toBe(true);
  });
});

describe("watchlist versus official-pick alerts", () => {
  const watchlistEvent: AlertEvent = {
    type: "watchlist_change",
    fixtureExternalId: "api-football:9",
    publicationId: null,
    competition: null,
    sport: "football",
    occurredAt: "2026-08-08T12:00:00.000Z"
  };

  it("refuses to format a watchlist event as pick copy", () => {
    expect(() => officialPublicationCopy(watchlistEvent, "Arsenal to win", "Arsenal vs Chelsea")).toThrow();
  });

  it("keeps pick language out of watchlist copy", () => {
    const copy = watchlistChangeCopy(watchlistEvent, "Arsenal vs Chelsea", "promoted");
    // The only permitted occurrence of "pick" is the explicit negation.
    expect(copy.title.toLowerCase()).not.toContain("pick");
    expect(copy.body).toContain("not a pick");
    expect(copy.body.toLowerCase().replaceAll("not a pick", "")).not.toContain("pick");
  });

  it("titles a real publication alert as the pick it is", () => {
    const copy = officialPublicationCopy(
      { ...watchlistEvent, type: "official_publication", publicationId: "pub-1" },
      "Arsenal to win",
      "Arsenal vs Chelsea"
    );
    expect(copy.title).toContain("pick");
    expect(copy.body).toContain("Arsenal vs Chelsea");
  });
});

describe("personal record", () => {
  function workspaceWith(outcomes: Array<{ odds: number; outcome: "won" | "lost" | "push" | "half_won" }>): StoredWorkspace {
    const legs = outcomes.map((entry, index) => ({
      selection: {
        legId: `leg-${index}`,
        fixtureId: `fx-${index}`,
        marketId: index % 2 ? "over_under_25" : "match_winner",
        selectionId: "home",
        label: `Selection ${index}`,
        fixtureLabel: `Fixture ${index}`,
        competition: "Premier League",
        sport: "football" as const,
        source: "test",
        userOdds: entry.odds,
        oddsObservedAt: null,
        modelProbability: null,
        modelGeneratedAt: null,
        decisionState: null,
        publicationId: null,
        kickoffAt: `2026-08-0${(index % 7) + 1}T15:00:00.000Z`,
        fixtureStatus: "finished" as const,
        marketSupported: true,
        modelInterval: null,
        note: index === 0 ? "my note" : null
      }
    }));
    const snapshot = {
      snapshotId: "snap",
      takenAt: "2026-08-01T10:00:00.000Z",
      analysis: { legs } as unknown as WorkspaceSnapshot["analysis"],
      settlement: {
        legOutcomes: outcomes.map((entry, index) => ({ legId: `leg-${index}`, outcome: entry.outcome })),
        settledAt: "2026-08-08T00:00:00.000Z"
      }
    } as WorkspaceSnapshot;
    return {
      workspaceId: "ws",
      name: "Test",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      selections: [],
      snapshot,
      archivedAt: null
    };
  }

  it("computes one-unit results, breakdowns and streaks from settled snapshots", () => {
    const record = buildPersonalRecord([
      workspaceWith([
        { odds: 2.0, outcome: "won" },
        { odds: 1.8, outcome: "lost" },
        { odds: 2.2, outcome: "push" },
        { odds: 2.0, outcome: "half_won" },
        { odds: 3.0, outcome: "won" }
      ])
    ]);
    expect(record.settledCount).toBe(5);
    expect(record.wins).toBe(3);
    expect(record.losses).toBe(1);
    // +1.0 - 1.0 + 0 + 0.5 + 2.0 = 2.5
    expect(record.oneUnitTotal).toBeCloseTo(2.5, 10);
    // Last decisive outcomes: half_won (win-like) then won → W-streak ≥ 2.
    expect(record.currentStreak).toBeGreaterThanOrEqual(2);
    expect(record.bySport[0]!.key).toBe("football");
    expect(record.byMarket.length).toBe(2);
    expect(record.entries.find((entry) => entry.legId === "leg-0")?.note).toBe("my note");
  });

  it("keeps the separation sentence about official ROI", () => {
    expect(PERSONAL_RECORD_SEPARATION_COPY).toContain("separate from the official OddsPadi track record");
  });
});

describe("public/private separation and deletion in the schema", () => {
  const migration = "supabase/migrations/20260808150000_personal_follows_and_alerts.sql";

  it("keeps follows and alert preferences owner-only with cascade deletion", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();
    expect(sql).toContain("references public.op_profiles(id) on delete cascade");
    expect(sql).toContain("alter table public.op_follows enable row level security");
    expect(sql).toContain("alter table public.op_alert_preferences enable row level security");
    expect(sql).toContain("revoke all on public.op_follows from public, anon");
    expect(sql).toContain("revoke all on public.op_alert_preferences from public, anon");
    for (const table of ["op_follows", "op_alert_preferences"]) {
      expect(sql).toContain(`using (auth.uid() = user_id)`);
      expect(sql).toContain(table);
    }
  });

  it("treats a missing preferences row as no consent", async () => {
    const sql = (await readFile(migration, "utf8")).toLowerCase();
    expect(sql).toContain("no row = no alerts");
  });
});

describe("export and deletion routes", () => {
  it("export is RLS-scoped and delete demands the typed confirmation", async () => {
    const exportSource = await readFile("src/app/api/my/export/route.ts", "utf8");
    expect(exportSource).toContain("createSupabaseServerClient");
    // Export must never use the service-role client: the user's own client
    // is what guarantees the export contains only their rows.
    expect(exportSource).not.toContain("getSupabaseServerClient");

    const deleteSource = await readFile("src/app/api/my/delete/route.ts", "utf8");
    expect(deleteSource).toContain('"delete my personal data"');
    expect(deleteSource).toContain("op_workspaces");
    expect(deleteSource).toContain("op_follows");
    expect(deleteSource).toContain("op_alert_preferences");
    expect(deleteSource).toContain("op_push_subscriptions");
    expect(deleteSource).toContain("revoked_at");
  });

  it("session security offers a global sign-out that reports failure", async () => {
    const source = await readFile("src/components/account/PrivacyControls.tsx", "utf8");
    expect(source).toContain('signOut({ scope: "global" })');
    expect(source).toContain("still active");
  });
});
