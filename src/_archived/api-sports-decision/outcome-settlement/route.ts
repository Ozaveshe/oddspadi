import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionOutcomeSettlement, type OutcomeSettlementInput } from "@/lib/sports/prediction/decisionOutcomeSettlement";
import { storePredictionOutcome } from "@/lib/sports/prediction/decisionOutcomes";

export const dynamic = "force-dynamic";

function parseBody(value: unknown): OutcomeSettlementInput | { error: string } {
  if (!value || typeof value !== "object") return { error: "Body must be a JSON object." };
  const record = value as Record<string, unknown>;
  const text = (key: string, fallback = "") => (typeof record[key] === "string" ? record[key].trim() : fallback);
  const number = (key: string) => (typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : null);
  const fixtureExternalId = text("fixtureExternalId");
  const sport = text("sport", "football");
  const market = text("market");
  const selection = text("selection");
  const homeScore = number("homeScore");
  const awayScore = number("awayScore");

  if (!fixtureExternalId) return { error: "fixtureExternalId is required." };
  if (!["football", "basketball", "tennis", "cricket", "rugby", "handball"].includes(sport)) return { error: "sport is invalid." };
  if (!market) return { error: "market is required." };
  if (!selection) return { error: "selection is required." };
  if (homeScore === null || awayScore === null) return { error: "homeScore and awayScore must be finite numbers." };

  return {
    decisionRunId: text("decisionRunId") || null,
    fixtureExternalId,
    sport: sport as OutcomeSettlementInput["sport"],
    market,
    selection,
    homeScore,
    awayScore,
    line: number("line"),
    modelProbability: number("modelProbability"),
    impliedProbability: number("impliedProbability"),
    valueEdge: number("valueEdge"),
    odds: number("odds"),
    closingOdds: number("closingOdds"),
    settledAt: text("settledAt") || null,
    source: text("source", "settlement-preview"),
    metadata: record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata) ? (record.metadata as Record<string, unknown>) : {}
  };
}

function parseQuery(request: Request): OutcomeSettlementInput | { error: string } {
  const url = new URL(request.url);
  const number = (key: string) => {
    const value = url.searchParams.get(key);
    if (value === null || value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const fixtureExternalId = url.searchParams.get("fixtureExternalId")?.trim() || "sample-fixture";
  const sport = url.searchParams.get("sport")?.trim() || "football";
  const market = url.searchParams.get("market")?.trim() || "match_winner";
  const selection = url.searchParams.get("selection")?.trim() || "home";
  const homeScore = number("homeScore") ?? 2;
  const awayScore = number("awayScore") ?? 1;

  if (!["football", "basketball", "tennis", "cricket", "rugby", "handball"].includes(sport)) return { error: "sport is invalid." };

  return {
    decisionRunId: url.searchParams.get("decisionRunId")?.trim() || null,
    fixtureExternalId,
    sport: sport as OutcomeSettlementInput["sport"],
    market,
    selection,
    homeScore,
    awayScore,
    line: number("line"),
    modelProbability: number("modelProbability") ?? 0.58,
    impliedProbability: number("impliedProbability"),
    valueEdge: number("valueEdge"),
    odds: number("odds") ?? 1.88,
    closingOdds: number("closingOdds"),
    settledAt: url.searchParams.get("settledAt")?.trim() || null,
    source: url.searchParams.get("source")?.trim() || "settlement-preview",
    metadata: {}
  };
}

export async function GET(request: Request) {
  const input = parseQuery(request);
  if ("error" in input) return apiError(input.error);
  return apiSuccess({
    preview: buildDecisionOutcomeSettlement(input),
    persistence: {
      requested: false,
      status: "skipped",
      reason: "GET is preview-only. Use POST with persist=1 and the admin token to store op_prediction_outcomes."
    }
  });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const persistRequested = url.searchParams.get("persist") === "1";

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Invalid JSON body.");
  }

  const input = parseBody(body);
  if ("error" in input) return apiError(input.error);

  const preview = buildDecisionOutcomeSettlement(input);
  if (!persistRequested) {
    return apiSuccess({
      preview,
      persistence: {
        requested: false,
        status: "skipped",
        reason: "Preview only; add persist=1 with the admin token to store op_prediction_outcomes."
      }
    });
  }

  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Outcome settlement persistence requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  if (!preview.outcomeInput) {
    return apiError("Unsupported or invalid settlement cannot be persisted.", 400);
  }

  const persistence = await storePredictionOutcome(preview.outcomeInput);
  const status =
    persistence.status === "stored" || persistence.status === "reused" ? 200 : persistence.status === "not-configured" ? 503 : 500;
  return apiSuccess({ preview, persistence }, { status });
}
