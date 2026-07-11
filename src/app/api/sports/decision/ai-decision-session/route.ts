import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import type { DecisionAIContextDossier } from "@/lib/sports/prediction/decisionAIContextDossier";
import type { DecisionAICouncil } from "@/lib/sports/prediction/decisionAICouncil";
import type { DecisionAIReasoningGateway } from "@/lib/sports/prediction/decisionAIReasoningGateway";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import { buildDecisionAISession, runDecisionAISessionReview } from "@/lib/sports/prediction/decisionAISession";
import type { DecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import type { DecisionMvpRequirementAudit } from "@/lib/sports/prediction/decisionMvpRequirementAudit";
import { getDecisionOpenAIModel } from "@/lib/sports/prediction/openaiModel";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true" || url.searchParams.get("ai") === "1";
}

function decisionUrl(origin: string, path: string, date: string, sport: string): URL {
  const url = new URL(path, origin);
  url.searchParams.set("date", date);
  url.searchParams.set("sport", sport);
  return url;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI decision-session review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const adminToken = request.headers.get("x-oddspadi-admin-token")?.trim();
  const fetchWithAdminToken = (input: URL | string, init?: RequestInit) =>
    fetch(input, {
      ...init,
      headers: adminToken ? { "x-oddspadi-admin-token": adminToken } : init?.headers
    });
  const councilUrl = decisionUrl(url.origin, "/api/sports/decision/ai-council", query.date, query.sport);
  const contextUrl = decisionUrl(url.origin, "/api/sports/decision/ai-context-dossier", query.date, query.sport);
  const reasoningUrl = decisionUrl(url.origin, "/api/sports/decision/ai-reasoning-gateway", query.date, query.sport);
  const authorityUrl = decisionUrl(url.origin, "/api/sports/decision/authority", query.date, query.sport);
  const mvpAuditUrl = decisionUrl(url.origin, "/api/sports/decision/mvp-audit", query.date, query.sport);

  if (runRequested) {
    councilUrl.searchParams.set("review", "1");
    contextUrl.searchParams.set("run", "1");
    reasoningUrl.searchParams.set("run", "1");
    authorityUrl.searchParams.set("run", "all");
  }

  const [council, contextDossier, reasoningGateway, authority, mvpAudit] = await Promise.all([
    fetchDecisionApiData<DecisionAICouncil>(councilUrl, { fetchImpl: fetchWithAdminToken, timeoutMs: 90000, maxAttempts: 2, retryDelayMs: 500 }),
    fetchDecisionApiData<DecisionAIContextDossier>(contextUrl, { fetchImpl: fetchWithAdminToken, timeoutMs: 90000, maxAttempts: 2, retryDelayMs: 500 }),
    fetchDecisionApiData<DecisionAIReasoningGateway>(reasoningUrl, { fetchImpl: fetchWithAdminToken, timeoutMs: 90000, maxAttempts: 2, retryDelayMs: 500 }),
    fetchDecisionApiData<DecisionAuthority>(authorityUrl, { fetchImpl: fetchWithAdminToken, timeoutMs: 90000, maxAttempts: 2, retryDelayMs: 500 }),
    fetchDecisionApiData<DecisionMvpRequirementAudit>(mvpAuditUrl, { fetchImpl: fetchWithAdminToken, timeoutMs: 90000, maxAttempts: 2, retryDelayMs: 500 })
  ]);

  if (!council || !contextDossier || !reasoningGateway || !authority || !mvpAudit) {
    return apiError("Unable to build the complete AI decision session.", 502);
  }

  const session = buildDecisionAISession({
    date: query.date,
    sport: query.sport,
    council,
    contextDossier,
    reasoningGateway,
    authority,
    mvpAudit,
    runRequested
  });

  return apiSuccess(
    await runDecisionAISessionReview({
      session,
      runRequested,
      apiKey: process.env.OPENAI_API_KEY,
      model: getDecisionOpenAIModel()
    })
  );
}
