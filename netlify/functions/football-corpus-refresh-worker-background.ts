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
  playerHistoryFixtureLimit?: string | null;
  now?: Date;
  fetchImpl?: FetchLike;
};

type BackfillReceipt = {
  success: boolean;
  status: number;
  body: unknown;
};

type BackfillResponseEnvelope = {
  success?: boolean;
  data?: {
    status?: string;
    readback?: { evidenceReady?: boolean };
  };
};

const DAY_MS = 24 * 60 * 60_000;
const PLAYER_HISTORY_WINDOW_DAYS = 7;
const PLAYER_HISTORY_ROTATION_ANCHOR = Date.UTC(2026, 6, 14);
// Start at a provider-verified in-season window; the modulo rotation still
// reaches the two earlier August windows before the next complete pass.
const PLAYER_HISTORY_INITIAL_WINDOW_INDEX = 2;

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

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Rotate through the most recently completed EPL season in bounded seven-day
 * windows. This bootstraps the player-performance table without replaying an
 * entire season in one provider-heavy request, and restarts deterministically
 * after every complete pass.
 */
export function footballPlayerHistoryWindow(now = new Date()): {
  from: string;
  to: string;
  season: string;
  windowIndex: number;
  windowCount: number;
} {
  const utcToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const completedSeasonStartYear = now.getUTCMonth() >= 5 ? now.getUTCFullYear() - 1 : now.getUTCFullYear() - 2;
  const seasonStartMs = Date.UTC(completedSeasonStartYear, 7, 1);
  const seasonEndExclusiveMs = Date.UTC(completedSeasonStartYear + 1, 5, 16);
  const seasonDays = Math.ceil((seasonEndExclusiveMs - seasonStartMs) / DAY_MS);
  const windowCount = Math.ceil(seasonDays / PLAYER_HISTORY_WINDOW_DAYS);
  const elapsedDays = Math.max(0, Math.floor((utcToday - PLAYER_HISTORY_ROTATION_ANCHOR) / DAY_MS));
  const windowIndex = (PLAYER_HISTORY_INITIAL_WINDOW_INDEX + elapsedDays) % windowCount;
  const fromMs = seasonStartMs + windowIndex * PLAYER_HISTORY_WINDOW_DAYS * DAY_MS;
  const toMs = Math.min(fromMs + (PLAYER_HISTORY_WINDOW_DAYS - 1) * DAY_MS, seasonEndExclusiveMs - DAY_MS);
  return {
    from: isoDate(new Date(fromMs)),
    to: isoDate(new Date(toMs)),
    season: String(completedSeasonStartYear),
    windowIndex,
    windowCount
  };
}

async function requestBackfill(fetchImpl: FetchLike, endpoint: URL, token: string): Promise<BackfillReceipt> {
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { accept: "application/json", "x-oddspadi-admin-token": token },
      signal: AbortSignal.timeout(6 * 60_000)
    });
    const body = await response.json().catch(() => null) as BackfillResponseEnvelope | null;
    const receiptStatus = body?.data?.status;
    const receiptSucceeded = body?.success === true && (
      receiptStatus === "no-data" ||
      (receiptStatus === "stored" && body.data?.readback?.evidenceReady === true)
    );
    return {
      success: response.ok && receiptSucceeded,
      status: response.status,
      body
    };
  } catch (error) {
    return {
      success: false,
      status: 504,
      body: { error: error instanceof Error ? error.message : "Football corpus backfill request failed." }
    };
  }
}

export async function runFootballCorpusRefreshWorker({
  siteUrl,
  adminToken,
  scheduleToken,
  leagueId = "39",
  fixtureLimit,
  playerHistoryFixtureLimit,
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
  const historyLimit = boundedInteger(playerHistoryFixtureLimit, 20, 1, 24);
  const dateWindow = footballCorpusDateWindow(now);
  const playerHistoryWindow = footballPlayerHistoryWindow(now);
  const league = clean(leagueId) ?? "39";
  const endpointFor = (window: { from: string; to: string; season: string }, contextLimit: number) => {
    const endpoint = new URL("/api/sports/decision/training/historical-provider-storage-receipt", baseUrl);
    endpoint.searchParams.set("provider", "api-football");
    endpoint.searchParams.set("league", league);
    endpoint.searchParams.set("seasonFrom", window.season);
    endpoint.searchParams.set("seasonTo", window.season);
    endpoint.searchParams.set("from", window.from);
    endpoint.searchParams.set("to", window.to);
    endpoint.searchParams.set("intervalDays", String(PLAYER_HISTORY_WINDOW_DAYS));
    endpoint.searchParams.set("includePlayerStats", "1");
    endpoint.searchParams.set("maxContextFixtures", String(contextLimit));
    endpoint.searchParams.set("limit", "250");
    endpoint.searchParams.set("maxJobs", "1");
    endpoint.searchParams.set("stopOnError", "1");
    endpoint.searchParams.set("dryRun", "0");
    endpoint.searchParams.set("run", "1");
    return endpoint;
  };
  const recentEndpoint = endpointFor(dateWindow, limit);
  recentEndpoint.searchParams.set("intervalDays", "2");
  recentEndpoint.searchParams.set("includeEvents", "1");
  recentEndpoint.searchParams.set("includeLineups", "1");
  recentEndpoint.searchParams.set("maxEventFixtures", String(limit));
  const recentReceipt = await requestBackfill(fetchImpl, recentEndpoint, token);
  const playerHistoryReceipt = await requestBackfill(fetchImpl, endpointFor(playerHistoryWindow, historyLimit), token);
  const success = recentReceipt.success && playerHistoryReceipt.success;
  const upstreamFailureStatus = [recentReceipt.status, playerHistoryReceipt.status].find((status) => status >= 400) ?? 502;
  const status = success ? 200 : recentReceipt.success || playerHistoryReceipt.success ? 207 : upstreamFailureStatus;

  return Response.json(
    {
      success,
      pipelineStatus: success ? "completed" : status === 207 ? "partial" : "failed",
      mode: "scheduled-football-corpus-refresh",
      leagueId: league,
      recent: { dateWindow, fixtureLimit: limit, receipt: recentReceipt },
      playerHistory: { dateWindow: playerHistoryWindow, fixtureLimit: historyLimit, receipt: playerHistoryReceipt }
    },
    { status }
  );
}

export default async function footballCorpusRefreshWorker(request: Request, context: Context): Promise<Response> {
  return runFootballCorpusRefreshWorker({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    leagueId: clean(Netlify.env.get("ODDSPADI_FOOTBALL_CORPUS_LEAGUE_ID")) ?? "39",
    fixtureLimit: clean(Netlify.env.get("ODDSPADI_FOOTBALL_CORPUS_FIXTURE_LIMIT")),
    playerHistoryFixtureLimit: clean(Netlify.env.get("ODDSPADI_FOOTBALL_PLAYER_HISTORY_FIXTURE_LIMIT"))
  });
}
