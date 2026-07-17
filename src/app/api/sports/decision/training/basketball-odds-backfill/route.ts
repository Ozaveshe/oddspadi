import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";
import {
  runBasketballOddsBackfill,
  type BasketballOddsBackfillRequest,
  type BasketballOddsBackfillResult
} from "@/lib/sports/training/basketballOddsBackfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type BackfillBody = Partial<BasketballOddsBackfillRequest> & Record<string, unknown>;

function raw(url: URL, body: BackfillBody | null, key: string): unknown {
  return url.searchParams.get(key) ?? body?.[key];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  return !["0", "false", "no"].includes(String(value).toLowerCase());
}

function integer(value: unknown, max: number): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : undefined;
}

function responseStatus(result: BasketballOddsBackfillResult): number {
  if (result.status === "invalid-request") return 400;
  if (result.status === "failed") return 502;
  if (result.status === "partial") return 207;
  return 200;
}

export const POST = withApiHandler(async (request: Request) => {
  if (!isTrainingAdminAuthorized(request)) {
    return apiError("Basketball odds backfill requires a valid x-oddspadi-admin-token.", 401);
  }
  const url = new URL(request.url);
  const body = (await request.json().catch(() => null)) as BackfillBody | null;
  const from = text(raw(url, body, "from"));
  const to = text(raw(url, body, "to"));
  if (!from || !to) return apiError("from and to ISO dates are required.");

  const result = await runBasketballOddsBackfill({
    request: {
      from,
      to,
      run: bool(raw(url, body, "run"), false),
      dryRun: bool(raw(url, body, "dryRun"), true),
      intervalDays: integer(raw(url, body, "intervalDays"), 31),
      maxJobs: integer(raw(url, body, "maxJobs"), 31),
      maxCredits: integer(raw(url, body, "maxCredits"), 310),
      regions: text(raw(url, body, "regions")),
      bookmakers: text(raw(url, body, "bookmakers")),
      limit: integer(raw(url, body, "limit"), 200),
      isClosing: bool(raw(url, body, "isClosing"), false),
      stopOnError: bool(raw(url, body, "stopOnError"), true)
    }
  });
  return apiSuccess(result, { status: responseStatus(result) });
});
