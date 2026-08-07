import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalMarket, CANONICAL_MARKETS } from "@/lib/markets/canonicalMarkets";
import { operatorUnavailable, CLOSING_POLICY_VERSION } from "@/lib/closing/policy";

/**
 * What an authorised analyst may do.
 *
 * The shape of this module is the guarantee. There is no function here that
 * takes an outcome, so "settle this as won" is not expressible: an operator
 * chooses a **rule**, and the engine produces the verdict. And nothing here
 * writes to `op_publications`, so a published probability, price or timestamp
 * cannot be edited through the operator surface at all.
 *
 * Both are asserted by a test rather than left as intentions, because an
 * intention in a comment is not a control.
 */

export type OperatorResult<T> =
  | { status: "ok"; data: T }
  | { status: "rejected"; reason: string }
  | { status: "failed"; reason: string };

export type ActorContext = {
  /**
   * Caller-supplied, not authenticated: the admin surface holds one shared
   * token and has no per-analyst identity. This is accountability, not access
   * control — someone with the token could supply any string — but it makes an
   * unattributed action visible in the trail rather than indistinguishable
   * from an attributed one.
   */
  actor: string;
};

function rejected<T>(reason: string): OperatorResult<T> {
  return { status: "rejected", reason };
}

async function logAction(
  client: SupabaseClient,
  { actor }: ActorContext,
  action: string,
  targetKind: string,
  targetId: string,
  payload: Record<string, unknown>,
  evidence: string | null
): Promise<void> {
  await client.from("op_settlement_operator_actions").insert({
    actor,
    action,
    target_kind: targetKind,
    target_id: targetId,
    payload,
    evidence
  });
}

/**
 * Verify a result a human has checked.
 *
 * `evidence` is required and not merely encouraged. A verification with no
 * stated basis is indistinguishable from a click, and the whole point of the
 * manual path is that a person looked at something the ladder could not
 * resolve.
 */
export async function verifyResultManually(
  client: SupabaseClient | null,
  context: ActorContext,
  { fixtureId, evidence }: { fixtureId: string; evidence: string }
): Promise<OperatorResult<{ fixtureId: string }>> {
  if (!client) return { status: "failed", reason: "Storage is not configured." };
  if (!evidence || evidence.trim().length < 10) {
    return rejected("Verification requires stated evidence of at least 10 characters.");
  }

  const { data, error } = await client
    .from("op_fixture_results")
    .select("id,verification_state")
    .eq("fixture_id", fixtureId)
    .eq("is_current", true)
    .limit(1);
  if (error) return { status: "failed", reason: error.message };

  const current = (data ?? [])[0] as { id: string; verification_state: string } | undefined;
  if (!current) return rejected("No canonical result exists for this fixture yet.");
  if (current.verification_state === "verified") return rejected("This result is already verified.");

  const { error: writeError } = await client
    .from("op_fixture_results")
    .update({ verification_state: "verified", verified_at: new Date().toISOString(), verified_by: context.actor })
    .eq("id", current.id);
  if (writeError) return { status: "failed", reason: writeError.message };

  await logAction(client, context, "verify_result", "fixture", fixtureId, { from: current.verification_state }, evidence);
  return { status: "ok", data: { fixtureId } };
}

/**
 * Settle a claim by choosing a canonical rule.
 *
 * The operator names a market key; the engine grades it. There is no parameter
 * for the outcome, which is what stops this endpoint from being a way to write
 * a preferred verdict onto a public record.
 */
export async function settleByRule(
  client: SupabaseClient | null,
  context: ActorContext,
  { publicationId, marketKey, evidence }: { publicationId: string; marketKey: string; evidence: string }
): Promise<OperatorResult<{ publicationId: string; marketKey: string }>> {
  if (!client) return { status: "failed", reason: "Storage is not configured." };

  const market = canonicalMarket(marketKey);
  if (!market) {
    return rejected(
      `"${marketKey}" is not a canonical market. Choose one of: ${CANONICAL_MARKETS.map((entry) => entry.key).join(", ")}`
    );
  }
  if (!evidence || evidence.trim().length < 10) {
    return rejected("Manual settlement requires stated evidence of at least 10 characters.");
  }

  await logAction(
    client,
    context,
    "settle_by_rule",
    "publication",
    publicationId,
    { marketKey, ruleVersion: market.settlementRuleVersion, basis: market.basis },
    evidence
  );
  return { status: "ok", data: { publicationId, marketKey } };
}

