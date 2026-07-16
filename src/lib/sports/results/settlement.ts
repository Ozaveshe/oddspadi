import type { SupabaseClient } from "@supabase/supabase-js";
import type { Match, Sport } from "@/lib/sports/types";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { buildDecisionOutcomeSettlement } from "@/lib/sports/prediction/decisionOutcomeSettlement";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { finishProviderRun, startProviderRun } from "@/lib/sports/intelligence/repository";
import type { PublicPickResult, PublicPickSettlementStatus, PublicPickStatus } from "./publicPicks";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const SETTLEMENT_DELAY_MS: Record<"football" | "basketball" | "tennis", number> = {
  football: 60 * 60_000,
  basketball: 30 * 60_000,
  tennis: 30 * 60_000
};

export type SettleablePublicPick = {
  id: string;
  fixtureId: string;
  sport: "football" | "basketball" | "tennis";
  kickoffAt: string;
  market: string;
  selection: string;
  marketLine: number | null;
  odds: number;
  modelProbability: number;
  impliedProbability: number;
  valueEdge: number;
  status: PublicPickStatus;
  settlementStatus: PublicPickSettlementStatus;
  result: PublicPickResult;
  finalStatusObservedAt: string | null;
  closingOdds: number | null;
};

export type SettlementFixture = {
  fixtureId: string;
  providerBacked: boolean;
  status: "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "suspended";
  homeScore: number | null;
  awayScore: number | null;
  statusDetail: string | null;
  observedAt: string;
};

export type PublicPickSettlementDecision = {
  status: PublicPickStatus;
  settlementStatus: PublicPickSettlementStatus;
  result: PublicPickResult;
  settlementReason: string;
  settledAt: string | null;
  finalStatusObservedAt: string | null;
  finalScore: { home: number; away: number } | null;
  closingLineValue: number | null;
};

