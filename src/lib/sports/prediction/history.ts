import type { PredictionHistoryItem } from "@/lib/sports/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabasePublicReadClient } from "@/lib/supabase/publicReadClient";

export const predictionHistory: PredictionHistoryItem[] = [
  {
    id: "hist-001",
    date: "2026-06-20",
    match: "Kano Pillars vs Enyimba",
    pick: "Kano Pillars",
    odds: 2.15,
    modelProbability: 0.53,
    edge: 0.065,
    result: "won"
  },
  {
    id: "hist-002",
    date: "2026-06-20",
    match: "Arsenal vs Chelsea",
    pick: "Over 2.5 Goals",
    odds: 1.88,
    modelProbability: 0.57,
    edge: 0.038,
    result: "lost"
  },
  {
    id: "hist-003",
    date: "2026-06-21",
    match: "Barcelona vs Sevilla",
    pick: "Barcelona",
    odds: 1.72,
    modelProbability: 0.64,
    edge: 0.059,
    result: "won"
  },
  {
    id: "hist-004",
    date: "2026-06-21",
    match: "Sundowns vs Orlando Pirates",
    pick: "Both Teams To Score",
    odds: 2.05,
    modelProbability: 0.52,
    edge: 0.032,
    result: "push"
  },
  {
    id: "hist-005",
    date: "2026-06-22",
    match: "Milan vs Lazio",
    pick: "Milan",
    odds: 2.2,
    modelProbability: 0.51,
    edge: 0.055,
    result: "lost"
  },
  {
    id: "hist-006",
    date: "2026-06-23",
    match: "Hearts of Oak vs Asante Kotoko",
    pick: "Under 2.5 Goals",
    odds: 1.93,
    modelProbability: 0.55,
    edge: 0.032,
    result: "pending"
  }
];

export function getHistorySummary(items = predictionHistory) {
  const settled = items.filter((item) => item.result === "won" || item.result === "lost");
  const wins = settled.filter((item) => item.result === "won").length;
  const losses = settled.filter((item) => item.result === "lost").length;
  const stake = settled.length;
  const returns = settled.reduce((sum, item) => (item.result === "won" ? sum + item.odds : sum), 0);
  const profit = returns - stake;

  return {
    settled: settled.length,
    wins,
    losses,
    accuracy: settled.length ? wins / settled.length : 0,
    roi: stake ? profit / stake : 0
  };
}

type OutcomeRow = {
  id: string;
  fixture_external_id: string;
  sport: string;
  market: string;
  selection: string;
  model_probability: number | string;
  value_edge: number | string;
  odds: number | string;
  result: string;
  source: string;
  settled_at: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export type PublicPredictionHistoryItem = PredictionHistoryItem & {
  sport: string;
  market: string;
  league: string | null;
  country: string | null;
  kickoffTime: string | null;
  createdAt: string;
  settledAt: string | null;
  engineAction: string | null;
  confidence: string | null;
  paperOnly: boolean;
  recordSource: string;
};

export type PublicPredictionHistory = {
  items: PublicPredictionHistoryItem[];
  source: "live" | "unavailable";
  accessPath?: "private-repository" | "public-projection";
  reason?: string;
  generatedAt: string;
};

type PublicHistoryCacheEntry = { expiresAt: number; promise: Promise<PublicPredictionHistory> };
const publicHistoryCache = new Map<string, PublicHistoryCacheEntry>();

function publicHistoryCacheTtlMs(env: Record<string, string | undefined>): number {
  const parsed = Number.parseInt(env.ODDSPADI_PUBLIC_HISTORY_CACHE_TTL_MS ?? "900000", 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 86_400_000)) : 900_000;
}

function publicHistoryCacheKey(env: Record<string, string | undefined>): string {
  const serverUrl = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serverReady = Boolean(env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SECRET_API_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY);
  const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const publicReady = Boolean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return `${serverUrl}:${serverReady ? "server" : "no-server"}:${publicUrl}:${publicReady ? "public" : "no-public"}`;
}

