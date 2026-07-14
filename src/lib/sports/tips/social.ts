import { formatOdds, formatSignedPercent } from "@/lib/sports/prediction/format";
import type { SlateFixture } from "@/lib/sports/intelligence/types";
import type { DailyTipsProduct, WeeklyTipsProduct, YesterdayResultsProduct } from "./product";

const RESPONSIBLE_USE = "Responsible use: sports outcomes are uncertain. If you choose to bet elsewhere, be 18+ and never chase losses.";

function matchLabel(row: SlateFixture): string {
  return `${row.fixture.homeTeam.name} vs ${row.fixture.awayTeam.name}`;
}

function decisionLine(row: SlateFixture): string {
  const pick = row.decisionSummary.bestPublishedPick ?? row.decisionSummary.bestLean ?? row.decisionSummary.bestWatchlistCandidate;
  return pick
    ? `${matchLabel(row)} — ${pick.label} @ ${formatOdds(pick.odds)} | edge ${formatSignedPercent(pick.edge)} | ${row.publicStatus.replaceAll("_", " ")}`
    : `${matchLabel(row)} — ${row.decisionSummary.noPickReason ?? "No clear value found."}`;
}

function dailyBody(product: DailyTipsProduct): string[] {
  const active = [...product.sections.valuePicks, ...product.sections.leans, ...product.sections.watchlist].slice(0, 8);
  const lines = active.length ? active.map(decisionLine) : product.sections.noPicks.slice(0, 4).map(decisionLine);
  return [
    `OddsPadi ${product.day === "today" ? "Daily Tips" : "Tomorrow Radar"} — ${product.date}`,
    `${product.summary.fixturesFound} fixtures | ${product.summary.fixturesAnalysed} analysed | ${product.summary.valuePicks} value | ${product.summary.leans} leans | ${product.summary.watchlist} watchlist`,
    ...lines,
    RESPONSIBLE_USE
  ];
}

export function formatDailyTipsForWhatsApp(product: DailyTipsProduct): string {
  return dailyBody(product).join("\n\n");
}

export function formatDailyTipsForTelegram(product: DailyTipsProduct): string {
  const body = dailyBody(product);
  return body.map((line, index) => index > 1 && index < body.length - 1 ? `• ${line}` : line).join("\n\n");
}

export function formatValuePickPost(row: SlateFixture): string {
  return ["OddsPadi Value Pick", decisionLine(row), `Generated ${row.decisionSummary.generatedAt} | Expires ${row.decisionSummary.expiresAt ?? "when market data changes"}`, RESPONSIBLE_USE].join("\n\n");
}

export function formatWeeklyRadarPost(product: WeeklyTipsProduct): string {
  const dayLines = product.days.map((day) => `${day.date}: ${day.fixtures.length} fixtures | ${day.counts.ready} ready | ${day.counts.watchlist} watchlist | ${day.counts.valuePick} value`);
  return ["OddsPadi Weekly Radar", `${product.summary.fixturesFound} provider-backed fixtures across the next seven days.`, ...dayLines, "Weekly predictions start preliminary and refresh as prices, injuries, lineups, and results change.", RESPONSIBLE_USE].join("\n\n");
}

export function formatYesterdayResultsPost(product: YesterdayResultsProduct): string {
  const { summary } = product;
  return ["OddsPadi Yesterday Results", `${product.date}: ${summary.wins} won | ${summary.losses} lost | ${summary.pushes} push | ${summary.voids} void`, `${summary.settled} settled public picks.`, RESPONSIBLE_USE].join("\n\n");
}

export { RESPONSIBLE_USE };
