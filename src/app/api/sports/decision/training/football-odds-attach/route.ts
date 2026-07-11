import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { attachFootballHistoricalOdds, type FootballOddsAttachmentRequest } from "@/lib/sports/training/footballOddsAttachment";

export const dynamic = "force-dynamic";

type AttachBody = Partial<Omit<FootballOddsAttachmentRequest, "limit" | "dryRun" | "isClosing" | "closingWindowMinutes">> & {
  dryRun?: boolean | string;
  isClosing?: boolean | string;
  closing?: boolean | string;
  limit?: number | string;
  closingWindowMinutes?: number | string;
};

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function pickText(url: URL, body: AttachBody | null, key: keyof AttachBody): string | undefined {
  return cleanText(url.searchParams.get(String(key))) ?? cleanText(body?.[key]);
}

function parseBoolean(url: URL, body: AttachBody | null, key: keyof AttachBody, fallback: boolean): boolean {
  const queryValue = url.searchParams.get(String(key));
  const value = queryValue ?? body?.[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value !== "0" && value.toLowerCase() !== "false";
  return fallback;
}

function parseLimit(url: URL, body: AttachBody | null): number | undefined {
  const raw = url.searchParams.get("limit") ?? body?.limit;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : undefined;
}

function parseClosingWindow(url: URL, body: AttachBody | null): number | undefined {
  const raw = url.searchParams.get("closingWindowMinutes") ?? body?.closingWindowMinutes;
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isInteger(parsed) && parsed >= 5 ? Math.min(parsed, 360) : undefined;
}

function statusFor(status: string): number {
  if (status === "stored" || status === "dry-run" || status === "no-matches") return 200;
  if (status === "not-configured") return 503;
  if (status === "provider-error") return 502;
  return 400;
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Football odds attachment requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as AttachBody | null;
  const date = pickText(url, body, "date");
  if (!date) return apiError("date=ISO_TIMESTAMP is required for football odds attachment.");
  const isClosing = parseBoolean(url, body, "isClosing", false) || parseBoolean(url, body, "closing", false);
  const result = await attachFootballHistoricalOdds({
    request: {
      date,
      dryRun: parseBoolean(url, body, "dryRun", true),
      isClosing,
      closingWindowMinutes: parseClosingWindow(url, body),
      regions: pickText(url, body, "regions"),
      bookmakers: pickText(url, body, "bookmakers"),
      sportKey: pickText(url, body, "sportKey"),
      fixtureProvider: pickText(url, body, "fixtureProvider"),
      limit: parseLimit(url, body)
    }
  });
  return apiSuccess(result, { status: statusFor(result.status) });
}