async function readPublicPredictionHistory(env: Record<string, string | undefined>): Promise<PublicPredictionHistory> {
  const client = getSupabaseServerClient(env);
  if (client) {
    const { data, error } = await client
      .from("op_prediction_outcomes")
      .select("id,fixture_external_id,sport,market,selection,model_probability,value_edge,odds,result,source,settled_at,created_at,metadata")
      .order("created_at", { ascending: false })
      .limit(100);
    if (!error) return { items: (data as OutcomeRow[]).map(publicHistoryItemFromOutcome), source: "live", accessPath: "private-repository", generatedAt: new Date().toISOString() };
  }

  const publicClient = getSupabasePublicReadClient();
  if (!publicClient) return { items: [], source: "unavailable", reason: "The results repository is not configured for this runtime.", generatedAt: new Date().toISOString() };
  const { data, error } = await publicClient
    .from("op_public_prediction_outcomes")
    .select("id,fixture_external_id,sport,league,country,home_team,away_team,kickoff_at,market,selection,recommended_selection,model_probability,value_edge,odds,result,engine_action,confidence,paper_only,record_source,settled_at,created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return { items: [], source: "unavailable", reason: `The results repository could not be read: ${error.message}`, generatedAt: new Date().toISOString() };
  return { items: (data as PublicOutcomeRow[]).map(publicHistoryItemFromProjection), source: "live", accessPath: "public-projection", generatedAt: new Date().toISOString() };
}

export async function getPublicPredictionHistory(env: Record<string, string | undefined> = process.env): Promise<PublicPredictionHistory> {
  const ttl = publicHistoryCacheTtlMs(env);
  if (ttl === 0) return readPublicPredictionHistory(env);

  const key = publicHistoryCacheKey(env);
  const now = Date.now();
  const cached = publicHistoryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  if (cached) publicHistoryCache.delete(key);

  const promise = readPublicPredictionHistory(env);
  const entry = { expiresAt: now + ttl, promise };
  publicHistoryCache.set(key, entry);
  promise.then((result) => {
    if (result.source === "unavailable" && publicHistoryCache.get(key) === entry) publicHistoryCache.delete(key);
  }).catch(() => {
    if (publicHistoryCache.get(key) === entry) publicHistoryCache.delete(key);
  });
  if (publicHistoryCache.size > 8) publicHistoryCache.delete(publicHistoryCache.keys().next().value as string);
  return promise;
}

type PublicOutcomeRow = {
  id: string; fixture_external_id: string; sport: string; league: string | null; country: string | null;
  home_team: string | null; away_team: string | null; kickoff_at: string | null; market: string; selection: string;
  recommended_selection: string | null; model_probability: number | string; value_edge: number | string;
  odds: number | string; result: string; engine_action: string | null; confidence: string | null;
  paper_only: boolean; record_source: string; settled_at: string | null; created_at: string;
};

export function publicHistoryItemFromProjection(row: PublicOutcomeRow): PublicPredictionHistoryItem {
  const rawResult = row.result.toLowerCase();
  const result = rawResult === "won" || rawResult === "lost" || rawResult === "push" || rawResult === "void" ? rawResult : "pending";
  return {
    id: row.id,
    date: (row.settled_at ?? row.created_at).slice(0, 10),
    match: row.home_team && row.away_team ? `${row.home_team} vs ${row.away_team}` : row.fixture_external_id,
    pick: row.recommended_selection ?? row.selection,
    odds: Number(row.odds), modelProbability: Number(row.model_probability), edge: Number(row.value_edge), result,
    sport: row.sport, market: row.market, league: row.league, country: row.country, kickoffTime: row.kickoff_at,
    createdAt: row.created_at, settledAt: row.settled_at, engineAction: row.engine_action,
    confidence: row.confidence, paperOnly: row.paper_only, recordSource: row.record_source
  };
}

export function publicHistoryItemFromOutcome(row: OutcomeRow): PublicPredictionHistoryItem {
    const metadata = row.metadata ?? {};
    const home = typeof metadata.homeTeam === "string" ? metadata.homeTeam : null;
    const away = typeof metadata.awayTeam === "string" ? metadata.awayTeam : null;
    const recommended = typeof metadata.recommendedSelection === "string" ? metadata.recommendedSelection : null;
    const rawResult = row.result.toLowerCase();
    const result = rawResult === "won" || rawResult === "lost" || rawResult === "push" || rawResult === "void" ? rawResult : "pending";
    return {
      id: row.id,
      date: (row.settled_at ?? row.created_at).slice(0, 10),
      match: home && away ? `${home} vs ${away}` : row.fixture_external_id,
      pick: recommended ?? row.selection,
      odds: Number(row.odds),
      modelProbability: Number(row.model_probability),
      edge: Number(row.value_edge),
      result,
      sport: row.sport,
      market: row.market,
      league: typeof metadata.league === "string" ? metadata.league : null,
      country: typeof metadata.country === "string" ? metadata.country : null,
      kickoffTime: typeof metadata.kickoffTime === "string" ? metadata.kickoffTime : null,
      createdAt: row.created_at,
      settledAt: row.settled_at,
      engineAction: typeof metadata.finalAction === "string" ? metadata.finalAction : null,
      confidence: typeof metadata.finalConfidence === "string" ? metadata.finalConfidence : null,
      paperOnly: metadata.paperOnly === true,
      recordSource: row.source
    } satisfies PublicPredictionHistoryItem;
}
