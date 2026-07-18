import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingDatabaseRelation } from "@/lib/security/databaseError";
import { finishProviderRun, startProviderRun } from "@/lib/sports/intelligence/repository";
import { buildDecisionOutcomeSettlement } from "@/lib/sports/prediction/decisionOutcomeSettlement";
import { marketLineFromLabel } from "@/lib/sports/results/publicPicks";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupportedSport = "football" | "basketball" | "tennis";
type CommunityTipResult = "won" | "lost" | "push" | "void";

export type SettleableCommunityTip = {
  id: string;
  fixtureId: string;
  sport: SupportedSport;
  kickoffAt: string;
  market: string;
  selection: string;
  selectionLabel: string;
  tippedOdds: number;
  stakeUnits: number;
  withdrawnAt: string | null;
};

export type CommunitySettlementFixture = {
  provider: string;
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled";
  homeScore: number | null;
  awayScore: number | null;
  observedAt: string;
};

export type CommunityTipSettlementDecision = {
  status: "settled" | "waiting" | "manual_review";
  result: CommunityTipResult | null;
  netUnits: number | null;
  reason: string;
};

export type CommunityTipSettlementRun = {
  status: "completed" | "partial" | "empty" | "unavailable" | "not_enabled";
  generatedAt: string;
  totals: {
    candidates: number;
    settled: number;
    won: number;
    lost: number;
    pushed: number;
    voided: number;
    waiting: number;
    manualReview: number;
    failed: number;
  };
  errors: string[];
  items: Array<{ tipId: string; fixtureId: string; result: CommunityTipResult; netUnits: number; reason: string }>;
};

