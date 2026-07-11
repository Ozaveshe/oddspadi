import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { attachBasketballHistoricalOdds, type BasketballOddsAttachmentRequest } from "@/lib/sports/training/basketballOddsAttachment";

export const dynamic = "force-dynamic";

type AttachBody = Partial<Omit<BasketballOddsAttachmentRequest, "limit" | "dryRun" | "isClosing">> & {
  dryRun?: boolean | string;
  isClosing?: boolean | string;
  closing?: boolean | string;
  limit?: number | string;
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

function statusFor(resultStatus: string): number {
  if (resultStatus === "stored" || resultStatus === "dry-run" || resultStatus === "no-matches") return 200;
  if (resultStatus === "not-configured") return 503;
  if (resultStatus === "provider-error") return 502;
  return 400;
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Basketball odds attachment requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as AttachBody | null;
  const date = pickText(url, body, "date");
  if (!date) return apiError("date=ISO_TIMESTAMP is required for basketball odds attachment.");

  const isClosing =
    parseBoolean(url, body, "isClosing", false) ||
    parseBoolean(url, body, "closing", false);

  const result = await attachBasketballHistoricalOdds({
    request: {
      date,
      dryRun: parseBoolean(url, body, "dryRun", true),
      isClosing,
      regions: pickText(url, body, "regions"),
      bookmakers: pickText(url, body, "bookmakers"),
      limit: parseLimit(url, body)
    }
  });

  return apiSuccess(result, { status: statusFor(result.status) });
}
