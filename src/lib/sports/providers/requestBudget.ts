import { getSupabaseServerClient } from "@/lib/supabase/server";

type Env = Record<string, string | undefined>;
type Reserve = (provider: string, units: number, limit: number) => Promise<boolean>;

function countList(value: string | null): number {
  return new Set((value ?? "").split(",").map(item => item.trim()).filter(Boolean)).size;
}

// Charge an upper bound before dispatch. Even a timed-out request can be billed.
export async function reserveProviderRequest(url: URL, env: Env, reserve?: Reserve): Promise<void> {
  const odds = url.hostname === "api.the-odds-api.com";
  if (!odds && url.hostname !== "v3.football.api-sports.io") return;
  const configured = odds ? env.ODDS_API_DAILY_CREDIT_CAP : env.API_FOOTBALL_DAILY_REQUEST_CAP;
  if (!configured?.trim()) return;
  const provider = odds ? "the-odds-api" : "api-football";
  let units = 1;
  if (odds) {
    const path = url.pathname.replace(/\/+$/, "");
    if (path === "/v4/sports" || /^\/v4\/sports\/[^/]+\/events$/.test(path)) return;
    if (path.endsWith("/scores")) units = url.searchParams.has("daysFrom") ? 2 : 1;
    else if (path.endsWith("/odds")) {
      const books = countList(url.searchParams.get("bookmakers"));
      const regions = books ? Math.ceil(books / 10) : Math.max(1, countList(url.searchParams.get("regions")));
      units = regions * Math.max(1, countList(url.searchParams.get("markets"))) * (path.startsWith("/v4/historical/") ? 10 : 1);
    } else throw new Error("Unclassified paid provider endpoint");
  }
  const limit = Number(configured);
  if (!Number.isSafeInteger(limit) || limit < units || limit > 2147483647) throw new Error("Provider daily budget unavailable");
  const claim = reserve ?? (async (name, cost, cap) => {
    const db = getSupabaseServerClient(env);
    if (!db) return false;
    const { data, error } = await db.rpc("op_reserve_provider_units", { p_provider: name, p_units: cost, p_limit: cap });
    return !error && data === true;
  });
  if (!await claim(provider, units, limit)) throw new Error("Provider daily budget exhausted or unavailable");
}
type UpstreamFetch = (url: string | URL, init?: RequestInit) => Promise<Response>;

/** Supply the same failure response as an unavailable feed to import adapters. */
export function budgetedProviderFetch(env: Env, upstream: UpstreamFetch): UpstreamFetch {
  return async (url, init) => {
    try {
      await reserveProviderRequest(new URL(String(url)), env);
    } catch {
      return Response.json({ message: "Provider daily budget exhausted or unavailable." }, { status: 503 });
    }
    return upstream(url, init);
  };
}
