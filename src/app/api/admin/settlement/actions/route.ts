import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  markCloseUnavailable,
  resolveException,
  settleByRule,
  verifyResultManually,
  type OperatorResult
} from "@/lib/settlement/operatorActions";

export const dynamic = "force-dynamic";

/**
 * Operator actions, one endpoint with a named action rather than a route each.
 *
 * Note what is absent: there is no action that takes an outcome. An operator
 * chooses a *rule* and the engine grades it, so "settle this as won" cannot be
 * expressed here — not discouraged, not validated against, simply not a shape
 * the API has.
 *
 * Equally absent: any path to `op_publications`. A published probability,
 * price or timestamp cannot be edited through this surface.
 */

type Body = {
  action?: string;
  actor?: string;
  fixtureId?: string;
  publicationId?: string;
  exceptionId?: string;
  marketKey?: string;
  evidence?: string;
  reason?: string;
  state?: "acknowledged" | "resolved" | "dismissed";
};

function statusFor(result: OperatorResult<unknown>): number {
  return result.status === "ok" ? 200 : result.status === "rejected" ? 422 : 503;
}

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Unauthorized.", 401);

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return apiError("Body must be JSON.");
  }

  const actor = body.actor?.trim();
  // Required because the shared admin token cannot identify anyone. Recording
  // who says they did it is not authentication, but it is the difference
  // between an attributed action and an anonymous one in the audit trail.
  if (!actor) return apiError("An actor is required on every operator action.");

  const client = getSupabaseServerClient();
  if (!client) return apiError("Server storage is not configured.", 503);
  const context = { actor };

  switch (body.action) {
    case "verify_result": {
      if (!body.fixtureId) return apiError("fixtureId is required.");
      const result = await verifyResultManually(client, context, {
        fixtureId: body.fixtureId,
        evidence: body.evidence ?? ""
      });
      return apiSuccess(result, { status: statusFor(result) });
    }
    case "settle_by_rule": {
      if (!body.publicationId || !body.marketKey) return apiError("publicationId and marketKey are required.");
      const result = await settleByRule(client, context, {
        publicationId: body.publicationId,
        marketKey: body.marketKey,
        evidence: body.evidence ?? ""
      });
      return apiSuccess(result, { status: statusFor(result) });
    }
    case "mark_close_unavailable": {
      if (!body.publicationId) return apiError("publicationId is required.");
      const result = await markCloseUnavailable(client, context, {
        publicationId: body.publicationId,
        reason: body.reason ?? ""
      });
      return apiSuccess(result, { status: statusFor(result) });
    }
    case "resolve_exception": {
      if (!body.exceptionId || !body.state) return apiError("exceptionId and state are required.");
      const result = await resolveException(client, context, {
        exceptionId: body.exceptionId,
        state: body.state,
        resolution: body.reason ?? ""
      });
      return apiSuccess(result, { status: statusFor(result) });
    }
    default:
      return apiError(
        `Unknown action "${body.action ?? ""}". Supported: verify_result, settle_by_rule, mark_close_unavailable, resolve_exception.`
      );
  }
});
