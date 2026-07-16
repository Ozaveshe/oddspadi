import type { PredictionHistoryItem } from "@/lib/sports/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { PublicPickResult, PublicPickSettlementStatus, PublicPickStatus } from "@/lib/sports/results/publicPicks";

export type PublicPredictionHistoryItem = PredictionHistoryItem & {
  sport: string;
  market: string;
  league: string | null;
  country: string | null;
  kickoffTime: string;
  createdAt: string;
  publishedAt: string;
  settledAt: string | null;
  publicStatus: PublicPickStatus;
  settlementStatus: PublicPickSettlementStatus;
  settlementReason: string;
  pendingReasonLabel: string | null;
  confidence: string;
  risk: string;
  expectedValue: number;
  dataQuality?: number | null;
  impliedProbability: number;
  noVigProbability: number;
  closingOdds: number | null;
  closingLineValue: number | null;
  modelVersion: string;
  provider?: string;
  recordSource: "public-pick-ledger";
};

export type PublicPredictionHistory = {
  items: PublicPredictionHistoryItem[];
  source: "live" | "unavailable";
  accessPath?: "private-public-pick-repository";
  reason?: string;
  generatedAt: string;
};

export type HistorySummary = {
  totalPublicPicks: number;
  settled: number;
  pending: number;
  manualReview: number;
  wins: number;
  losses: number;
  pushes: number;
  voids: number;
  accuracy: number;
  roi: number;
  averageOdds: number;
  averageClosingLineValue: number | null;
};

export type PublicHistoryFilters = {
  sport?: string;
  result?: string;
  range?: string;
  market?: string;
  publicStatus?: string;
  settlementStatus?: string;
  confidence?: string;
  edge?: "all" | "positive" | "negative";
  now?: Date;
};

type PublicPickRow = {
  id: string;
  fixture_id: string;
  sport: string;
  league: string;
  country: string | null;
  home_team: string;
  away_team: string;
  kickoff_at: string;
  market: string;
  selection: string;
  selection_label: string;
  odds: number | string;
  model_version: string;
  model_probability: number | string;
  implied_probability: number | string;
  no_vig_probability: number | string;
  value_edge: number | string;
  expected_value: number | string;
  data_quality?: number | string | null;
  confidence: string;
  risk: string;
  published_at: string;
  status: PublicPickStatus;
  settlement_status: PublicPickSettlementStatus;
  result: PublicPickResult;
  settlement_reason: string;
  settled_at: string | null;
  closing_odds: number | string | null;
  closing_line_value: number | string | null;
  created_at: string;
  provider?: string;
};

