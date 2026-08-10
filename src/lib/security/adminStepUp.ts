import { createHash, timingSafeEqual } from "node:crypto";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";

/**
 * Step-up authorisation for the destructive admin class.
 *
 * The operational surface authenticates with one shared bearer secret and no
 * identity. That is acceptable for routine reads and reversible jobs, but the
 * destructive class — production model runs, model promotion/rollback, bulk
 * settlement correction, provider disable, destructive migration — must clear
 * a second, distinct secret AND an explicit typed confirmation of the action.
 *
 * This is the step-up the token architecture allows: possessing the routine
 * admin token is not enough; the caller must also hold ODDSPADI_ADMIN_STEPUP_TOKEN
 * and name the action they intend. The step-up secret is separate so it can be
 * held more tightly than the everyday admin token, and it fails closed when
 * unset (a destructive action cannot proceed without a configured step-up).
 */

const STEPUP_HEADER = "x-oddspadi-stepup-token";

function constantTimeEquals(expected: string, supplied: string): boolean {
  if (!expected || !supplied) return false;
  const left = createHash("sha256").update(expected).digest();
  const right = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(left, right);
}

export function isStepUpAuthorized(request: Request): boolean {
  // The base admin token is still required — step-up is additive, not a bypass.
  if (!isTrainingAdminAuthorized(request)) return false;
  const expected = process.env.ODDSPADI_ADMIN_STEPUP_TOKEN?.trim();
  if (!expected) return false; // fail closed: no step-up secret => no destructive action
  const supplied = request.headers.get(STEPUP_HEADER)?.trim();
  return Boolean(supplied && constantTimeEquals(expected, supplied));
}

/**
 * Gate a destructive action. Returns a Response to short-circuit on failure, or
 * null when the caller may proceed. `confirm` is the value the caller supplied
 * in its body (or a header) and must equal `action` verbatim — a typed
 * acknowledgement that this exact destructive action is intended.
 */
export function requireStepUp(request: Request, action: string, confirm: unknown): Response | null {
  if (!isStepUpAuthorized(request)) {
    // Non-revealing: never says whether it was the base token, the step-up
    // token, or the confirmation that failed.
    return Response.json({ success: false, error: "Step-up authorisation required." }, { status: 403 });
  }
  if (typeof confirm !== "string" || confirm !== action) {
    return Response.json(
      { success: false, error: `Confirm this action by sending confirm: "${action}".` },
      { status: 400 }
    );
  }
  return null;
}

/**
 * A stable, non-reversible fingerprint of the acting token, so the audit log
 * records WHICH credential acted without ever storing the secret itself.
 */
export function actorTokenFingerprint(request: Request): string {
  const supplied =
    request.headers.get("x-oddspadi-admin-token")?.trim() ||
    request.headers.get("x-oddspadi-schedule-token")?.trim() ||
    "unknown";
  return createHash("sha256").update(supplied).digest("hex").slice(0, 16);
}
