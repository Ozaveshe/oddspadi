import { NextResponse } from "next/server";
import { isSupportedSport, todayIsoDate } from "@/lib/sports/service";
import type { Sport } from "@/lib/sports/types";

export function apiSuccess<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ success: true, data }, init);
}

export function apiError(error: string, status = 400) {
  return NextResponse.json({ success: false, data: null, error }, { status });
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
