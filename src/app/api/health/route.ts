import { isConfiguredSecretValue } from "@/lib/env";

export const dynamic = "force-dynamic";

function anyConfigured(...keys: string[]): boolean {
  return keys.some((key) => isConfiguredSecretValue(process.env[key]));
}

/**
 * Lightweight health/readiness endpoint.
 *
 * Public payload is safe (no secrets, no per-provider detail) and suitable for
 * uptime monitors. Supplying the admin token (Authorization: Bearer <token>, or
 * ?token=) additionally returns a per-provider configuration breakdown — the
 * quick config check that the archived ops console used to provide.
 */
export function GET(request: Request) {
  const providers = {
    apiFootball: anyConfigured("API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"),
    apiBasketball: anyConfigured("API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"),
    apiTennis: anyConfigured("API_TENNIS_KEY", "SPORTS_API_KEY"),
    theOddsApi: anyConfigured("THE_ODDS_API_KEY", "ODDS_API_KEY"),
    supabase: anyConfigured("SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY"),
    openai: anyConfigured("OPENAI_API_KEY")
  };

  const providerConfigured = providers.apiFootball || providers.theOddsApi;
  const storageConfigured = providers.supabase;
  // Provider credentials alone do not make the product live-data ready. The
  // prediction and corpus tables are protected by RLS, so the server also
  // needs its private Supabase credential before it can read or write them.
  const liveDataReady = providerConfigured && storageConfigured;

  const adminToken = process.env.ODDSPADI_ADMIN_TOKEN?.trim();
  const url = new URL(request.url);
  const presented = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim() || url.searchParams.get("token")?.trim();
  const authorized = Boolean(adminToken && presented && presented === adminToken);

  return Response.json(
    {
      status: "ok",
      time: new Date().toISOString(),
      liveDataReady,
      readiness: {
        provider: providerConfigured ? "configured" : "unconfigured",
        storage: storageConfigured ? "configured" : "unconfigured",
        publicOutput: "not-checked"
      },
      ...(authorized
        ? {
            providers,
            config: {
              analysisLeagues: (process.env.API_FOOTBALL_LEAGUE_IDS ?? "39").split(",").map((id) => id.trim()).filter(Boolean).length,
              maxEnrichedFixtures: Number(process.env.API_FOOTBALL_MAX_ENRICHED_FIXTURES) || 20,
              historicalOddsRuntime: /^(1|true|yes|on)$/i.test(process.env.ODDS_API_ALLOW_HISTORICAL_RUNTIME ?? "")
            }
          }
        : {})
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