export function pendingSettlementLabel(status: PublicPickSettlementStatus): string | null {
  const labels: Partial<Record<PublicPickSettlementStatus, string>> = {
    waiting_kickoff: "Waiting for kickoff",
    match_live: "Match live",
    awaiting_final_score: "Final score pending",
    awaiting_market_resolution: "Market resolution pending",
    provider_missing: "Provider missing",
    needs_manual_review: "Market needs manual review"
  };
  return labels[status] ?? null;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function publicHistoryItemFromPublicPickRow(row: PublicPickRow): PublicPredictionHistoryItem {
  const result: PublicPickResult = ["won", "lost", "push", "void"].includes(row.result) ? row.result : "pending";
  return {
    id: row.id,
    date: (row.settled_at ?? row.published_at).slice(0, 10),
    match: `${row.home_team} vs ${row.away_team}`,
    pick: row.selection_label || row.selection,
    odds: Number(row.odds),
    modelProbability: Number(row.model_probability),
    edge: Number(row.value_edge),
    result,
    sport: row.sport,
    market: row.market,
    league: row.league || null,
    country: row.country,
    kickoffTime: row.kickoff_at,
    createdAt: row.created_at,
    publishedAt: row.published_at,
    settledAt: row.settled_at,
    publicStatus: row.status,
    settlementStatus: row.settlement_status,
    settlementReason: row.settlement_reason,
    pendingReasonLabel: pendingSettlementLabel(row.settlement_status),
    confidence: row.confidence,
    risk: row.risk,
    expectedValue: Number(row.expected_value),
    dataQuality: nullableNumber(row.data_quality),
    impliedProbability: Number(row.implied_probability),
    noVigProbability: Number(row.no_vig_probability),
    closingOdds: nullableNumber(row.closing_odds),
    closingLineValue: nullableNumber(row.closing_line_value),
    modelVersion: row.model_version,
    provider: row.provider,
    recordSource: "public-pick-ledger"
  };
}

export function isPublicAccuracyEligible(item: PublicPredictionHistoryItem): boolean {
  return item.recordSource === "public-pick-ledger" && item.edge > 0 && (item.result === "won" || item.result === "lost");
}

export function getHistorySummary(items: PublicPredictionHistoryItem[] = []): HistorySummary {
  const accuracyRows = items.filter(isPublicAccuracyEligible);
  const wins = accuracyRows.filter((item) => item.result === "won").length;
  const losses = accuracyRows.filter((item) => item.result === "lost").length;
  const pushes = items.filter((item) => item.result === "push").length;
  const voids = items.filter((item) => item.result === "void").length;
  const settledRows = items.filter((item) => item.settlementStatus === "settled" && item.result !== "void");
  const stake = settledRows.length;
  const profit = settledRows.reduce((sum, item) => item.result === "won" ? sum + item.odds - 1 : item.result === "lost" ? sum - 1 : sum, 0);
  const clv = items.map((item) => item.closingLineValue).filter((value): value is number => value !== null);
  return {
    totalPublicPicks: items.length,
    settled: settledRows.length,
    pending: items.filter((item) => !["settled", "void", "needs_manual_review"].includes(item.settlementStatus)).length,
    manualReview: items.filter((item) => item.settlementStatus === "needs_manual_review").length,
    wins,
    losses,
    pushes,
    voids,
    accuracy: wins + losses ? wins / (wins + losses) : 0,
    roi: stake ? profit / stake : 0,
    averageOdds: items.length ? items.reduce((sum, item) => sum + item.odds, 0) / items.length : 0,
    averageClosingLineValue: clv.length ? clv.reduce((sum, value) => sum + value, 0) / clv.length : null
  };
}

function startOfUtcDay(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function filterPublicPredictionHistory(items: PublicPredictionHistoryItem[], filters: PublicHistoryFilters): PublicPredictionHistoryItem[] {
  const now = filters.now ?? new Date();
  const rangeDays = filters.range && filters.range !== "all" ? Number(filters.range) : null;
  const cutoff = rangeDays && Number.isFinite(rangeDays) ? now.getTime() - rangeDays * 86_400_000 : null;
  return items.filter((item) =>
    (!filters.sport || filters.sport === "all" || item.sport === filters.sport) &&
    (!filters.result || filters.result === "all" || item.result === filters.result) &&
    (!filters.market || filters.market === "all" || item.market === filters.market) &&
    (!filters.publicStatus || filters.publicStatus === "all" || item.publicStatus === filters.publicStatus) &&
    (!filters.settlementStatus || filters.settlementStatus === "all" || item.settlementStatus === filters.settlementStatus) &&
    (!filters.confidence || filters.confidence === "all" || item.confidence === filters.confidence) &&
    (!filters.edge || filters.edge === "all" || (filters.edge === "positive" ? item.edge > 0 : item.edge < 0)) &&
    (!cutoff || new Date(item.publishedAt).getTime() >= cutoff)
  );
}

export function getHistoryWindowSummaries(items: PublicPredictionHistoryItem[], now = new Date()) {
  const todayStart = startOfUtcDay(now);
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 6 * 86_400_000;
  const monthStart = todayStart - 29 * 86_400_000;
  const publishedAfter = (cutoff: number) => items.filter((item) => Date.parse(item.publishedAt) >= cutoff);
  return [
    { id: "today", label: "Today's picks", summary: getHistorySummary(publishedAfter(todayStart)) },
    { id: "yesterday", label: "Yesterday's results", summary: getHistorySummary(items.filter((item) => item.settledAt && Date.parse(item.settledAt) >= yesterdayStart && Date.parse(item.settledAt) < todayStart)) },
    { id: "week", label: "This week", summary: getHistorySummary(publishedAfter(weekStart)) },
    { id: "month", label: "Last 30 days", summary: getHistorySummary(publishedAfter(monthStart)) },
    { id: "all", label: "All time", summary: getHistorySummary(items) }
  ];
}

type PublicHistoryCacheEntry = { expiresAt: number; promise: Promise<PublicPredictionHistory> };
const publicHistoryCache = new Map<string, PublicHistoryCacheEntry>();
export const PUBLIC_HISTORY_READ_TIMEOUT_MS = 3_500;

function publicHistoryReadAbortSignal(): AbortSignal {
  return AbortSignal.timeout(PUBLIC_HISTORY_READ_TIMEOUT_MS);
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message ?? "");
  return "";
}

export function publicHistoryRepositoryFailureReason(error: unknown): string {
  const message = errorMessage(error).replace(/\s+/g, " ").trim();
  if (!message) return "The public pick repository could not be read.";
  if (/<(?:!doctype|html)|\b522\b|timed? out|timeout|aborterror|operation was aborted/i.test(message)) {
    return "The public pick repository timed out before returning a response.";
  }
  if (/connection (?:closed|terminated)|fetch failed/i.test(message)) {
    return "The public pick repository connection closed before returning a response.";
  }
  const detail = message.length > 240 ? `${message.slice(0, 240)}...` : message;
  return `The public pick repository could not be read: ${detail}`;
}

function cacheTtl(env: Record<string, string | undefined>): number {
  const parsed = Number.parseInt(env.ODDSPADI_PUBLIC_HISTORY_CACHE_TTL_MS ?? "300000", 10);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(parsed, 86_400_000)) : 300_000;
}

