import { timingSafeEqual } from "node:crypto";

export function isTrainingAdminAuthorized(request: Request): boolean {
  const expected = process.env.ODDSPADI_ADMIN_TOKEN?.trim();
  const received = request.headers.get("x-oddspadi-admin-token")?.trim();
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}
