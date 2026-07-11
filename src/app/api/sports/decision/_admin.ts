export function isDecisionAdminAuthorized(request: Request) {
  const expected = process.env.ODDSPADI_ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const received = request.headers.get("x-oddspadi-admin-token")?.trim();
  return received === expected;
}
