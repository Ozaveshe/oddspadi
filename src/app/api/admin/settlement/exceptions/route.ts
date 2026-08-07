import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const KINDS = new Set([
  "result_conflict",
  "unknown_market",
  "missing_line",
  "ambiguous_retirement",
  "abandoned_fixture",
  "duplicate_result",
  "missing_participant_identity",
  "provider_correction",
  "close_missing",
  "close_insufficient_sources",
  "close_identity_failure",
  "close_market_unmapped",
  "close_late_data",
  "alias_duplicate",
  "alias_impossible_line",
  "alias_orientation",
  "alias_incompatible_settlement",
  "alias_version_conflict",
  "alias_overround"
]);
const STATES = new Set(["open", "acknowledged", "resolved", "dismissed"]);

/**
 * The operations queue.
 *
 * Read-only. Filters are validated against closed sets rather than passed
 * through, because an unvalidated filter reaching PostgREST is both an
 * injection surface and a way to get an empty list that looks like good news.
 */
export const GET = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Unauthorized.", 401);

  const params = new URL(request.url).searchParams;
  const kind = params.get("kind");
  const state = params.get("state") ?? "open";
  const requestedLimit = Number(params.get("limit") ?? "100");
  const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(500, requestedLimit)) : 100;

  if (kind && !KINDS.has(kind)) return apiError(`Unknown exception kind "${kind}".`);
  if (!STATES.has(state)) return apiError(`Unknown state "${state}".`);

  const client = getSupabaseServerClient();
  if (!client) return apiError("Server storage is not configured.", 503);

  let query = client
    .from("op_settlement_exceptions")
    .select("id,kind,severity,fixture_id,publication_id,market,selection,detail,state,first_seen_at,last_seen_at")
    .eq("state", state)
    .order("severity", { ascending: true })
    .order("first_seen_at", { ascending: true })
    .limit(limit);
  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query;
  // An unreadable queue is not an empty queue, and must not render as one.
  if (error) return apiError(error.message, 503);

  return apiSuccess({ state, kind, count: (data ?? []).length, exceptions: data ?? [] });
});
