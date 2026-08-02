import { timingSafeEqual } from "node:crypto";

export function isTrainingAdminAuthorized(request: Request): boolean {
  const expected = process.env.ODDSPADI_ADMIN_TOKEN?.trim();
  const received = request.headers.get("x-oddspadi-admin-token")?.trim();
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

/**
 * The one rejection every operational endpoint returns.
 *
 * Production was answering anonymous callers with
 * "Provider sync requires a valid x-oddspadi-admin-token." — which names the
 * header to attack, confirms the route exists, and describes what it does. A
 * caller with the token already knows all three; a caller without it learns
 * nothing from a bare 401.
 */
export function trainingUnauthorized(): Response {
  return Response.json({ success: false, data: null, error: "Unauthorized." }, { status: 401 });
}

/**
 * Guard for read handlers on operational routes.
 *
 * These endpoints are not linked from the UI, which is not the same as being
 * private: an anonymous GET to /training/calibration was returning the shadow
 * model's internal key, its run UUID and its full unpublished evaluation.
 * Consumer-facing transparency lives on /track-record, built from the
 * publication ledger. This is the operator's view and stays behind the token.
 */
export function requireTrainingAdmin(request: Request): Response | null {
  return isTrainingAdminAuthorized(request) ? null : trainingUnauthorized();
}
