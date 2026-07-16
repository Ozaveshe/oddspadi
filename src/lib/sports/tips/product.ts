import { getDailySlate, getWeeklySlate } from "@/lib/sports/intelligence/pipeline";
import type { SlateFixture, SlatePublicStatus, SportsSlate } from "@/lib/sports/intelligence/types";
import type { Sport } from "@/lib/sports/types";
import {
  getHistorySummary,
  getPublicPredictionHistory,
  type HistorySummary,
  type PublicPredictionHistoryItem
} from "@/lib/sports/prediction/history";

const DAY_MS = 86_400_000;

export type DailyTipsProduct = {
  day: "today" | "tomorrow";
  date: string;
  generatedAt: string;
  slate: SportsSlate;
  summary: {
    fixturesFound: number;
    fixturesAnalysed: number;
    oddsSnapshotsUsed: number;
    valuePicks: number;
    leans: number;
    watchlist: number;
    noPicks: number;
  };
  sections: {
    schedule: SlateFixture[];
    valuePicks: SlateFixture[];
    leans: SlateFixture[];
    watchlist: SlateFixture[];
    allAnalysed: SlateFixture[];
    noPicks: SlateFixture[];
  };
};

export type WeeklyTipsDay = {
  date: string;
  fixtures: SlateFixture[];
  counts: Record<"preliminary" | "ready" | "watchlist" | "valuePick" | "lean" | "noClearValue" | "stale" | "settled", number>;
};

export type WeeklyTipsProduct = {
  generatedAt: string;
  slate: SportsSlate;
  days: WeeklyTipsDay[];
  summary: SportsSlate["summary"];
};

export type YesterdayResultsProduct = {
  date: string;
  generatedAt: string;
  source: "live" | "unavailable";
  reason?: string;
  items: PublicPredictionHistoryItem[];
  summary: HistorySummary;
};

export type YesterdayDecisionAuditProduct = {
  date: string;
  generatedAt: string;
  source: "stored" | "unavailable";
  reason?: string;
  rows: SlateFixture[];
  summary: {
    fixtures: number;
    analysed: number;
    valuePicks: number;
    leans: number;
    watchlist: number;
    abstentions: number;
  };
};

export function isProviderBackedSlateFixture(row: SlateFixture): boolean {
  const provider = row.fixture.provider.trim().toLowerCase();
  return Boolean(row.fixture.providerFixtureId && provider && !provider.includes("mock") && !provider.includes("demo"));
}

function decisionExpiry(row: SlateFixture): string | null {
  return row.decisionSummary.bestPublishedPick?.expiresAt
    ?? row.decisionSummary.bestLean?.expiresAt
    ?? row.decisionSummary.bestWatchlistCandidate?.expiresAt
    ?? row.decisionSummary.expiresAt;
}

export function normalizeExpiredTip(row: SlateFixture, asOf: Date): SlateFixture {
  const expiry = decisionExpiry(row);
  if (!expiry || !["value_pick", "lean"].includes(row.publicStatus) || Date.parse(expiry) > asOf.getTime()) return row;
  const heldCandidate = row.decisionSummary.bestPublishedPick ?? row.decisionSummary.bestLean ?? row.decisionSummary.bestWatchlistCandidate;
  return {
    ...row,
    publicStatus: "stale",
    bestDecision: row.bestDecision ? {
      ...row.bestDecision,
      publicStatus: "stale",
      decisionStatus: "stale",
      reason: "The supporting odds expired; refresh the market before treating this as active."
    } : null,
    decisionSummary: {
      ...row.decisionSummary,
      publicStatus: "stale",
      engineStatus: "stale",
      bestPublishedPick: null,
      bestLean: null,
      bestWatchlistCandidate: heldCandidate,
      noPickReason: "The supporting odds expired; this selection is held for a market refresh."
    }
  };
}

function noPickStatus(status: SlatePublicStatus): boolean {
  return ["no_clear_value", "needs_data", "suspended", "needs_review", "preliminary"].includes(status);
}

