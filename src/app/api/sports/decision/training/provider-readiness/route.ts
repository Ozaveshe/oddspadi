import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import {
  buildApiFootballProviderReadinessProbe,
  buildTheOddsApiProviderReadinessProbe,
  type ProviderReadinessProbeRequest
} from "@/lib/sports/training/providerReadinessProbe";

export const dynamic = "force-dynamic";

type ProbeBody = Partial<ProviderReadinessProbeRequest> & {
  provider?: string;
  includeEvents?: boolean | string;
  includeContext?: boolean | string;
  includeStandings?: boolean | string;
  includeAvailability?: boolean | string;
  includeLineups?: boolean | string;
  includeNews?: boolean | string;
  includeWeather?: boolean | string;
  limit?: number | string;
  sportKey?: string;
  regions?: string;
  bookmakers?: string;
};

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim() || undefined : undefined;
}

function pickText(url: URL, body: ProbeBody | null, key: keyof ProbeBody): string | undefined {
  const queryValue = url.searchParams.get(String(key));
  if (queryValue !== null) return queryValue.trim() || undefined;
  return cleanText(body?.[key]);
}

function parseBooleanFlag(url: URL, body: ProbeBody | null, key: keyof ProbeBody): boolean | undefined {
  const queryValue = url.searchParams.get(String(key));
  if (queryValue !== null) return queryValue !== "0" && queryValue.toLowerCase() !== "false";
  const bodyValue = body?.[key];
  if (typeof bodyValue === "boolean") return bodyValue;
  if (typeof bodyValue === "string") return bodyValue !== "0" && bodyValue.toLowerCase() !== "false";
  return undefined;
}

function parseLimit(url: URL, body: ProbeBody | null): number | undefined {
  const raw = url.searchParams.get("limit") ?? body?.limit;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 5) : undefined;
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Provider readiness requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as ProbeBody | null;
  const provider = pickText(url, body, "provider") ?? "api-football";
  if (provider !== "api-football" && provider !== "the-odds-api") {
    return apiError("provider-readiness currently supports provider=api-football or provider=the-odds-api.");
  }

  if (provider === "the-odds-api") {
    const result = await buildTheOddsApiProviderReadinessProbe({
      request: {
        provider: "the-odds-api",
        sportKey: pickText(url, body, "sportKey"),
        date: pickText(url, body, "date"),
        regions: pickText(url, body, "regions"),
        bookmakers: pickText(url, body, "bookmakers"),
        limit: parseLimit(url, body)
      },
      baseUrl: url.origin
    });

    return apiSuccess(result, { status: result.status === "blocked" ? 503 : 200 });
  }

  const result = await buildApiFootballProviderReadinessProbe({
    request: {
      provider: "api-football",
      league: pickText(url, body, "league"),
      season: pickText(url, body, "season"),
      date: pickText(url, body, "date"),
      from: pickText(url, body, "from"),
      to: pickText(url, body, "to"),
      includeEvents: parseBooleanFlag(url, body, "includeEvents"),
      includeContext: parseBooleanFlag(url, body, "includeContext"),
      includeStandings: parseBooleanFlag(url, body, "includeStandings"),
      includeAvailability: parseBooleanFlag(url, body, "includeAvailability"),
      includeLineups: parseBooleanFlag(url, body, "includeLineups"),
      includeNews: parseBooleanFlag(url, body, "includeNews"),
      includeWeather: parseBooleanFlag(url, body, "includeWeather"),
      limit: parseLimit(url, body)
    },
    baseUrl: url.origin
  });

  return apiSuccess(result, { status: result.status === "blocked" ? 503 : 200 });
}