type CommunityTipRow = Record<string, unknown>;

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function relation(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return value[0] && typeof value[0] === "object" ? value[0] as Record<string, unknown> : null;
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function netUnits(result: CommunityTipResult, odds: number, stake: number): number {
  const value = result === "won" ? stake * (odds - 1) : result === "lost" ? -stake : 0;
  return Math.round(value * 10_000) / 10_000;
}

function isProviderBacked(provider: string): boolean {
  const normalized = provider.toLowerCase();
  return !["manual", "mock", "demo", "preview", "seed"].some((marker) => normalized.includes(marker));
}

export function resolveCommunityTipSettlement(
  tip: SettleableCommunityTip,
  fixture: CommunitySettlementFixture | null,
  now = new Date()
): CommunityTipSettlementDecision {
  if (tip.withdrawnAt) {
    return { status: "settled", result: "void", netUnits: 0, reason: "The tipster withdrew this tip before the publication lock." };
  }
  const kickoff = Date.parse(tip.kickoffAt);
  if (!Number.isFinite(kickoff)) return { status: "manual_review", result: null, netUnits: null, reason: "Kickoff time is invalid." };
  if (kickoff > now.getTime()) return { status: "waiting", result: null, netUnits: null, reason: "Waiting for kickoff." };
  const overdue = now.getTime() - kickoff > 24 * 60 * 60_000;
  if (!fixture || !isProviderBacked(fixture.provider)) {
    return {
      status: overdue ? "manual_review" : "waiting",
      result: null,
      netUnits: null,
      reason: overdue ? "A provider-backed fixture receipt is still missing after 24 hours." : "Waiting for a provider-backed fixture receipt."
    };
  }
  if (fixture.status === "cancelled") {
    return { status: "settled", result: "void", netUnits: 0, reason: "The provider marked the fixture cancelled." };
  }
  if (fixture.status === "postponed") {
    return overdue
      ? { status: "settled", result: "void", netUnits: 0, reason: "The fixture remained postponed beyond the 24-hour void window." }
      : { status: "waiting", result: null, netUnits: null, reason: "The provider marked the fixture postponed." };
  }
  if (fixture.status === "scheduled" || fixture.status === "live") {
    return { status: "waiting", result: null, netUnits: null, reason: fixture.status === "live" ? "The fixture is live." : "Waiting for a final provider status." };
  }
  if (fixture.homeScore === null || fixture.awayScore === null) {
    return {
      status: overdue ? "manual_review" : "waiting",
      result: null,
      netUnits: null,
      reason: overdue ? "The finished fixture still has no complete provider score after 24 hours." : "Waiting for the complete provider score."
    };
  }
  if (tip.sport === "tennis" && !["match_winner", "moneyline"].includes(tip.market)) {
    return { status: "manual_review", result: null, netUnits: null, reason: "Stored tennis set scores cannot prove a game-total or handicap result." };
  }

  const preview = buildDecisionOutcomeSettlement({
    fixtureExternalId: tip.fixtureId,
    sport: tip.sport,
    market: tip.market,
    selection: tip.selection,
    homeScore: fixture.homeScore,
    awayScore: fixture.awayScore,
    line: marketLineFromLabel(tip.selectionLabel),
    odds: tip.tippedOdds,
    settledAt: now.toISOString(),
    source: "community-tip-settlement"
  }, now);
  if (!preview.result || preview.result === "pending") {
    return { status: "manual_review", result: null, netUnits: null, reason: preview.reasons.join(" ").slice(0, 500) };
  }
  const result: CommunityTipResult = preview.result;
  return {
    status: "settled",
    result,
    netUnits: netUnits(result, tip.tippedOdds, tip.stakeUnits),
    reason: `${preview.summary} Final provider score ${fixture.homeScore}-${fixture.awayScore}.`.slice(0, 500)
  };
}

function rowToCandidate(row: CommunityTipRow): { tip: SettleableCommunityTip; fixture: CommunitySettlementFixture | null } | null {
  const sport = text(row.sport) as SupportedSport | null;
  const tippedOdds = finiteNumber(row.tipped_odds);
  const stakeUnits = finiteNumber(row.stake_units);
  if (!sport || !["football", "basketball", "tennis"].includes(sport) || !tippedOdds || !stakeUnits) return null;
  const revisions = Array.isArray(row.revisions) ? row.revisions as Array<Record<string, unknown>> : [];
  const withdrawal = revisions.find((revision) => revision.revision_kind === "withdrawal");
  const fixtureRow = relation(row.fixture);
  const provider = text(fixtureRow?.provider);
  const status = text(fixtureRow?.status) as CommunitySettlementFixture["status"] | null;
  const observedAt = text(fixtureRow?.last_synced_at) ?? text(fixtureRow?.updated_at);
  return {
    tip: {
      id: String(row.id),
      fixtureId: String(row.fixture_id),
      sport,
      kickoffAt: String(row.kickoff_at),
      market: String(row.market),
      selection: String(row.selection),
      selectionLabel: String(row.selection_label),
      tippedOdds,
      stakeUnits,
      withdrawnAt: text(withdrawal?.created_at)
    },
    fixture: provider && status && observedAt ? {
      provider,
      status,
      homeScore: finiteNumber(fixtureRow?.home_score),
      awayScore: finiteNumber(fixtureRow?.away_score),
      observedAt
    } : null
  };
}

export async function runCommunityTipSettlement({
  now = new Date(),
  limit = 250,
  persist = true,
  client = getSupabaseServerClient()
}: {
  now?: Date;
  limit?: number;
  persist?: boolean;
  client?: SupabaseClient | null;
} = {}): Promise<CommunityTipSettlementRun> {
  const generatedAt = now.toISOString();
  const totals = { candidates: 0, settled: 0, won: 0, lost: 0, pushed: 0, voided: 0, waiting: 0, manualReview: 0, failed: 0 };
  if (!client) return { status: "unavailable", generatedAt, totals, errors: ["OddsPadi Supabase server storage is not configured."], items: [] };
  const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
  const { data, error } = await client
    .from("op_community_tips")
    .select("id,fixture_id,sport,kickoff_at,market,selection,selection_label,tipped_odds,stake_units,fixture:op_fixtures!op_community_tips_fixture_db_id_fkey(provider,status,home_score,away_score,last_synced_at,updated_at),revisions:op_community_tip_revisions(revision_kind,created_at),settlement:op_community_tip_settlements(tip_id)")
    .order("kickoff_at", { ascending: true })
    .limit(safeLimit);
  if (error && isMissingDatabaseRelation(error)) return { status: "not_enabled", generatedAt, totals, errors: [], items: [] };
  if (error) return { status: "unavailable", generatedAt, totals, errors: [error.message], items: [] };

  const candidates = ((data ?? []) as CommunityTipRow[])
    .filter((row) => !relation(row.settlement))
    .map(rowToCandidate)
    .filter((value): value is NonNullable<ReturnType<typeof rowToCandidate>> => Boolean(value));
  totals.candidates = candidates.length;
  const claim = persist ? await startProviderRun({ providerName: "stored-provider-fixtures", jobType: "settle-community-tips", startedAt: generatedAt, client }) : null;
  if (claim && !claim.acquired) {
    return { status: "partial", generatedAt, totals, errors: claim.run.errors, items: [] };
  }

  const items: CommunityTipSettlementRun["items"] = [];
  const settlementRows: Array<Record<string, unknown>> = [];
  for (const candidate of candidates) {
    const decision = resolveCommunityTipSettlement(candidate.tip, candidate.fixture, now);
    if (decision.status === "waiting") totals.waiting += 1;
    if (decision.status === "manual_review") totals.manualReview += 1;
    if (decision.status !== "settled" || !decision.result || decision.netUnits === null) continue;
    const fixture = candidate.fixture;
    items.push({ tipId: candidate.tip.id, fixtureId: candidate.tip.fixtureId, result: decision.result, netUnits: decision.netUnits, reason: decision.reason });
    settlementRows.push({
      tip_id: candidate.tip.id,
      result: decision.result,
      net_units: decision.netUnits,
      source: candidate.tip.withdrawnAt ? "tipster-withdrawal" : "stored-provider-fixture",
      provider: fixture?.provider ?? null,
      home_score: fixture?.homeScore ?? null,
      away_score: fixture?.awayScore ?? null,
      fixture_observed_at: fixture?.observedAt ?? candidate.tip.withdrawnAt,
      settlement_version: "community-v1",
      reason: decision.reason,
      settled_at: generatedAt
    });
  }

  const errors: string[] = [];
  if (persist && settlementRows.length) {
    const { data: stored, error: writeError } = await client
      .from("op_community_tip_settlements")
      .upsert(settlementRows, { onConflict: "tip_id", ignoreDuplicates: true })
      .select("tip_id,result");
    if (writeError) {
      totals.failed = settlementRows.length;
      errors.push(writeError.message);
    } else {
      const storedIds = new Set((stored ?? []).map((row) => String(row.tip_id)));
      totals.settled = storedIds.size;
      for (const item of items.filter((entry) => storedIds.has(entry.tipId))) {
        if (item.result === "won") totals.won += 1;
        if (item.result === "lost") totals.lost += 1;
        if (item.result === "push") totals.pushed += 1;
        if (item.result === "void") totals.voided += 1;
      }
    }
  } else if (!persist) {
    totals.settled = settlementRows.length;
    totals.won = items.filter((item) => item.result === "won").length;
    totals.lost = items.filter((item) => item.result === "lost").length;
    totals.pushed = items.filter((item) => item.result === "push").length;
    totals.voided = items.filter((item) => item.result === "void").length;
  }

  const status: CommunityTipSettlementRun["status"] = !candidates.length ? "empty" : errors.length ? "partial" : "completed";
  if (claim?.run) await finishProviderRun(claim.run, {
    finishedAt: generatedAt,
    status: status === "empty" ? "empty" : status === "partial" ? "partial" : "completed",
    fixturesFound: candidates.length,
    oddsFound: 0,
    predictionsGenerated: totals.settled,
    valuePicksPublished: 0,
    errors
  }, client);
  return { status, generatedAt, totals, errors, items };
}