export function buildDailyTipsProduct(
  slate: SportsSlate,
  { day = "today", asOf = new Date(slate.generatedAt) }: { day?: "today" | "tomorrow"; asOf?: Date } = {}
): DailyTipsProduct {
  const schedule = slate.fixtures.filter(isProviderBackedSlateFixture).map((row) => normalizeExpiredTip(row, asOf));
  const valuePicks = schedule.filter((row) => row.publicStatus === "value_pick" && Boolean(row.decisionSummary.bestPublishedPick));
  const leans = schedule.filter((row) => row.publicStatus === "lean" && Boolean(row.decisionSummary.bestLean));
  const watchlist = schedule.filter((row) => row.publicStatus === "watchlist" || row.publicStatus === "stale");
  const allAnalysed = schedule.filter((row) => row.decisionSummary.allMarketAnalyses.length > 0);
  const noPicks = schedule.filter((row) => noPickStatus(row.publicStatus));
  const oddsSnapshotsUsed = schedule.reduce((sum, row) => sum + row.odds.length, 0);
  const publicSlateSummary: SportsSlate["summary"] = {
    fixturesFound: schedule.length,
    predictionsGenerated: allAnalysed.length,
    oddsSnapshotsUsed,
    valuePicksPublished: valuePicks.length,
    leansPublished: leans.length,
    watchlist: watchlist.length,
    noPickMatches: noPicks.length,
    preliminaryDecisions: schedule.filter((row) => row.publicStatus === "preliminary").length,
    readyDecisions: schedule.filter((row) => row.publicStatus === "ready").length,
    staleDecisions: schedule.filter((row) => row.publicStatus === "stale").length,
    settledFixtures: schedule.filter((row) => row.publicStatus === "settled").length
  };
  return {
    day,
    date: slate.range.from,
    generatedAt: slate.generatedAt,
    slate: {
      ...slate,
      fixtures: schedule,
      groupedByDate: [{ date: slate.range.from, fixtures: schedule }],
      groups: { valuePicks, leans, watchlist, allAnalysed, noPicks },
      summary: publicSlateSummary
    },
    summary: {
      fixturesFound: schedule.length,
      fixturesAnalysed: allAnalysed.length,
      oddsSnapshotsUsed,
      valuePicks: valuePicks.length,
      leans: leans.length,
      watchlist: watchlist.length,
      noPicks: noPicks.length
    },
    sections: { schedule, valuePicks, leans, watchlist, allAnalysed, noPicks }
  };
}

export function filterDailyTipsProductBySport(product: DailyTipsProduct, sport: Sport): DailyTipsProduct {
  return buildDailyTipsProduct(
    {
      ...product.slate,
      fixtures: product.slate.fixtures.filter((row) => row.fixture.sport === sport)
    },
    { day: product.day, asOf: new Date(product.generatedAt) }
  );
}

function inclusiveDates(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  return Array.from({ length: Math.min(14, Math.floor((end - start) / DAY_MS) + 1) }, (_, index) => new Date(start + index * DAY_MS).toISOString().slice(0, 10));
}

