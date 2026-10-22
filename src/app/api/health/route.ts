import { withApiHandler } from "@/app/api/sports/_utils";
import { isConfiguredSecretValue } from "@/lib/env";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { getSupabaseRuntimeStatus } from "@/lib/supabase/server";
import { getDailySlate } from "@/lib/sports/intelligence/pipeline";

export const dynamic = "force-dynamic";

function anyConfigured(...keys: string[]): boolean {
  return keys.some((key) => isConfiguredSecretValue(process.env[key]));
}

/**
 * Lightweight health/readiness endpoint.
 *
 * Public payload is safe (no secrets, no per-provider detail) and suitable for
 * uptime monitors. Supplying the admin token in an Authorization bearer header
 * additionally returns a per-provider configuration breakdown — the
 * quick config check that the archived ops console used to provide.
 */
// Wrapped so a throw from the Supabase runtime probe returns a structured 500
// rather than an unhandled crash — this is the endpoint uptime monitors poll.
export const GET = withApiHandler(async (request: Request) => {
  const supabaseRuntime = getSupabaseRuntimeStatus();
  const providers = {
    apiFootball: anyConfigured("API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"),
    apiBasketball: anyConfigured("API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"),
    apiTennis: anyConfigured("API_TENNIS_KEY", "SPORTS_API_KEY"),
    theOddsApi: anyConfigured("THE_ODDS_API_KEY", "ODDS_API_KEY"),
    supabase: supabaseRuntime.serverWriteReady,
    openai: anyConfigured("OPENAI_API_KEY")
  };

  const providerConfigured = providers.apiFootball || providers.theOddsApi;
  const storageConfigured = providers.supabase;
  // Provider credentials alone do not make the product live-data ready. The
  // prediction and corpus tables are protected by RLS, so the server also
  // needs its private Supabase credential before it can read or write them.
  const configurationReady = providerConfigured && storageConfigured;
  let publicOutput = "unavailable";
  if (configurationReady) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const slate = await Promise.race([
        getDailySlate({ ensure: false }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Readiness deadline")), 5000); })
      ]);
      const run = slate.provider.lastRun;
      const finished = Date.parse(run?.finishedAt ?? "");
      const fresh = Number.isFinite(finished) && Date.now() - finished >= 0 && Date.now() - finished <= 45 * 60_000;
      publicOutput = !fresh ? "stale" :
        slate.provider.status === "empty" && slate.fixtures.length === 0 ? "empty" :
        slate.provider.status === "completed" && slate.fixtures.length > 0 && slate.summary.predictionsGenerated > 0 ? "ready" : "degraded";
    } catch {
      publicOutput = "unavailable";
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  const liveDataReady = configurationReady && ["ready", "empty"].includes(publicOutput);

  const authorized = isCronAuthorized(request);

  return Response.json(
    {
      status: liveDataReady ? "ok" : "degraded",
      time: new Date().toISOString(),
      liveDataReady,
      readiness: {
        provider: providerConfigured ? "configured" : "unconfigured",
        storage: storageConfigured ? "configured" : "unconfigured",
        publicOutput
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
    { status: liveDataReady ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
});
