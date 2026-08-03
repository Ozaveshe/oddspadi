import type { SupabaseClient } from "@supabase/supabase-js";
import { escapeIlikePattern } from "@/lib/security/inputValidation";
import { isKnownSport } from "@/lib/sports/service";
import type { Sport } from "@/lib/sports/types";

export type SportsAssetKind = "team" | "league";

export type SportsAsset = {
  key: string;
  kind: SportsAssetKind;
  sport: Sport;
  provider: string;
  externalId: string;
  name: string;
  country: string | null;
  logoUrl: string | null;
  flagUrl: string | null;
  updatedAt: string;
  provenance: {
    source: "provider-metadata";
    provider: string;
    usage: "identification-only";
    rights: "third-party-trademark";
  };
};

export type SportsAssetQuery = {
  kind: SportsAssetKind;
  sport?: Sport;
  provider?: string;
  externalId?: string;
  query?: string;
  page: number;
  limit: number;
  hasLogo: boolean;
};

export type SportsAssetPage = {
  assets: SportsAsset[];
  pagination: {
    page: number;
    limit: number;
    hasMore: boolean;
    nextPage: number | null;
  };
};

type AssetRow = {
  provider: string;
  sport: string;
  external_id: string;
  name: string;
  country: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string;
};

const MAX_FILTER_LENGTH = 80;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PAGE = 500;

function optionalFilter(value: string | null, pattern: RegExp): string | undefined {
  const cleaned = value?.replace(/\s+/g, " ").trim();
  return cleaned && cleaned.length <= MAX_FILTER_LENGTH && pattern.test(cleaned) ? cleaned : undefined;
}

function positiveInteger(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= maximum ? parsed : null;
}

export function parseSportsAssetQuery(request: Request): SportsAssetQuery | { error: string } {
  const params = new URL(request.url).searchParams;
  const rawKind = params.get("kind") ?? "team";
  if (rawKind !== "team" && rawKind !== "league") return { error: "Invalid asset kind. Use team or league." };

  const rawSport = params.get("sport");
  let sport: Sport | undefined;
  if (rawSport) {
    if (!isKnownSport(rawSport)) return { error: "Invalid sport." };
    sport = rawSport;
  }

  const provider = optionalFilter(params.get("provider"), /^[A-Za-z0-9_-]+$/);
  if (params.has("provider") && !provider) return { error: "Invalid provider." };

  const externalId = optionalFilter(params.get("externalId"), /^[A-Za-z0-9:_.-]+$/);
  if (params.has("externalId") && !externalId) return { error: "Invalid externalId." };

  const query = optionalFilter(params.get("q"), /^[\p{L}\p{N} .,'&()/_-]+$/u);
  if (params.has("q") && (!query || query.length < 2)) return { error: "Search text must be 2 to 80 characters." };

  const page = positiveInteger(params.get("page"), 1, MAX_PAGE);
  if (page === null) return { error: `Invalid page. Use a value from 1 to ${MAX_PAGE}.` };
  const limit = positiveInteger(params.get("limit"), DEFAULT_LIMIT, MAX_LIMIT);
  if (limit === null) return { error: `Invalid limit. Use a value from 1 to ${MAX_LIMIT}.` };

  const rawHasLogo = params.get("hasLogo");
  if (rawHasLogo !== null && !["true", "false", "1", "0"].includes(rawHasLogo)) {
    return { error: "Invalid hasLogo value. Use true or false." };
  }

  return {
    kind: rawKind,
    ...(sport ? { sport } : {}),
    ...(provider ? { provider } : {}),
    ...(externalId ? { externalId } : {}),
    ...(query ? { query } : {}),
    page,
    limit,
    hasLogo: rawHasLogo === null || rawHasLogo === "true" || rawHasLogo === "1"
  };
}

export function usableSportsAssetUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function mapAsset(row: AssetRow, kind: SportsAssetKind): SportsAsset {
  const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? row.metadata : {};
  return {
    key: [kind, row.sport, row.provider, row.external_id].map(encodeURIComponent).join("/"),
    kind,
    sport: row.sport as Sport,
    provider: row.provider,
    externalId: row.external_id,
    name: row.name,
    country: row.country,
    logoUrl: usableSportsAssetUrl(metadata.logo),
    flagUrl: kind === "league" ? usableSportsAssetUrl(metadata.flag) : null,
    updatedAt: row.updated_at,
    provenance: {
      source: "provider-metadata",
      provider: row.provider,
      usage: "identification-only",
      rights: "third-party-trademark"
    }
  };
}

export async function readSportsAssets(client: SupabaseClient, query: SportsAssetQuery): Promise<SportsAssetPage> {
  const table = query.kind === "team" ? "op_teams" : "op_leagues";
  const from = (query.page - 1) * query.limit;
  let builder = client
    .from(table)
    .select("provider,sport,external_id,name,country,metadata,updated_at")
    .order("name", { ascending: true })
    .order("provider", { ascending: true })
    .order("external_id", { ascending: true });

  if (query.sport) builder = builder.eq("sport", query.sport);
  if (query.provider) builder = builder.eq("provider", query.provider);
  if (query.externalId) builder = builder.eq("external_id", query.externalId);
  if (query.query) builder = builder.ilike("name", `%${escapeIlikePattern(query.query)}%`);
  if (query.hasLogo) builder = builder.not("metadata->>logo", "is", null).neq("metadata->>logo", "");

  const { data, error } = await builder.range(from, from + query.limit);
  if (error) throw new Error(`Sports asset catalogue read failed: ${error.message}`);
  const rows = (data ?? []) as AssetRow[];
  const hasMore = rows.length > query.limit;
  return {
    assets: rows.slice(0, query.limit).map((row) => mapAsset(row, query.kind)),
    pagination: {
      page: query.page,
      limit: query.limit,
      hasMore,
      nextPage: hasMore ? query.page + 1 : null
    }
  };
}
