import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaptureStatus } from "@/lib/closing/policy";

/**
 * Reading captured closes back onto the claims they belong to.
 *
 * `op_closing_prices` has held the closes since `close.v1` shipped, but nothing
 * read it: the track record resolved `closingOdds` out of `op_publications.metadata`,
 * a key no production writer has ever set. So the ledger carried closing data
 * and the page that exists to report it rendered 0% coverage — not because the
 * capture was missing, but because the two halves were never joined.
 *
 * A companion read rather than a PostgREST embed, matching `readPublicationReceipt`:
 * foreign-key embeds across these tables have been a recurring source of
 * silently empty arrays here, and a silently empty embed would reproduce
 * exactly the bug this module exists to close.
 */

export type LedgerClose = {
  /** Null on every status except `captured` — enforced by a check constraint. */
  closingOdds: number | null;
  closingProbability: number | null;
  publishedProbabilityNoVig: number | null;
  captureStatus: CaptureStatus;
  /** Present exactly when `closingOdds` is absent. Why there is no close. */
  missingReason: string | null;
  source: string | null;
  sourceCount: number | null;
  closeObservedAt: string | null;
  capturedAt: string | null;
};

export type ClosingPriceLookup = {
  /** Keyed by publication id. A claim with no attempt is simply absent. */
  byPublicationId: Map<string, LedgerClose>;
  /**
   * True when the companion read failed.
   *
   * The caller keeps its publications and reports coverage from whatever it
   * could resolve. What it must not do is present "no close" as a measurement
   * when the truth is that the closing table could not be read.
   */
  unavailable: boolean;
  unavailableReason: string | null;
};

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const CLOSING_COLUMNS =
  "publication_id,closing_odds,closing_probability,published_probability_novig," +
  "capture_status,missing_reason,source,source_count,close_observed_at,captured_at";

/** PostgREST `in` lists get unwieldy well before this; the ledger page is 200 at most. */
const MAX_IDS = 500;

export async function readClosingPricesFor(
  publicationIds: string[],
  client: SupabaseClient | null
): Promise<ClosingPriceLookup> {
  const empty = (unavailable: boolean, reason: string | null): ClosingPriceLookup => ({
    byPublicationId: new Map(),
    unavailable,
    unavailableReason: reason
  });

  const ids = [...new Set(publicationIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (!ids.length) return empty(false, null);
  if (!client) return empty(true, "Supabase server storage is not configured in this runtime.");

  const byPublicationId = new Map<string, LedgerClose>();
  for (let index = 0; index < ids.length; index += MAX_IDS) {
    const { data, error } = await client
      .from("op_closing_prices")
      .select(CLOSING_COLUMNS)
      .eq("is_current", true)
      .in("publication_id", ids.slice(index, index + MAX_IDS));
    if (error) return empty(true, error.message);

    for (const raw of (data ?? []) as unknown as Array<Record<string, unknown>>) {
      const publicationId = typeof raw.publication_id === "string" ? raw.publication_id : null;
      if (!publicationId) continue;
      const odds = numberOrNull(raw.closing_odds);
      byPublicationId.set(publicationId, {
        // A price of 1.00 or less is not a price. The database forbids it, and
        // refusing it here too means a corrupted row reads as absent rather
        // than dragging an average toward zero.
        closingOdds: odds !== null && odds > 1 ? odds : null,
        closingProbability: numberOrNull(raw.closing_probability),
        publishedProbabilityNoVig: numberOrNull(raw.published_probability_novig),
        captureStatus: String(raw.capture_status) as CaptureStatus,
        missingReason: raw.missing_reason === null || raw.missing_reason === undefined ? null : String(raw.missing_reason),
        source: raw.source === null || raw.source === undefined ? null : String(raw.source),
        sourceCount: numberOrNull(raw.source_count),
        closeObservedAt: raw.close_observed_at ? String(raw.close_observed_at) : null,
        capturedAt: raw.captured_at ? String(raw.captured_at) : null
      });
    }
  }

  return { byPublicationId, unavailable: false, unavailableReason: null };
}