function time(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function closingLineValue(odds: number, closingOdds: number | null): number | null {
  if (!closingOdds || closingOdds <= 1) return null;
  return Number((odds / closingOdds - 1).toFixed(6));
}

function pending(
  pick: SettleablePublicPick,
  settlementStatus: PublicPickSettlementStatus,
  settlementReason: string,
  finalStatusObservedAt = pick.finalStatusObservedAt
): PublicPickSettlementDecision {
  return {
    status: pick.status,
    settlementStatus,
    result: "pending",
    settlementReason,
    settledAt: null,
    finalStatusObservedAt,
    finalScore: null,
    closingLineValue: null
  };
}

function manualReview(pick: SettleablePublicPick, reason: string): PublicPickSettlementDecision {
  return pending(pick, "needs_manual_review", reason);
}

function terminal(pick: SettleablePublicPick): PublicPickSettlementDecision {
  return {
    status: pick.status,
    settlementStatus: pick.settlementStatus,
    result: pick.result,
    settlementReason: pick.result === "void" ? "The public pick was voided." : "The public pick is already settled.",
    settledAt: null,
    finalStatusObservedAt: pick.finalStatusObservedAt,
    finalScore: null,
    closingLineValue: closingLineValue(pick.odds, pick.closingOdds)
  };
}

export function resolvePublicPickSettlement(
  pick: SettleablePublicPick,
  fixture: SettlementFixture | null,
  now = new Date()
): PublicPickSettlementDecision {
  if (pick.settlementStatus === "settled" || pick.settlementStatus === "void") return terminal(pick);
  const nowMs = now.getTime();
  const kickoffMs = time(pick.kickoffAt);
  if (kickoffMs === null) return manualReview(pick, "Kickoff time is invalid; settlement needs manual review.");
  if (kickoffMs > nowMs) return pending(pick, "waiting_kickoff", "Waiting for kickoff.");
  const overdue = nowMs - kickoffMs > DAY;

  if (!fixture || !fixture.providerBacked) {
    return overdue
      ? manualReview(pick, "Provider result is still missing more than 24 hours after kickoff.")
      : pending(pick, "provider_missing", "Provider fixture/result is temporarily unavailable.");
  }
  if (fixture.status === "cancelled") {
    return {
      status: "void",
      settlementStatus: "void",
      result: "void",
      settlementReason: "Provider marked the match cancelled; the public pick is void.",
      settledAt: now.toISOString(),
      finalStatusObservedAt: pick.finalStatusObservedAt ?? fixture.observedAt,
      finalScore: null,
      closingLineValue: null
    };
  }
  if (fixture.status === "postponed") {
    return overdue
      ? {
          status: "void",
          settlementStatus: "void",
          result: "void",
          settlementReason: "Provider still marks the match postponed after 24 hours; the public pick is void.",
          settledAt: now.toISOString(),
          finalStatusObservedAt: pick.finalStatusObservedAt,
          finalScore: null,
          closingLineValue: null
        }
      : pending(pick, "awaiting_final_score", "Match is postponed; waiting for a provider reschedule or void window.");
  }
  if (fixture.status === "suspended") {
    return overdue
      ? manualReview(pick, "Match remains suspended more than 24 hours after kickoff.")
      : pending(pick, "awaiting_final_score", "Match is suspended; final result is not available.");
  }
  if (fixture.status === "live") return pending(pick, "match_live", "Match is live; settlement waits for the final result.");
  if (fixture.status !== "finished") {
    return overdue
      ? manualReview(pick, "Provider has not supplied a final match status more than 24 hours after kickoff.")
      : pending(pick, "awaiting_final_score", "Waiting for provider final score.");
  }

  const detail = fixture.statusDetail?.toLowerCase() ?? "";
  if (pick.sport === "tennis" && (detail.includes("retired") || detail.includes("walkover"))) {
    return {
      status: "void",
      settlementStatus: "void",
      result: "void",
      settlementReason: `Provider marked the tennis match ${detail.includes("walkover") ? "walkover" : "retired"}; the pick is void under the public settlement policy.`,
      settledAt: now.toISOString(),
      finalStatusObservedAt: pick.finalStatusObservedAt ?? fixture.observedAt,
      finalScore: fixture.homeScore === null || fixture.awayScore === null ? null : { home: fixture.homeScore, away: fixture.awayScore },
      closingLineValue: null
    };
  }
  if (fixture.homeScore === null || fixture.awayScore === null) {
    return overdue
      ? manualReview(pick, "Match is finished but a complete provider score is still missing after 24 hours.")
      : pending(pick, "awaiting_final_score", "Match is finished; waiting for a complete provider final score.");
  }
  if (pick.sport === "tennis" && pick.market !== "match_winner" && pick.market !== "moneyline") {
    return overdue
      ? manualReview(pick, "Provider score does not contain enough game-level detail to settle this tennis market.")
      : pending(pick, "awaiting_market_resolution", "Tennis totals need provider game-level score detail before settlement.");
  }

  const observedAt = pick.finalStatusObservedAt ?? fixture.observedAt ?? now.toISOString();
  const observedMs = time(observedAt) ?? nowMs;
  const remaining = SETTLEMENT_DELAY_MS[pick.sport] - (nowMs - observedMs);
  if (remaining > 0) {
    return pending(
      pick,
      "awaiting_market_resolution",
      `Final score observed; settlement safety delay has ${Math.ceil(remaining / 60_000)} minute(s) remaining.`,
      observedAt
    );
  }

  const preview = buildDecisionOutcomeSettlement({
    fixtureExternalId: pick.fixtureId,
    sport: pick.sport,
    market: pick.market,
    selection: pick.selection,
    homeScore: fixture.homeScore,
    awayScore: fixture.awayScore,
    line: pick.marketLine,
    modelProbability: pick.modelProbability,
    impliedProbability: pick.impliedProbability,
    valueEdge: pick.valueEdge,
    odds: pick.odds,
    closingOdds: pick.closingOdds,
    settledAt: now.toISOString(),
    source: "public-pick-settlement"
  }, now);
  if (!preview.result) {
    return nowMs - observedMs > DAY
      ? manualReview(pick, `Market could not be resolved automatically: ${preview.reasons.join(" ")}`)
      : pending(pick, "awaiting_market_resolution", `Market resolution is pending: ${preview.reasons.join(" ")}`, observedAt);
  }
  return {
    status: preview.result === "void" ? "void" : "settled",
    settlementStatus: preview.result === "void" ? "void" : "settled",
    result: preview.result,
    settlementReason: `${preview.summary} Final score ${fixture.homeScore}-${fixture.awayScore}.`,
    settledAt: now.toISOString(),
    finalStatusObservedAt: observedAt,
    finalScore: { home: fixture.homeScore, away: fixture.awayScore },
    closingLineValue: preview.settlement.closingLineValue
  };
}

type PublicPickRow = Record<string, unknown>;

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowToPick(row: PublicPickRow): SettleablePublicPick | null {
  const sport = String(row.sport) as SettleablePublicPick["sport"];
  if (!["football", "basketball", "tennis"].includes(sport)) return null;
  const odds = number(row.odds);
  const modelProbability = number(row.model_probability);
  const impliedProbability = number(row.implied_probability);
  const valueEdge = number(row.value_edge);
  if (!odds || modelProbability === null || impliedProbability === null || valueEdge === null) return null;
  return {
    id: String(row.id), fixtureId: String(row.fixture_id), sport, kickoffAt: String(row.kickoff_at), market: String(row.market),
    selection: String(row.selection), marketLine: number(row.market_line), odds, modelProbability, impliedProbability, valueEdge,
    status: row.status as PublicPickStatus, settlementStatus: row.settlement_status as PublicPickSettlementStatus,
    result: row.result as PublicPickResult, finalStatusObservedAt: typeof row.final_status_observed_at === "string" ? row.final_status_observed_at : null,
    closingOdds: number(row.closing_odds)
  };
}

function normalizeTeam(value: string): string {
  return value.toLowerCase().replace(/\b(fc|cf|afc|sc|ac|city|united)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function fixtureForPick(pick: SettleablePublicPick, matches: Match[]): Match | null {
  const exact = matches.find((match) => match.id === pick.fixtureId || match.dataSource?.fixtureProviderId === pick.fixtureId.split(":").at(-1));
  return exact?.dataSource?.kind === "provider" ? exact : null;
}

function settlementFixture(match: Match | null, now: Date): SettlementFixture | null {
  if (!match) return null;
  return {
    fixtureId: match.id,
    providerBacked: match.dataSource?.kind === "provider",
    status: match.status,
    homeScore: number(match.score?.home),
    awayScore: number(match.score?.away),
    statusDetail: match.dataSource?.statusDetail ?? null,
    observedAt: match.dataSource?.fetchedAt ?? now.toISOString()
  };
}

export type PublicSettlementRun = {
  status: "completed" | "partial" | "empty" | "unavailable";
  generatedAt: string;
  totals: {
    pendingRead: number;
    settled: number;
    voided: number;
    waitingKickoff: number;
    live: number;
    awaitingScore: number;
    awaitingMarket: number;
    providerMissing: number;
    manualReview: number;
    failed: number;
  };
  errors: string[];
  items: Array<{ publicPickId: string; fixtureId: string; result: PublicPickResult; settlementStatus: PublicPickSettlementStatus; reason: string }>;
};

export async function runPublicPickSettlement({
  now = new Date(),
  limit = 250,
  persist = true,
  client = getSupabaseServerClient(),
  provider = new ProviderBackedSportsDataProvider()
}: {
  now?: Date;
  limit?: number;
  persist?: boolean;
  client?: SupabaseClient | null;
  provider?: Pick<ProviderBackedSportsDataProvider, "getFixtures">;
} = {}): Promise<PublicSettlementRun> {
  const generatedAt = now.toISOString();
  const emptyTotals = { pendingRead: 0, settled: 0, voided: 0, waitingKickoff: 0, live: 0, awaitingScore: 0, awaitingMarket: 0, providerMissing: 0, manualReview: 0, failed: 0 };
  if (!client) return { status: "unavailable", generatedAt, totals: emptyTotals, errors: ["OddsPadi Supabase server storage is not configured."], items: [] };
  const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
  const claim = persist ? await startProviderRun({ providerName: "configured-sports-providers", jobType: "settle-results", startedAt: generatedAt, client }) : null;
  const run = claim?.run ?? null;
  if (claim && !claim.acquired) {
    return {
      status: "empty",
      generatedAt,
      totals: emptyTotals,
      errors: run?.errors ?? ["Skipped overlapping settle-results run."],
      items: []
    };
  }
  const { data, error } = await client.from("op_public_picks")
    .select("id,fixture_id,sport,kickoff_at,market,selection,market_line,odds,model_probability,implied_probability,value_edge,status,settlement_status,result,final_status_observed_at,closing_odds")
    .not("settlement_status", "in", "(settled,void)")
    .order("kickoff_at", { ascending: true })
    .limit(safeLimit);
  if (error) return { status: "unavailable", generatedAt, totals: emptyTotals, errors: [error.message], items: [] };
  const picks = (data ?? []).map(rowToPick).filter((pick): pick is SettleablePublicPick => Boolean(pick));
  const errors: string[] = [];
  const matchesByGroup = new Map<string, Match[]>();
  const groups = [...new Set(picks.map((pick) => `${pick.sport}:${pick.kickoffAt.slice(0, 10)}`))];
  await Promise.all(groups.map(async (group) => {
    const [sport, date] = group.split(":") as [SettleablePublicPick["sport"], string];
    try {
      const matches = (await provider.getFixtures(date, sport as Sport)).filter((match) => match.dataSource?.kind === "provider");
      matchesByGroup.set(group, matches);
    } catch (providerError) {
      errors.push(`${group}: ${providerError instanceof Error ? providerError.message : "provider request failed"}`);
      matchesByGroup.set(group, []);
    }
  }));

  const items: PublicSettlementRun["items"] = [];
  for (const pick of picks) {
    const group = `${pick.sport}:${pick.kickoffAt.slice(0, 10)}`;
    const match = fixtureForPick(pick, matchesByGroup.get(group) ?? []);
    const decision = resolvePublicPickSettlement(pick, settlementFixture(match, now), now);
    if (persist) {
      const { error: updateError } = await client.from("op_public_picks").update({
        status: decision.status,
        settlement_status: decision.settlementStatus,
        result: decision.result,
        settlement_reason: decision.settlementReason,
        settled_at: decision.settledAt,
        final_status_observed_at: decision.finalStatusObservedAt,
        final_score: decision.finalScore,
        closing_line_value: decision.closingLineValue,
        updated_at: generatedAt
      }).eq("id", pick.id).not("settlement_status", "in", "(settled,void)");
      if (updateError) {
        emptyTotals.failed += 1;
        errors.push(`${pick.id}: ${updateError.message}`);
        continue;
      }
    }
    items.push({ publicPickId: pick.id, fixtureId: pick.fixtureId, result: decision.result, settlementStatus: decision.settlementStatus, reason: decision.settlementReason });
  }

  const totals = { ...emptyTotals, pendingRead: picks.length };
  totals.settled = items.filter((item) => item.settlementStatus === "settled").length;
  totals.voided = items.filter((item) => item.settlementStatus === "void").length;
  totals.waitingKickoff = items.filter((item) => item.settlementStatus === "waiting_kickoff").length;
  totals.live = items.filter((item) => item.settlementStatus === "match_live").length;
  totals.awaitingScore = items.filter((item) => item.settlementStatus === "awaiting_final_score").length;
  totals.awaitingMarket = items.filter((item) => item.settlementStatus === "awaiting_market_resolution").length;
  totals.providerMissing = items.filter((item) => item.settlementStatus === "provider_missing").length;
  totals.manualReview = items.filter((item) => item.settlementStatus === "needs_manual_review").length;
  totals.failed = errors.filter((item) => /^[-\w]+:/.test(item) && !item.includes("provider request failed")).length;
  const status: PublicSettlementRun["status"] = !picks.length ? "empty" : errors.length ? "partial" : "completed";
  if (run) await finishProviderRun(run, {
    finishedAt: generatedAt,
    status: status === "completed" ? "completed" : status === "empty" ? "empty" : "partial",
    fixturesFound: groups.length,
    oddsFound: 0,
    predictionsGenerated: totals.settled + totals.voided,
    valuePicksPublished: 0,
    errors
  }, client);
  return { status, generatedAt, totals, errors, items };
}

// Retained for deterministic matching tests and future provider-name fallback.
export const normalizeSettlementTeam = normalizeTeam;
