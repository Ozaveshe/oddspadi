import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { OfficialPublicationSummary } from "@/lib/domain/canonicalReads";
import { settlementStatusFromLegacy, type PublicationStatus } from "@/lib/domain/states";

/**
 * The official publication for one fixture, if OddsPadi published a pick.
 *
 * The match page must show settlement from the ledger rather than inferring a
 * result from the score — a pick can be void or pushed on a match that has a
 * perfectly clear scoreline. One indexed lookup on the fixture's external id.
 */
export async function readPublicationForFixture(fixtureExternalId: string): Promise<OfficialPublicationSummary | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;
  const { data, error } = await client
    .from("op_publications")
    .select(
      "id,fixture_id,fixture_external_id,sport,competition,market,selection,selection_label," +
        "model_probability,odds_at_publication,implied_probability,published_at,kickoff_at," +
        "publication_status,settlement_status,settled_at,correction_reason,revision"
    )
    .eq("fixture_external_id", fixtureExternalId)
    // A retracted claim is withdrawn; the page must not present it as a pick.
    .in("publication_status", ["published", "corrected"])
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;

  return {
    publicationId: String(row.id),
    fixtureId: String(row.fixture_id),
    fixtureExternalId: String(row.fixture_external_id),
    sport: String(row.sport),
    competition: String(row.competition),
    market: String(row.market),
    selection: String(row.selection),
    selectionLabel: String(row.selection_label),
    modelProbability: Number(row.model_probability),
    oddsAtPublication: Number(row.odds_at_publication),
    impliedProbability: Number(row.implied_probability),
    publishedAt: String(row.published_at),
    kickoffAt: String(row.kickoff_at),
    publicationStatus: String(row.publication_status) as PublicationStatus,
    settlementStatus: settlementStatusFromLegacy(String(row.settlement_status)),
    settledAt: row.settled_at ? String(row.settled_at) : null,
    correctionReason: row.correction_reason ? String(row.correction_reason) : null,
    revision: Number(row.revision) || 1
  };
}
