import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { CANONICAL_MARKETS } from "@/lib/markets/canonicalMarkets";
import { compareSettlement, suggestCandidates } from "@/lib/markets/candidates";
import { decideApproval, impactToken, reviewRequirements, type MappingImpact } from "@/lib/markets/impact";
import type { MarketAlias } from "@/lib/markets/alias";
import { validateAlias } from "@/lib/markets/alias";

export const dynamic = "force-dynamic";

/**
 * The Market Mapping Workbench.
 *
 * One route with a `view` (GET) or an `action` (POST), rather than a file per
 * verb. The endpoints share their reads and their validation, and splitting
 * them across a dozen route files makes the shared parts drift.
 *
 * The load-bearing rule lives in `POST approve`: it requires an impact token
 * matching the counts the analyst was shown. An approval against a stale
 * preview is refused with the fresh numbers rather than applied.
 */

async function readAliases(): Promise<{ aliases: MarketAlias[]; error: string | null }> {
  const client = getSupabaseServerClient();
  if (!client) return { aliases: [], error: "Server storage is not configured." };
  const { data, error } = await client
    .from("op_market_aliases")
    .select("*")
    .order("effective_from", { ascending: false })
    .limit(2000);
  if (error) return { aliases: [], error: error.message };
  return { aliases: (data ?? []) as unknown as MarketAlias[], error: null };
}

export const GET = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Unauthorized.", 401);
  const params = new URL(request.url).searchParams;
  const view = params.get("view") ?? "registry";

  if (view === "registry") {
    // The canonical vocabulary an analyst maps onto, with the settlement facts
    // that decide whether a mapping is honest.
    return apiSuccess({
      markets: CANONICAL_MARKETS.map((market) => ({
        key: market.key,
        sport: market.sport,
        basis: market.basis,
        overtimeRule: market.overtimeRule,
        pushRule: market.pushRule,
        voidRule: market.voidRule,
        retirementRule: market.retirementRule,
        lineRequired: market.lineRequired,
        lineGranularity: market.lineGranularity,
        selections: market.selections.map((selection) => selection.id),
        settlementBasisStatement: market.settlementBasisStatement
      }))
    });
  }

  if (view === "candidates") {
    const sport = params.get("sport");
    const rawMarket = params.get("rawMarket");
    const rawSelection = params.get("rawSelection");
    if (!sport || !rawMarket || !rawSelection) {
      return apiError("sport, rawMarket and rawSelection are required.");
    }
    const { aliases, error } = await readAliases();
    if (error) return apiError(error, 503);
    return apiSuccess({
      candidates: suggestCandidates({
        sport,
        rawMarket,
        rawSelection,
        rawLine: params.get("rawLine"),
        existingAliases: aliases
      })
    });
  }

  if (view === "compare") {
    const left = params.get("left");
    const right = params.get("right");
    if (!left || !right) return apiError("left and right market keys are required.");
    const comparison = compareSettlement(left, right);
    if (!comparison.left || !comparison.right) return apiError("One or both market keys are not canonical.");
    return apiSuccess({
      ...comparison,
      // Named explicitly rather than left for a reader to spot between two
      // columns: the reason DNB and AH 0 get confused is that the difference is
      // one field among several identical ones.
      interchangeable: comparison.differences.length === 0
    });
  }

  if (view === "queue") {
    const { aliases, error } = await readAliases();
    if (error) return apiError(error, 503);
    const pending = aliases.filter((alias) => alias.status === "draft" || alias.status === "pending_review");
    return apiSuccess({ count: pending.length, aliases: pending });
  }

  return apiError(`Unknown view "${view}". Supported: registry, candidates, compare, queue.`);
});

type ApprovalBody = {
  action?: string;
  actor?: string;
  aliasId?: string;
  impactToken?: string;
  impact?: MappingImpact;
  providerAliasCount?: number;
  currentParserVersion?: string | null;
  aliasParserVersion?: string | null;
  reason?: string;
};

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Unauthorized.", 401);

  let body: ApprovalBody;
  try {
    body = (await request.json()) as ApprovalBody;
  } catch {
    return apiError("Body must be JSON.");
  }

  const actor = body.actor?.trim();
  if (!actor) return apiError("An actor is required on every workbench action.");
  if (!body.aliasId) return apiError("aliasId is required.");

  const { aliases, error } = await readAliases();
  if (error) return apiError(error, 503);
  const alias = aliases.find((entry) => entry.id === body.aliasId);
  if (!alias) return apiError("No such alias.", 404);

  const client = getSupabaseServerClient();
  if (!client) return apiError("Server storage is not configured.", 503);

  if (body.action === "impact") {
    const impact = body.impact;
    if (!impact) return apiError("impact counts are required to mint a token.");
    const review = reviewRequirements({
      alias,
      impact,
      providerAliasCount: body.providerAliasCount ?? aliases.filter((entry) => entry.provider === alias.provider && entry.status === "active").length,
      currentParserVersion: body.currentParserVersion ?? null,
      aliasParserVersion: body.aliasParserVersion ?? null
    });
    return apiSuccess({ impact, impactToken: impactToken(alias, impact), ...review });
  }

  if (body.action === "approve") {
    const impact = body.impact;
    if (!impact || !body.impactToken) {
      return apiError("An impact preview and its token are required before approval.");
    }
    const defects = validateAlias(alias, aliases);
    const blocking = defects.filter((defect) => defect.severity === "critical");
    if (blocking.length) {
      // Quality controls are a gate, not advice. An alias with a critical
      // defect cannot be approved past it.
      return apiSuccess({ status: "rejected", defects: blocking }, { status: 422 });
    }

    const review = reviewRequirements({
      alias,
      impact,
      providerAliasCount: aliases.filter((entry) => entry.provider === alias.provider && entry.status === "active").length,
      currentParserVersion: body.currentParserVersion ?? null,
      aliasParserVersion: body.aliasParserVersion ?? null
    });
    const decision = decideApproval({ alias, actor, suppliedToken: body.impactToken, currentImpact: impact, review });
    if (decision.status === "refused") {
      return apiSuccess(decision, { status: 409 });
    }

    const { error: writeError } = await client
      .from("op_market_aliases")
      .update({ status: "active", reviewer: actor, reviewed_at: new Date().toISOString() })
      .eq("id", alias.id);
    if (writeError) return apiError(writeError.message, 503);

    await client.from("op_settlement_operator_actions").insert({
      actor,
      action: "approve_alias",
      target_kind: "market_alias",
      target_id: alias.id,
      payload: { impact, reviewReasons: review.reasons },
      evidence: body.reason ?? null
    });
    return apiSuccess({ status: "approved", aliasId: alias.id });
  }

  if (body.action === "reject" || body.action === "review") {
    if (!body.reason || body.reason.trim().length < 10) {
      return apiError("A reason of at least 10 characters is required.");
    }
    const status = body.action === "reject" ? "retired" : "pending_review";
    const { error: writeError } = await client
      .from("op_market_aliases")
      .update({ status, reviewer: actor, reviewed_at: new Date().toISOString(), notes: body.reason.trim() })
      .eq("id", alias.id);
    if (writeError) return apiError(writeError.message, 503);

    await client.from("op_settlement_operator_actions").insert({
      actor,
      action: `alias_${body.action}`,
      target_kind: "market_alias",
      target_id: alias.id,
      payload: { status },
      evidence: body.reason.trim()
    });
    return apiSuccess({ status, aliasId: alias.id });
  }

  return apiError(`Unknown action "${body.action ?? ""}". Supported: impact, approve, reject, review.`);
});
