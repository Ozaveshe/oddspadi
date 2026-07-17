import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateEditorialStories, type EditorialOutcome } from "@/lib/editorial/generatedStories";
import { runEditorialGeneration } from "../../netlify/functions/editorial-generation-worker-background";

const now = new Date("2026-07-13T05:00:00Z");
const row = (overrides: Partial<EditorialOutcome>): EditorialOutcome => ({ id: crypto.randomUUID(), fixture_external_id: "fixture-1", sport: "football", league: "NPFL", home_team: "Enyimba", away_team: "Kano Pillars", kickoff_at: "2026-07-14T16:00:00Z", market: "match_winner", selection: "home", recommended_selection: "Enyimba", model_probability: 0.61, value_edge: 0.08, odds: 2.05, result: "pending", settled_at: null, created_at: "2026-07-13T04:00:00Z", ...overrides });

describe("deterministic editorial generators", () => {
  it("builds all four story classes from owned engine rows", () => {
    const rows = [row({}), row({ id: "won", result: "won", settled_at: "2026-07-12T18:00:00Z", kickoff_at: "2026-07-12T15:00:00Z", odds: 2.2 }), row({ id: "lost", result: "lost", settled_at: "2026-07-12T19:00:00Z", kickoff_at: "2026-07-12T16:00:00Z", home_team: "Sundowns", away_team: "Pirates" })];
    const stories = generateEditorialStories(rows, now);
    expect(stories.map((story) => story.generator)).toEqual(["daily-slate", "weekend-preview", "results-recap", "value-picks-watch", "model-vs-market"]);
    expect(stories[0]?.slug).toBe("daily-slate-2026-07-13");
    expect(stories[0]?.body.join(" ")).toContain("fresh stored OddsPadi fixture and decision records");
    expect(stories.find((story) => story.generator === "results-recap")?.body.join(" ")).toContain("1 wins, 1 losses");
    const marketStory = stories.find((story) => story.generator === "model-vs-market");
    expect(marketStory?.title).not.toContain("today");
    expect(marketStory?.body.join(" ")).toContain("Scheduled 2026-07-14T16:00:00.000Z");
    expect(marketStory?.dataFingerprint).toMatch(/^template-v2-fnv1a-/);
    expect(stories.every((story) => story.sources.some((source) => source.url === "/predictions/history"))).toBe(true);
  });

  it("does not fabricate a story when its source rows are absent", () => {
    expect(generateEditorialStories([], now)).toEqual([]);
  });

  it("is deterministic for the same rows and revision timestamp", () => {
    expect(generateEditorialStories([row({ id: "same" })], now)).toEqual(generateEditorialStories([row({ id: "same" })], now));
  });
});

describe("editorial worker boundary", () => {
  it("rejects requests without the matching schedule token before database access", async () => {
    const response = await runEditorialGeneration({ scheduleToken: "wrong", adminToken: "right", supabaseUrl: null, supabaseKey: null, now });
    expect(response.status).toBe(401);
  });

  it("keeps every emitted generator accepted by the editorial table", () => {
    const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260717005500_allow_daily_slate_editorial_stories.sql"), "utf8");
    for (const generator of ["daily-slate", "weekend-preview", "results-recap", "value-picks-watch", "model-vs-market"]) {
      expect(migration).toContain(`'${generator}'`);
    }
  });
});