async function readPublicPredictionHistory(env: Record<string, string | undefined>): Promise<PublicPredictionHistory> {
  const client = getSupabaseServerClient(env);
  if (!client) return { items: [], source: "unavailable", reason: "The public pick repository is not configured for this runtime.", generatedAt: new Date().toISOString() };
  const baseColumns = "id,fixture_id,sport,league,country,home_team,away_team,kickoff_at,market,selection,selection_label,odds,model_version,model_probability,implied_probability,no_vig_probability,value_edge,expected_value,confidence,risk,published_at,status,settlement_status,result,settlement_reason,settled_at,closing_odds,closing_line_value,provider,created_at";
  try {
    const primary = await client.from("op_public_picks")
      .select(`${baseColumns},data_quality`)
      .order("published_at", { ascending: false })
      .limit(1000)
      .abortSignal(publicHistoryReadAbortSignal());
    let data: unknown[] | null = primary.data;
    let error = primary.error;
    // Keep the dashboard readable during a code-before-migration rollout. Older
    // rows remain explicitly unscored; no data-quality value is inferred.
    if (error && /data_quality|column.*not found|schema cache/i.test(error.message)) {
      const fallback = await client.from("op_public_picks")
        .select(baseColumns)
        .order("published_at", { ascending: false })
        .limit(1000)
        .abortSignal(publicHistoryReadAbortSignal());
      data = fallback.data;
      error = fallback.error;
    }
    if (error) return { items: [], source: "unavailable", reason: publicHistoryRepositoryFailureReason(error), generatedAt: new Date().toISOString() };
    return { items: ((data ?? []) as PublicPickRow[]).map(publicHistoryItemFromPublicPickRow), source: "live", accessPath: "private-public-pick-repository", generatedAt: new Date().toISOString() };
  } catch (error) {
    return { items: [], source: "unavailable", reason: publicHistoryRepositoryFailureReason(error), generatedAt: new Date().toISOString() };
  }
}

export async function getPublicPredictionHistory(env: Record<string, string | undefined> = process.env): Promise<PublicPredictionHistory> {
  const ttl = cacheTtl(env);
  if (!ttl) return readPublicPredictionHistory(env);
  const key = `${env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? ""}:public-picks-v2`;
  const now = Date.now();
  const cached = publicHistoryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.promise;
  const promise = readPublicPredictionHistory(env);
  publicHistoryCache.set(key, { expiresAt: now + ttl, promise });
  promise.then((result) => { if (result.source === "unavailable") publicHistoryCache.delete(key); }).catch(() => publicHistoryCache.delete(key));
  return promise;
}
