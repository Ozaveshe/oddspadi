import { NextResponse } from "next/server";
import { isSupportedSport, todayIsoDate } from "@/lib/sports/service";
import type { Sport } from "@/lib/sports/types";

export function apiSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

/**
 * Response init for public, non-personalised JSON: lets the Netlify CDN share
 * one cached copy across visitors (the same pattern /api/live uses), so client
 * polling and page hydration stop re-running the provider pipeline.
 */
export function publicCacheInit(sMaxAgeSeconds: number, varyQueryKeys: readonly string[] = []): ResponseInit {
  const headers: Record<string, string> = {
    "Cache-Control": `public, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${sMaxAgeSeconds * 5}`
  };
  if (varyQueryKeys.length) headers["Netlify-Vary"] = `query=${varyQueryKeys.join("|")}`;
  return { headers };
}

export function apiError(error: string, status = 400) {
  return NextResponse.json({ success: false, data: null, error }, { status });
}

/**
 * Wrap a route handler so an unexpected throw returns a structured JSON 500
 * (logged server-side) instead of a raw unhandled crash. Adopt on any route
 * whose handler can throw — especially the public data routes.
 */
export function withApiHandler<A extends unknown[]>(handler: (request: Request, ...args: A) => Promise<Response> | Response) {
  return async (request: Request, ...args: A): Promise<Response> => {
    try {
      return await handler(request, ...args);
    } catch (error) {
      try {
        console.error(`[api] ${new URL(request.url).pathname} failed:`, error);
      } catch {
        console.error("[api] request failed:", error);
      }
      // Keep provider, database, and configuration detail in server logs. A
      // public 500 must not reveal table names, credentials, or upstream URLs.
      return apiError("Something went wrong on our side.", 500);
    }
  };
}

/**
 * How far either side of today a caller may ask for.
 *
 * The date routes are CDN-cached with `Netlify-Vary: query=date`, so every
 * distinct value mints a distinct cache entry *and* a distinct upstream
 * provider call. A format-only check accepted roughly three million valid
 * `YYYY-MM-DD` strings (and impossible ones like `2026-99-99`), which is enough
 * for a single client to blow out the edge cache and burn the provider quota.
 * A bounded window keeps the key space proportional to the product.
 */
const DATE_WINDOW_DAYS = 400;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Rejects impossible calendar dates that still match the ISO shape. */
function isRealIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseIsoDateParam(
  value: string | null,
  fallback: string = todayIsoDate()
): { date: string } | { error: string } {
  if (value === null || value === "") return { date: fallback };
  if (!ISO_DATE.test(value) || !isRealIsoDate(value)) return { error: "Invalid date. Use YYYY-MM-DD." };

  const requested = Date.parse(`${value}T00:00:00.000Z`);
  const today = Date.parse(`${todayIsoDate()}T00:00:00.000Z`);
  const distanceDays = Math.abs(requested - today) / 86_400_000;
  if (distanceDays > DATE_WINDOW_DAYS) {
    return { error: `Date is out of range. Use a date within ${DATE_WINDOW_DAYS} days of today.` };
  }

  return { date: value };
}

export function parseSportsQuery(request: Request): { date: string; sport: Sport } | { error: string } {
  const url = new URL(request.url);
  const parsedDate = parseIsoDateParam(url.searchParams.get("date"));
  if ("error" in parsedDate) return parsedDate;

  const sportParam = url.searchParams.get("sport") ?? "football";
  if (!isSupportedSport(sportParam)) {
    return { error: "Invalid sport." };
  }

  return { date: parsedDate.date, sport: sportParam };
}

// Filters reach query builders and `ilike` patterns. Cap them so an oversized
// value cannot be turned into an expensive scan or an outsized cache key.
const MAX_FILTER_LENGTH = 120;

function optionalParam(value: string | null): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim().slice(0, MAX_FILTER_LENGTH);
  return normalized ? normalized : undefined;
}

export function parsePredictionFilters(request: Request) {
  const url = new URL(request.url);
  return {
    league: optionalParam(url.searchParams.get("league")),
    country: optionalParam(url.searchParams.get("country")),
    confidence: optionalParam(url.searchParams.get("confidence")),
    query: optionalParam(url.searchParams.get("query") ?? url.searchParams.get("q"))
  };
}

export function parsePublicHistoryFlag(request: Request): boolean {
  const url = new URL(request.url);
  const value = url.searchParams.get("publicHistory") ?? url.searchParams.get("historical");
  return value === "1" || value === "true";
}
