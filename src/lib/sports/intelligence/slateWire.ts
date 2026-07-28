import type { SlateFixture, SportsSlate } from "./types";

/**
 * `SportsSlate` holds each fixture once in memory and points at it from
 * `fixtures`, `groupedByDate` and all five `groups` buckets. Sharing references
 * is free in-process — which is how the pages use it — but `JSON.stringify`
 * expands every reference, so the HTTP response carried four full copies of the
 * same objects and measured ~34MB for a single day.
 *
 * The wire shape keeps the grouping information but carries fixture *ids* in
 * the grouped views, leaving `fixtures` as the only place a full object
 * appears.
 */
export type SlateWireFixtureGroups = {
  valuePicks: string[];
  leans: string[];
  watchlist: string[];
  allAnalysed: string[];
  noPicks: string[];
};

export type SlateWirePayload = Omit<SportsSlate, "groupedByDate" | "groups"> & {
  groupedByDate: Array<{ date: string; fixtureIds: string[] }>;
  groups: SlateWireFixtureGroups;
};

/**
 * Tolerates a missing bucket. The `SportsSlate` type guarantees these arrays,
 * but this sits on a public endpoint and a partial slate should degrade to an
 * empty group rather than throw a 500 out of the route.
 */
function fixtureIds(fixtures: SlateFixture[] | undefined): string[] {
  return (fixtures ?? []).map((entry) => entry.fixture.fixtureId);
}

/**
 * Drop the per-market dossier from a fixture. `decisions` alone reached ~347KB
 * on a single heavily-analysed fixture, and list/card UIs never read it — they
 * render `bestDecision` and the summary verdict.
 */
function toSummaryFixture(entry: SlateFixture): SlateFixture {
  return {
    ...entry,
    decisions: [],
    decisionSummary: { ...entry.decisionSummary, allMarketAnalyses: [] }
  };
}

export function toSlateWirePayload(slate: SportsSlate, { summaryOnly = false } = {}): SlateWirePayload {
  const source = slate.fixtures ?? [];
  const groups = slate.groups ?? ({} as SportsSlate["groups"]);
  return {
    ...slate,
    fixtures: summaryOnly ? source.map(toSummaryFixture) : source,
    groupedByDate: (slate.groupedByDate ?? []).map((group) => ({
      date: group.date,
      fixtureIds: fixtureIds(group.fixtures)
    })),
    groups: {
      valuePicks: fixtureIds(groups.valuePicks),
      leans: fixtureIds(groups.leans),
      watchlist: fixtureIds(groups.watchlist),
      allAnalysed: fixtureIds(groups.allAnalysed),
      noPicks: fixtureIds(groups.noPicks)
    }
  };
}
