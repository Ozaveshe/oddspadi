import { timingSafeEqual } from "node:crypto";
import type { Sport } from "@/lib/sports/types";

function tokenMatches(expected: string, supplied: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function isCronAuthorized(request: Request, env: Record<string, string | undefined> = process.env): boolean {
  const expected = env.ODDSPADI_ADMIN_TOKEN?.trim();
  if (!expected) return false;
  const authorization = request.headers.get("authorization")?.trim() ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice(7).trim() : "";
  const supplied = request.headers.get("x-oddspadi-admin-token")?.trim() || request.headers.get("x-oddspadi-schedule-token")?.trim() || bearer;
  return Boolean(supplied && tokenMatches(expected, supplied));
}

export function parseRequestedSports(request: Request): { sports?: Sport[]; error?: string } {
  const value = new URL(request.url).searchParams.get("sports") ?? new URL(request.url).searchParams.get("sport");
  if (!value) return {};
  const supported = new Set<Sport>(["football", "basketball", "tennis"]);
  const sports = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!sports.length || sports.some((sport) => !supported.has(sport as Sport))) return { error: "Invalid sports. Use football, basketball, or tennis." };
  return { sports: Array.from(new Set(sports)) as Sport[] };
}