export function buildWeeklyTipsProduct(slate: SportsSlate, asOf = new Date(slate.generatedAt)): WeeklyTipsProduct {
  const rows = slate.fixtures.filter(isProviderBackedSlateFixture).map((row) => normalizeExpiredTip(row, asOf));
  const byDate = new Map<string, SlateFixture[]>();
  for (const row of rows) {
    const date = row.fixture.kickoffAt.slice(0, 10);
    byDate.set(date, [...(byDate.get(date) ?? []), row]);
  }
  const days = inclusiveDates(slate.range.from, slate.range.to).map((date) => {
    const fixtures = byDate.get(date) ?? [];
    return {
      date,
      fixtures,
      counts: {
        preliminary: fixtures.filter((row) => row.publicStatus === "preliminary").length,
        ready: fixtures.filter((row) => row.publicStatus === "ready").length,
        watchlist: fixtures.filter((row) => row.publicStatus === "watchlist").length,
        valuePick: fixtures.filter((row) => row.publicStatus === "value_pick").length,
        lean: fixtures.filter((row) => row.publicStatus === "lean").length,
        noClearValue: fixtures.filter((row) => row.publicStatus === "no_clear_value").length,
        stale: fixtures.filter((row) => row.publicStatus === "stale").length,
        settled: fixtures.filter((row) => row.publicStatus === "settled").length
      }
    } satisfies WeeklyTipsDay;
  });
  const valuePicks = rows.filter((row) => row.publicStatus === "value_pick");
  const leans = rows.filter((row) => row.publicStatus === "lean");
  const watchlist = rows.filter((row) => row.publicStatus === "watchlist" || row.publicStatus === "stale");
  const allAnalysed = rows.filter((row) => row.decisionSummary.allMarketAnalyses.length > 0);
  const noPicks = rows.filter((row) => noPickStatus(row.publicStatus));
  const summary: SportsSlate["summary"] = {
    fixturesFound: rows.length,
    predictionsGenerated: allAnalysed.length,
    valuePicksPublished: valuePicks.length,
    leansPublished: leans.length,
    watchlist: watchlist.length,
    noPickMatches: noPicks.length,
    preliminaryDecisions: rows.filter((row) => row.publicStatus === "preliminary").length,
    readyDecisions: rows.filter((row) => row.publicStatus === "ready").length,
    staleDecisions: rows.filter((row) => row.publicStatus === "stale").length,
    settledFixtures: rows.filter((row) => row.publicStatus === "settled").length,
    oddsSnapshotsUsed: rows.reduce((sum, row) => sum + row.odds.length, 0)
  };
  return {
    generatedAt: slate.generatedAt,
    slate: {
      ...slate,
      fixtures: rows,
      groupedByDate: days.map(({ date, fixtures }) => ({ date, fixtures })),
      groups: { valuePicks, leans, watchlist, allAnalysed, noPicks },
      summary
    },
    days,
    summary
  };
}

export async function getDailyTipsProduct({
  day = "today",
  now = new Date(),
  ensure = true
}: { day?: "today" | "tomorrow"; now?: Date; ensure?: boolean } = {}): Promise<DailyTipsProduct> {
  const slate = await getDailySlate({ now, ensure, dayOffset: day === "tomorrow" ? 1 : 0 });
  return buildDailyTipsProduct(slate, { day, asOf: now });
}

export async function getWeeklyTipsProduct({ now = new Date(), ensure = true }: { now?: Date; ensure?: boolean } = {}): Promise<WeeklyTipsProduct> {
  return buildWeeklyTipsProduct(await getWeeklySlate({ now, ensure }), now);
}

export async function getYesterdayResultsProduct({ now = new Date() }: { now?: Date } = {}): Promise<YesterdayResultsProduct> {
  const history = await getPublicPredictionHistory();
  const todayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const yesterdayStart = todayStart - DAY_MS;
  const items = history.items.filter((item) => {
    const settledAt = item.settledAt ? Date.parse(item.settledAt) : Number.NaN;
    return settledAt >= yesterdayStart && settledAt < todayStart;
  });
  return {
    date: new Date(yesterdayStart).toISOString().slice(0, 10),
    generatedAt: history.generatedAt,
    source: history.source,
    reason: history.reason,
    items,
    summary: getHistorySummary(items)
  };
}

export async function getYesterdayDecisionAuditProduct({ now = new Date() }: { now?: Date } = {}): Promise<YesterdayDecisionAuditProduct> {
  const slate = await getDailySlate({ now, ensure: false, dayOffset: -1, maxFixtureAgeMs: 72 * 60 * 60 * 1000, includeSuspended: true });
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - DAY_MS).toISOString().slice(0, 10);
  const rows = slate.fixtures.filter(isProviderBackedSlateFixture).map((row) => normalizeExpiredTip(row, now));
  const unavailable = slate.provider.status === "failed" || slate.provider.status === "unavailable";
  return {
    date,
    generatedAt: slate.generatedAt,
    source: unavailable ? "unavailable" : "stored",
    reason: unavailable ? slate.provider.errors[0] ?? "Yesterday's stored decision audit could not be read." : undefined,
    rows,
    summary: {
      fixtures: rows.length,
      analysed: rows.filter((row) => row.decisionSummary.allMarketAnalyses.length > 0).length,
      valuePicks: rows.filter((row) => row.publicStatus === "value_pick").length,
      leans: rows.filter((row) => row.publicStatus === "lean").length,
      watchlist: rows.filter((row) => row.publicStatus === "watchlist" || row.publicStatus === "stale").length,
      abstentions: rows.filter((row) => noPickStatus(row.publicStatus)).length
    }
  };
}
