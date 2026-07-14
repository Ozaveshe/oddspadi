import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FootballCorpusRefreshWorkerOptions = {
  siteUrl: string | null;
  adminToken: string | null;
  scheduleToken: string | null;
  leagueId?: string | null;
  fixtureLimit?: string | null;
  now?: Date;
  fetchImpl?: FetchLike;
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

function boundedInteger(value: string | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function utcDateDaysAgo(now: Date, days: number): string {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - days));
  return date.toISOString().slice(0, 10);
}

export function footballSeasonForCorpusDate(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return String(parsed.getUTCMonth() >= 6 ? parsed.getUTCFullYear() : parsed.getUTCFullYear() - 1);
}

export function footballCorpusDateWindow(now = new Date()): { from: string; to: string; season: string } {
  const from = utcDateDaysAgo(now, 2);
  const to = utcDateDaysAgo(now, 1);
  return { from, to, season: footballSeasonForCorpusDate(to) };
}

export async function runFootballCorpusRefreshWorker({
  siteUrl,
  adminToken,
  scheduleToken,
  leagueId = "39",
  fixtureLimit,
  now = new Date(),
  fetchImpl = fetch
}: FootballCorpusRefreshWorkerOptions): Promise<Response> {
  const baseUrl = clean(siteUrl);
  const token = clean(adminToken);
  const suppliedToken = clean(scheduleToken);
  if (!baseUrl || !token) {
    return Response.json({ success: false, error: "Football corpus refresh worker configuration is incomplete." }, { status: 503 });
  }
  if (!suppliedToken || !tokenMatches(token, suppliedToken)) {
    return Response.json({ success: false, error: "Football corpus refresh worker authorization failed." }, { status: 401 });
  }

  const limit = boundedInteger(fixtureLimit, 12, 1, 24);
  const dateWindow = footballCorpusDateWindow(now);
  const endpoint = new URL("/api/sports/decision/training/historical-provider-storage-receipt", baseUrl);
  endpoint.searchParams.set("provider", "api-football");
  endpoint.searchParams.set("league", clean(leagueId) ?? "39");
  endpoint.searchParams.set("seasonFrom", dateWindow.season);
  endpoint.searchParams.set("seasonTo", dateWindow.season);
  endpoint.searchParams.set("from", dateWindow.from);
  endpoint.searchParams.set("to", dateWindow.to);
  endpoint.searchParams.set("intervalDays", "2");
  endpoint.searchParams.set("includeEvents", "1");
  endpoint.searchParams.set("includeLineups", "1");
  endpoint.searchParams.set("includePlayerStats", "1");
  endpoint.searchParams.set("maxEventFixtures", String(limit));
  endpoint.searchParams.set("maxContextFixtures", String(limit));
  endpoint.searchParams.set("limit", "250");
  endpoint.searchParams.set("maxJobs", "1");
  endpoint.searchParams.set("stopOnError", "1");
  endpoint.searchParams.set("dryRun", "0");
  endpoint.searchParams.set("run", "1");

  try {
    const response = await fetchImpl(endpoint, {
      method: "GET",
      headers: { accept: "application/json", "x-oddspadi-admin-token": token },
      signal: AbortSignal.timeout(10 * 60_000)
    });
    const body = await response.json().catch(() => null);
    return Response.json(
      {
        success: response.ok,
        mode: "scheduled-football-corpus-refresh",
        leagueId: clean(leagueId) ?? "39",
        dateWindow,
        fixtureLimit: limit,
        receipt: { status: response.status, body }
      },
      { status: response.status }
    );
  } catch (error) {
    return Response.json(
      {
        success: false,
        mode: "scheduled-football-corpus-refresh",
        leagueId: clean(leagueId) ?? "39",
        dateWindow,
        fixtureLimit: limit,
        error: error instanceof Error ? error.message : "Football corpus refresh worker failed."
      },
      { status: 504 }
    );
  }
}

export default async function footballCorpusRefreshWorker(request: Request, context: Context): Promise<Response> {
  return runFootballCorpusRefreshWorker({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    leagueId: clean(Netlify.env.get("ODDSPADI_FOOTBALL_CORPUS_LEAGUE_ID")) ?? "39",
    fixtureLimit: clean(Netlify.env.get("ODDSPADI_FOOTBALL_CORPUS_FIXTURE_LIMIT"))
  });
}