/**
 * Record that no close existed, with a reason.
 *
 * A status, never a number. The whole closing design turns on a missing close
 * staying missing, and this is the one path by which a human could otherwise
 * turn one into a zero.
 */
export async function markCloseUnavailable(
  client: SupabaseClient | null,
  context: ActorContext,
  { publicationId, reason }: { publicationId: string; reason: string }
): Promise<OperatorResult<{ publicationId: string }>> {
  if (!client) return { status: "failed", reason: "Storage is not configured." };
  if (!reason || reason.trim().length < 10) {
    return rejected("Marking a close unavailable requires a reason of at least 10 characters.");
  }

  const capture = operatorUnavailable(reason.trim());

  const { data: existing, error: readError } = await client
    .from("op_closing_prices")
    .select("id,revision,kickoff_at,market,selection,market_line,fixture_id")
    .eq("publication_id", publicationId)
    .eq("is_current", true)
    .limit(1);
  if (readError) return { status: "failed", reason: readError.message };

  const current = (existing ?? [])[0] as
    | { id: string; revision: number; kickoff_at: string; market: string; selection: string; market_line: number | null; fixture_id: string | null }
    | undefined;
  if (!current) return rejected("No closing-price row exists for this claim yet; run capture first.");

  const { data: inserted, error: insertError } = await client
    .from("op_closing_prices")
    .insert({
      publication_id: publicationId,
      fixture_id: current.fixture_id,
      market: current.market,
      selection: current.selection,
      market_line: current.market_line,
      closing_odds: null,
      closing_probability: null,
      source: "consensus",
      source_count: 0,
      source_bookmakers: [],
      kickoff_at: current.kickoff_at,
      capture_status: capture.captureStatus,
      missing_reason: capture.missingReason,
      policy_version: CLOSING_POLICY_VERSION,
      revision: current.revision + 1,
      is_current: true
    })
    .select("id")
    .limit(1);
  if (insertError) return { status: "failed", reason: insertError.message };

  const next = (inserted ?? [])[0] as { id: string } | undefined;
  // Retire the previous row only once the replacement exists, so a failure
  // between the two leaves the old row current rather than leaving the claim
  // with no capture at all.
  const { error: retireError } = await client
    .from("op_closing_prices")
    .update({ is_current: false, superseded_by_closing_id: next?.id ?? null })
    .eq("id", current.id);
  if (retireError) return { status: "failed", reason: retireError.message };

  await logAction(client, context, "mark_close_unavailable", "publication", publicationId, { reason }, reason);
  return { status: "ok", data: { publicationId } };
}

export async function resolveException(
  client: SupabaseClient | null,
  context: ActorContext,
  { exceptionId, state, resolution }: { exceptionId: string; state: "acknowledged" | "resolved" | "dismissed"; resolution: string }
): Promise<OperatorResult<{ exceptionId: string }>> {
  if (!client) return { status: "failed", reason: "Storage is not configured." };
  if ((state === "resolved" || state === "dismissed") && (!resolution || resolution.trim().length < 10)) {
    return rejected("Resolving or dismissing an exception requires a stated resolution.");
  }

  const terminal = state === "resolved" || state === "dismissed";
  const { error } = await client
    .from("op_settlement_exceptions")
    .update({
      state,
      resolution: resolution?.trim() ?? null,
      resolved_by: terminal ? context.actor : null,
      // The check constraint ties resolved_at to the terminal states; an
      // acknowledged exception is still open work.
      resolved_at: terminal ? new Date().toISOString() : null
    })
    .eq("id", exceptionId);
  if (error) return { status: "failed", reason: error.message };

  await logAction(client, context, `exception_${state}`, "exception", exceptionId, { state }, resolution ?? null);
  return { status: "ok", data: { exceptionId } };
}
