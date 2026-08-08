import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { WINDOW_MINUTES } from "@/lib/closing/policy";

/**
 * Which fixtures need an odds refresh to make their close capturable.
 *
 * Measured against production, 2026-08-08: in the 90 minutes before kickoff,
 * 84.7% of selections had quotes from exactly one bookmaker and 1.6% had three
 * or more. Six hours out, 31.6% had three or more; at twenty-four hours,
 * 51.8%. Fifteen books quote OddsPadi's fixtures — Pinnacle among them — so the
 * market is there. The sweep simply stops capturing it near kickoff.
 *
 * That is a collection problem, not a policy problem, and the fix is not to
 * widen the definition of "closing" until the gap disappears. A price from
 * twenty-four hours out is not a closing price, and relabelling it as one
 * corrupts every CLV figure downstream.
 *
 * So this exists to make the strict definition *achievable*: a narrow,
 * quota-cheap list of fixtures worth polling in their closing window. Only
 * fixtures carrying a published claim qualify, because a close matters exactly
 * where a claim will be measured against it.
 */

export type ClosingRefreshTarget = {
  fixtureId: string;
  fixtureExternalId: string;
  sport: string;
  kickoffAt: string;
  minutesToKickoff: number;
  publishedClaims: number;
};

export type ClosingRefreshPlan = {
  status: "ready" | "empty" | "unavailable";
  generatedAt: string;
  /** Fixtures in their closing window with a claim riding on them. */
  targets: ClosingRefreshTarget[];
  /** How many provider calls this plan implies, so quota can be reasoned about. */
  estimatedProviderCalls: number;
  errors: string[];
};

/**
 * How close to kickoff a fixture must be to be worth re-polling.
 *
 * Deliberately narrower than the capture window. Polling the whole 90 minutes
 * would triple the call count to buy quotes that the capture then discards for
 * lagging the market; the last stretch is where the books that matter actually
 * move.
 */
export const REFRESH_LEAD_MINUTES = 35;

/**
 * A cap, stated rather than implied.
 *
 * API-Football has returned 429s at 450 requests a minute on this account, so
 * an unbounded pre-kickoff sweep could starve the fixture and results pipelines
 * that share the quota. A plan that would exceed this is truncated and *says*
 * it was truncated, because a silently capped sweep reports success while
 * leaving claims unpriced.
 */
export const MAX_TARGETS_PER_RUN = 40;

type PublicationRow = {
  fixture_id: string | null;
  fixture_external_id: string;
  sport: string;
  kickoff_at: string;
};

export async function planClosingWindowRefresh({
  now = new Date(),
  client = getSupabaseServerClient(),
  maxTargets = MAX_TARGETS_PER_RUN
}: { now?: Date; client?: SupabaseClient | null; maxTargets?: number } = {}): Promise<ClosingRefreshPlan> {
  const generatedAt = now.toISOString();
  if (!client) {
    return {
      status: "unavailable",
      generatedAt,
      targets: [],
      estimatedProviderCalls: 0,
      errors: ["OddsPadi Supabase server storage is not configured."]
    };
  }

  const horizon = new Date(now.getTime() + REFRESH_LEAD_MINUTES * 60_000).toISOString();

  const { data, error } = await client
    .from("op_publications")
    .select("fixture_id,fixture_external_id,sport,kickoff_at")
    .eq("publication_status", "published")
    // Strictly ahead of kickoff. A fixture that has started can no longer
    // acquire a closing price, and polling it spends quota on a quote the
    // capture would refuse as late.
    .gt("kickoff_at", generatedAt)
    .lte("kickoff_at", horizon)
    .order("kickoff_at", { ascending: true })
    .limit(500);
  if (error) {
    return { status: "unavailable", generatedAt, targets: [], estimatedProviderCalls: 0, errors: [error.message] };
  }

  const rows = (data ?? []) as unknown as PublicationRow[];
  if (!rows.length) {
    return { status: "empty", generatedAt, targets: [], estimatedProviderCalls: 0, errors: [] };
  }

  // One target per fixture however many claims ride on it: the provider call
  // fetches the fixture's whole odds board, not one selection.
  const byFixture = new Map<string, ClosingRefreshTarget>();
  for (const row of rows) {
    if (!row.fixture_id) continue;
    const held = byFixture.get(row.fixture_id);
    if (held) {
      held.publishedClaims += 1;
      continue;
    }
    byFixture.set(row.fixture_id, {
      fixtureId: row.fixture_id,
      fixtureExternalId: row.fixture_external_id,
      sport: row.sport,
      kickoffAt: row.kickoff_at,
      minutesToKickoff: Math.round((new Date(row.kickoff_at).getTime() - now.getTime()) / 60_000),
      publishedClaims: 1
    });
  }

  // Soonest kickoff first: the fixture closest to its close is the one whose
  // window is about to shut.
  const ordered = [...byFixture.values()].sort((a, b) => a.minutesToKickoff - b.minutesToKickoff);
  const targets = ordered.slice(0, Math.max(1, maxTargets));
  const dropped = ordered.length - targets.length;

  return {
    status: "ready",
    generatedAt,
    targets,
    estimatedProviderCalls: targets.length,
    errors: dropped > 0
      ? [
          `${dropped} fixture(s) in their closing window were not scheduled this run (cap ${maxTargets}). ` +
            "Their closes will record insufficient_sources rather than being silently skipped."
        ]
      : []
  };
}

/**
 * Whether a fixture is inside the window where a captured quote can count.
 *
 * Exported so the refresh and the capture cannot drift: if one of them decides
 * a quote is in the closing window and the other does not, the sweep spends
 * quota on prices the capture then refuses.
 */
export function isInsideClosingWindow(kickoffAt: string, observedAt: string): boolean {
  const lead = (new Date(kickoffAt).getTime() - new Date(observedAt).getTime()) / 60_000;
  return lead >= 0 && lead <= WINDOW_MINUTES;
}
