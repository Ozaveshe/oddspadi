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

export function parseSportsQuery(request: Request): { date: string; sport: Sport } | { error: string } {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? todayIsoDate();
  const sportParam = url.searchParams.get("sport") ?? "football";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "Invalid date. Use YYYY-MM-DD." };
  }

  if (!isSupportedSport(sportParam)) {
    return { error: "Invalid sport." };
  }

  return { date, sport: sportParam };
}

function optionalParam(value: string | null): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
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
