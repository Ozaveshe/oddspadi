import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { runPublicPickSettlement, type PublicSettlementRun } from "./settlement";

export type ResultsBackfillSummary = {
  pending: number;
  settled: number;
  voided: number;
  duplicates: number;
  manualReview: number;
  providerMissing: number;
  internalTagged: number;
};

export function summarizeResultsBackfill({
  pending,
  duplicateRows,
  internalTagged,
  settlement
}: {
  pending: number;
  duplicateRows: number;
  internalTagged: number;
  settlement: Pick<PublicSettlementRun, "totals">;
}): ResultsBackfillSummary {
  return {
    pending,
    settled: settlement.totals.settled,
    voided: settlement.totals.voided,
    duplicates: duplicateRows,
    manualReview: settlement.totals.manualReview,
    providerMissing: settlement.totals.providerMissing,
    internalTagged
  };
}

type LegacyRow = {
  id: string;
  fixture_external_id: string;
  market: string;
  selection: string;
  created_at: string;
  result: string;
  metadata: Record<string, unknown> | null;
};

function legacyKey(row: LegacyRow): string {
  const modelVersion = typeof row.metadata?.modelVersion === "string" ? row.metadata.modelVersion : "legacy";
  return [row.fixture_external_id, row.market, row.selection, modelVersion, row.created_at.slice(0, 10)].join("|");
}

export type ResultsBackfillRun = {
  status: "completed" | "preview" | "unavailable" | "partial";
  generatedAt: string;
  summary: ResultsBackfillSummary;
  settlement: PublicSettlementRun | null;
  errors: string[];
};

export async function runPublicResultsBackfill({
  execute = false,
  now = new Date(),
  client = getSupabaseServerClient()
}: {
  execute?: boolean;
  now?: Date;
  client?: SupabaseClient | null;
} = {}): Promise<ResultsBackfillRun> {
  const generatedAt = now.toISOString();
  const emptySummary = summarizeResultsBackfill({ pending: 0, duplicateRows: 0, internalTagged: 0, settlement: { totals: { pendingRead: 0, settled: 0, voided: 0, waitingKickoff: 0, live: 0, awaitingScore: 0, awaitingMarket: 0, providerMissing: 0, manualReview: 0, failed: 0 } } });
  if (!client) return { status: "unavailable", generatedAt, summary: emptySummary, settlement: null, errors: ["OddsPadi Supabase server storage is not configured."] };

  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const [{ data: pendingRows, error: pendingError }, { data: legacyRows, error: legacyError }] = await Promise.all([
    client.from("op_public_picks").select("id").not("settlement_status", "in", "(settled,void)").lt("published_at", cutoff).limit(5000),
    client.from("op_prediction_outcomes").select("id,fixture_external_id,market,selection,created_at,result,metadata").order("created_at", { ascending: true }).limit(5000)
  ]);
  const errors = [pendingError?.message, legacyError?.message].filter((value): value is string => Boolean(value));
  if (errors.length) return { status: "unavailable", generatedAt, summary: emptySummary, settlement: null, errors };

  const legacy = (legacyRows ?? []) as LegacyRow[];
  const groups = new Map<string, number>();
  for (const row of legacy) groups.set(legacyKey(row), (groups.get(legacyKey(row)) ?? 0) + 1);
  const duplicateRows = [...groups.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
  // Settled legacy outcomes are protected by an immutability trigger. They stay
  // in the private archive and are excluded publicly by the ledger boundary.
  const untagged = legacy.filter(
    (row) => row.result === "pending" && (row.metadata?.internalOnly !== true || row.metadata?.publicLedgerEligible !== false)
  );

  if (execute) {
    for (const row of untagged) {
      const metadata = { ...(row.metadata ?? {}), internalOnly: true, publicLedgerEligible: false, legacyClassification: "internal-model-run" };
      const { error } = await client.from("op_prediction_outcomes").update({ metadata, updated_at: generatedAt }).eq("id", row.id);
      if (error) errors.push(`${row.id}: ${error.message}`);
    }
  }
  const settlement = execute ? await runPublicPickSettlement({ now, limit: 1000, persist: true, client }) : null;
  if (settlement) errors.push(...settlement.errors);
  const summary = summarizeResultsBackfill({
    pending: (pendingRows ?? []).length,
    duplicateRows,
    internalTagged: untagged.length,
    settlement: settlement ?? { totals: { pendingRead: 0, settled: 0, voided: 0, waitingKickoff: 0, live: 0, awaitingScore: 0, awaitingMarket: 0, providerMissing: 0, manualReview: 0, failed: 0 } }
  });
  return { status: !execute ? "preview" : errors.length ? "partial" : "completed", generatedAt, summary, settlement, errors };
}
