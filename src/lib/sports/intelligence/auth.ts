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

const SUPPORTED_SPORTS = new Set<Sport>(["football", "basketball", "tennis"]);
// Three sports exist; anything longer is malformed input, and splitting it
// first would build a large array before a single value is validated.
const MAX_SPORTS_PARAM_LENGTH = 64;

export function parseRequestedSports(request: Request): { sports?: Sport[]; error?: string } {
  const params = new URL(request.url).searchParams;
  const value = params.get("sports") ?? params.get("sport");
  if (!value) return {};
  const invalid = { error: "Invalid sports. Use football, basketball, or tennis." };
  if (value.length > MAX_SPORTS_PARAM_LENGTH) return invalid;
  const sports = value.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!sports.length || sports.some((sport) => !SUPPORTED_SPORTS.has(sport as Sport))) return invalid;
  return { sports: Array.from(new Set(sports)) as Sport[] };
}
