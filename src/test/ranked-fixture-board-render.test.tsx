import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RankedFixtureBoard } from "@/components/product/RankedFixtureBoard";
import { readViewerContext } from "@/lib/discovery/viewerContext";
import type { SlateFixture } from "@/lib/sports/intelligence/types";

function row(
  overrides: Partial<SlateFixture> = {},
  fixtureOverrides: Record<string, unknown> = {}
): SlateFixture {
  return {
    fixture: {
      fixtureId: "fx-1",
      providerFixtureId: "af-1",
      sport: "football",
      league: "Premier League",
      leagueId: "epl",
      country: "England",
      season: "2026",
      kickoffAt: "2026-08-08T19:00:00.000Z",
      homeTeam: { id: "h", name: "Arsenal" },
      awayTeam: { id: "a", name: "Chelsea" },
      status: "scheduled",
      score: null,
      provider: "api-football",
      lastSyncedAt: "2026-08-08T17:00:00.000Z",
      dataQuality: 0.82,
      ...fixtureOverrides
    },
    odds: [],
    decisions: [],
    decisionSummary: { generatedAt: "2026-08-08T17:30:00.000Z" },
    publicStatus: "value_pick",
    bestDecision: null,
    ...overrides
  } as unknown as SlateFixture;
}

function render(rows: SlateFixture[], props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    <RankedFixtureBoard rows={rows} viewer={readViewerContext({ now: "2026-08-08T12:00:00.000Z" })} {...props} />
  );
}

describe("the ranked board renders", () => {
  it("puts an upcoming fixture on the primary board through the shared card", () => {
    const html = render([row()]);
    expect(html).toContain("Arsenal");
    expect(html).toContain("Chelsea");
    expect(html).toContain("fixture-card");
    expect(html).toContain('data-state="pick"');
  });

  it("links every card to the canonical fixture route", () => {
    // One route across every phase; the board must not invent its own.
    expect(render([row()])).toContain('href="/predictions/fx-1"');
  });

  it("keeps finished no-pick evidence off the board and reports it as a count", () => {
    const rows = [
      row({}, { fixtureId: "upcoming" }),
      ...Array.from({ length: 12 }, (_, index) =>
        row({ publicStatus: "no_clear_value" }, { fixtureId: `old-${index}`, status: "finished" })
      )
    ];
    const html = render(rows);
    expect(html).toContain("Analysed, no pick published");
    expect(html).toContain("12 finished");
    // The archive is a count and a link, not twelve cards.
    expect(html).not.toContain('data-fixture-id="old-0"');
  });

  it("shows a settled published pick under recent results", () => {
    const html = render([
      row({ publicStatus: "value_pick" }, { fixtureId: "played", status: "finished", score: { home: 2, away: 1 } })
    ]);
    expect(html).toContain("How the published picks finished");
    expect(html).toContain("2–1");
  });

  it("discloses what a capped board is not showing", () => {
    // A board showing 3 of 30 with no note reads as the whole slate.
    const rows = Array.from({ length: 30 }, (_, index) =>
      row({}, { fixtureId: `fx-${index}`, league: `League ${index}`, leagueId: `l-${index}` })
    );
    const html = render(rows, { primaryLimit: 3 });
    expect(html).toContain("Showing 3");
    expect(html).toContain("View all");
  });

  it("still shows settled picks when nothing is running", () => {
    // The first version returned early on an empty primary board and hid these
    // entirely — at the moment a reader wants them most.
    const html = render([
      row({ publicStatus: "value_pick" }, { fixtureId: "played", status: "finished", score: { home: 3, away: 0 } })
    ]);
    expect(html).toContain("Nothing is running or due right now");
    expect(html).toContain("How the published picks finished");
    expect(html).toContain("3–0");
  });

  it("distinguishes a quiet day from no coverage at all", () => {
    const quiet = render([row({ publicStatus: "no_clear_value" }, { status: "finished" })]);
    expect(quiet).toContain("Nothing is running or due right now");

    const nothing = render([]);
    expect(nothing).toContain("No fixtures are covered");
  });

  it("never renders engine vocabulary", () => {
    const html = render([
      row({ publicStatus: "needs_data" }, { fixtureId: "thin" }),
      row({ publicStatus: "stale" }, { fixtureId: "old-price" })
    ]);
    for (const marker of ["needs_data", "no_clear_value", "publicStatus", "value_pick", "undefined"]) {
      expect(html, `${marker} must not reach a reader`).not.toContain(marker);
    }
  });

  it("does not show a price on a finished fixture", () => {
    const html = render([
      row({ publicStatus: "value_pick" }, { fixtureId: "done", status: "finished", score: { home: 1, away: 0 } })
    ]);
    expect(html).not.toContain("fixture-card-odds");
  });
});
