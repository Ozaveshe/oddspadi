import { apiError, apiSuccess, parsePublicHistoryFlag, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionThoughtJournal, runDecisionThoughtJournalReview } from "@/lib/sports/prediction/decisionThoughtJournal";
import type { DecisionMind } from "@/lib/sports/prediction/decisionMind";

export const dynamic = "force-dynamic";

async function fetchMind(url: URL): Promise<DecisionMind | null> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.data) return null;
  return payload.data as DecisionMind;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI thought-journal review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const publicHistory = parsePublicHistoryFlag(request);
  const mindUrl = new URL("/api/sports/decision/mind", url.origin);
  mindUrl.searchParams.set("date", query.date);
  mindUrl.searchParams.set("sport", query.sport);
  if (publicHistory) mindUrl.searchParams.set("publicHistory", "1");

  const mind = await fetchMind(mindUrl);
  if (!mind) return apiError("Unable to build decision mind before thought journal.", 502);

  if (runRequested) return apiSuccess(await runDecisionThoughtJournalReview({ mind, runRequested }));
  return apiSuccess(buildDecisionThoughtJournal({ mind }));
}
